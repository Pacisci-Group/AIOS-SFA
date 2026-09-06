import { pipeline } from 'stream/promises';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { parse } from 'csv-parse';
import { Types, type Model } from 'mongoose';
import type {
  MailerCampaignImportCounts,
  MailerCampaignStats,
} from '@sfa/shared';
import {
  resolveAssignment,
  unmatchedCodeMessage,
  visibleAgencyIdsFor,
} from '../../common/mailers/campaign-assignment';
import { DEFAULT_MAILER_CARRIER } from '../../common/mailers/mailer-carrier';
import {
  CSV_CONTENT_TYPE,
  MAILER_CAMPAIGN_PURPOSE,
} from '../../common/mailers/mailer-file-types';
import { importMailerRows } from '../../common/mailers/mailer-import';
import { processMailerFile } from '../../common/mailers/mailer-processor';
import { normalizeHeader } from '../../common/mailers/mailer-row.mapper';
import {
  detectVendorFileKind,
  writeVendorCsv,
} from '../../common/mailers/vendor-file-reader';
import {
  mailerCampaignCommitRequested,
  mailerCampaignOutputEmailRequested,
  type MailerCampaignJobData,
} from '../../inngest/events';
import {
  INNGEST_CLIENT,
  type InngestClient,
} from '../../inngest/inngest.client';
import { InngestService } from '../../inngest/inngest.service';
import {
  InngestFunction,
  type InngestFunctionProvider,
} from '../../inngest/inngest-registry.service';
import {
  Carrier,
  type CarrierDocument,
} from '../../carriers/schemas/carrier.schema';
import { Lead, type LeadDocument } from '../../leads/schemas/lead.schema';
import {
  MailerCampaign,
  type MailerCampaignDocument,
} from '../../mailers/schemas/mailer-campaign.schema';
import {
  MailerZipMarket,
  type MailerZipMarketDocument,
} from '../../mailers/schemas/mailer-zip-market.schema';
import {
  Mailer,
  type MailerDocument,
} from '../../mailers/schemas/mailer.schema';
import {
  Agency,
  type AgencyDocument,
} from '../../platform/schemas/agency.schema';
import { StorageService } from '../../storage/storage.service';
import {
  chunk,
  failCampaign,
  loadZipMarkets,
  plainSettings,
  readCampaignFile,
  summarizeCarrierCodes,
  type StepLike,
} from './mailer-campaign.support';

/** Step results. **Ids and counts only** — see the class note. */
interface GateResult {
  ok: boolean;
  reason?: string;
}
interface AssignmentResult {
  byCodeKey: Record<string, string[] | null>;
  agencyIds: string[] | null;
}
interface ProcessResult {
  outputKey: string;
  outputRows: number;
}
interface ImportResult {
  read: number;
  mapped: number;
  created: number;
  updated: number;
  skipped: number;
}

/**
 * Run the campaign for real (PAC-71).
 *
 * Write the print CSV, upsert the mailers, delete whatever an overwrite
 * replaced, and link the leads that were waiting on this file. Everything the
 * operator confirmed at the gate is re-asserted here, because the gate ran in a
 * request and this runs minutes later.
 *
 * ## Why a chain of steps rather than one
 *
 * Unlike the preview, this **writes**, and the writes are not all the same kind:
 * an import that succeeded must not be re-run because a lead reconcile failed
 * afterwards. `step.run` memoizes on success, so a retry resumes at the step
 * that threw. That is only sound because every step is individually safe to
 * repeat — the import is an upsert on the dedupe key, the delete is bounded by
 * an id list, and the reconcile only fills links that are still null.
 *
 * ## ⚠ Step results carry ids and counts, never rows
 *
 * Inngest memoizes every step result as JSON and replays it on each retry. Put
 * 20,000 mapped rows in one and the function's own state balloons past what the
 * platform will carry. `process` therefore writes the output CSV to storage and
 * returns its **key**; `import` re-streams it. Reconcile walks the *leads* with
 * a pending key rather than the 20,000 keys the import just wrote.
 *
 * ## Import boundary
 *
 * `*.schema.ts` and `common/` only — no feature service. See `eslint.config.mjs`.
 */
@Injectable()
@InngestFunction()
export class MailerCampaignCommitFn implements InngestFunctionProvider {
  private readonly logger = new Logger(MailerCampaignCommitFn.name);

  constructor(
    @Inject(INNGEST_CLIENT) private readonly inngest: InngestClient,
    // `src/inngest/` is shared infrastructure the worker boundary admits (see
    // `eslint.config.mjs`), and `InngestModule` is `@Global()` and imported by
    // both roots — so the outbox is reachable from here without dragging a
    // feature module across the boundary.
    private readonly events: InngestService,
    private readonly storage: StorageService,
    @InjectModel(MailerCampaign.name)
    private readonly campaignModel: Model<MailerCampaignDocument>,
    @InjectModel(Mailer.name)
    private readonly mailerModel: Model<MailerDocument>,
    @InjectModel(MailerZipMarket.name)
    private readonly zipModel: Model<MailerZipMarketDocument>,
    @InjectModel(Agency.name)
    private readonly agencyModel: Model<AgencyDocument>,
    @InjectModel(Carrier.name)
    private readonly carrierModel: Model<CarrierDocument>,
    @InjectModel(Lead.name)
    private readonly leadModel: Model<LeadDocument>,
  ) {}

  build() {
    return this.inngest.createFunction(
      {
        id: 'mailer-campaign-commit',
        name: 'Commit a mailer campaign',
        triggers: [mailerCampaignCommitRequested],
        /** A double-submitted commit imports once; a deliberate re-run bumps
         * `commitAttempt` and correctly runs again. */
        idempotency: 'event.data.campaignId + "-" + event.data.attempt',
        /**
         * **Global, not per campaign.** Two campaigns for the same week write
         * over the same dedupe keys, and interleaving their `bulkWrite`s would
         * make "which campaign owns this mailer" depend on batch timing. One at
         * a time, and the commit gate's count re-check catches anything that
         * moved while a run was queued.
         */
        concurrency: { limit: 1 },
        /** A retry resumes at the failed step; every step is repeat-safe. */
        retries: 2,
      },
      ({ event, step }) => this.handle(event, step),
    );
  }

  /** The handler body, lifted out so a test can drive it with a fake `step`. */
  async handle(
    event: { id?: string; name: string; data: MailerCampaignJobData },
    step: StepLike,
  ): Promise<{ status: string }> {
    const { campaignId, attempt, requestedBy } = event.data;

    // 1. Gate — is this dispatch still the current one?
    const gate = (await step.run('gate', () =>
      this.gate(campaignId, attempt),
    )) as GateResult;
    if (!gate.ok) {
      this.logger.log(`Skipping commit for ${campaignId}: ${gate.reason}.`);
      return { status: 'skipped' };
    }

    // 2. Who the rows belong to, resolved *now*.
    const assignment = (await step.run('resolve-assignment', () =>
      this.guard(campaignId, () => this.resolveAudience(campaignId)),
    )) as AssignmentResult;

    // 3. Transform and store the print file.
    const processed = (await step.run('process', () =>
      this.guard(campaignId, () => this.process(campaignId, attempt)),
    )) as ProcessResult;

    // 4. Write the mailers.
    const counts = (await step.run('import', () =>
      this.guard(campaignId, () =>
        this.import(campaignId, attempt, processed.outputKey, assignment),
      ),
    )) as ImportResult;

    // 5. Overwrite only: remove what the new file does not carry.
    const deleted = (await step.run('delete-replaced', () =>
      this.guard(campaignId, () => this.deleteReplaced(campaignId)),
    )) as number;

    // 6. Link the leads that were waiting for this file.
    const linked = (await step.run('reconcile-leads', () =>
      this.guard(campaignId, () =>
        this.reconcileLeads(campaignId, assignment.agencyIds, requestedBy),
      ),
    )) as { leadsLinked: number; leadsConflicted: number };

    // 7. Report.
    await step.run('finalize', () =>
      this.guard(campaignId, () =>
        this.finalize(campaignId, { ...counts, deleted, ...linked }),
      ),
    );

    // 8. Mail the completion notice — a **separate function**, so a mail
    //    transport failure can never fail an import that already succeeded.
    await step.run('email-output', () =>
      this.requestOutputEmail(campaignId, attempt, requestedBy),
    );

    return { status: 'imported' };
  }

  /**
   * Run a step's body, marking the campaign failed if it throws.
   *
   * Both halves matter: the record is what the operator watching the page sees,
   * and the rethrow is what makes Inngest retry.
   */
  private async guard<T>(
    campaignId: string,
    body: () => Promise<T>,
  ): Promise<T> {
    try {
      return await body();
    } catch (error) {
      return failCampaign(this.campaignModel, campaignId, error);
    }
  }

  // -------------------------------------------------------------------------

  /**
   * ⚠ A stale dispatch is a **no-op, never a failure**.
   *
   * `failed` is accepted alongside `processing` so a retry of a run that died
   * mid-chain resumes rather than refusing; the attempt counter is what
   * actually distinguishes "this dispatch" from an older one.
   */
  private async gate(campaignId: string, attempt: number): Promise<GateResult> {
    const campaign = await this.campaignModel.findById(campaignId).lean();
    if (!campaign) return { ok: false, reason: 'campaign is gone' };
    if (campaign.commitAttempt !== attempt) {
      return {
        ok: false,
        reason: `attempt ${attempt} superseded by ${campaign.commitAttempt}`,
      };
    }
    if (campaign.status !== 'processing' && campaign.status !== 'failed') {
      return { ok: false, reason: `status is "${campaign.status}"` };
    }
    return { ok: true };
  }

  /**
   * Resolve the audience again, at commit time.
   *
   * The gate already checked this in the request, but an appointment can be
   * revoked between the operator pressing Commit and the job running, and this
   * is the resolution the rows are actually stamped with.
   */
  private async resolveAudience(campaignId: string): Promise<AssignmentResult> {
    const campaign = await this.mustFind(campaignId);
    const counts = Object.fromEntries(
      (campaign.preview?.assignment.resolved ?? []).map((row) => [
        row.codeKey,
        row.rows,
      ]),
    );
    const resolution = await resolveAssignment(
      this.agencyModel,
      { carrierId: campaign.carrierId, assignment: campaign.assignment },
      counts,
    );

    if (resolution.unmatched.length > 0) {
      const carrier = await this.carrierModel
        .findById(campaign.carrierId)
        .select({ name: 1 })
        .lean();
      throw new Error(
        resolution.unmatched
          .map((code) =>
            unmatchedCodeMessage(
              code,
              counts[code] ?? 0,
              carrier?.name ?? DEFAULT_MAILER_CARRIER,
            ),
          )
          .join(' '),
      );
    }

    return {
      byCodeKey: resolution.byCodeKey,
      // Which agencies' leads the reconcile has to walk. `null` = every agency,
      // which is what `all` means.
      agencyIds:
        campaign.assignment.mode === 'all'
          ? null
          : [
              ...new Set(
                Object.values(resolution.byCodeKey).flatMap((ids) => ids ?? []),
              ),
            ],
    };
  }

  /**
   * Produce the 132-column print CSV and put it in storage.
   *
   * The key is **deterministic** (`…/<campaignId>/<attempt>/<fileName>.csv`), so
   * a retry overwrites its own partial write rather than littering storage with
   * near-identical files nothing points at.
   *
   * A `processed` source skips the transform entirely — running it twice
   * discounts `yearlyprem` a second time, which is exactly the defect the Apex
   * round trip has today. Its CSV is used as the output as it stands; an XLSX
   * is rewritten as CSV so the import step can stream it.
   */
  private async process(
    campaignId: string,
    attempt: number,
  ): Promise<ProcessResult> {
    const campaign = await this.mustFind(campaignId);
    if (!campaign.vendorFile) throw new Error('This campaign has no file.');

    const settings = plainSettings(campaign.settings);
    const isProcessed = campaign.source === 'processed' || !settings;
    const kind = detectVendorFileKind({
      filename: campaign.vendorFile.name,
      contentType: campaign.vendorFile.contentType ?? null,
    });

    if (isProcessed && kind === 'csv') {
      const file = campaign.vendorFile;
      await this.campaignModel.updateOne(
        { _id: campaignId },
        {
          $set: {
            // The same object serves as both files — nothing was transformed,
            // so there is no second artifact to store or to download.
            outputFile: {
              storageKey: file.storageKey,
              name: file.name,
              size: file.size,
              sha256: file.sha256,
              contentType: file.contentType,
            },
            stats: null,
          },
        },
      );
      return { outputKey: file.storageKey, outputRows: 0 };
    }

    const { headers, rows } = await readCampaignFile(
      this.storage,
      campaign.vendorFile,
    );

    let outHeaders = headers;
    let outRows: unknown[][] = rows;
    let stats: MailerCampaignStats | null = null;
    let codes = summarizeCarrierCodes(headers, rows);

    if (!isProcessed) {
      const zipMarkets = await loadZipMarkets(
        this.zipModel,
        settings.zipResolutions,
      );
      const result = processMailerFile(headers, rows, {
        ...settings,
        campaignNumber: campaign.campaignNumber ?? '',
        zipMarkets,
      });
      outHeaders = result.headers;
      outRows = result.rows;
      stats = result.stats;
      codes = summarizeCarrierCodes(outHeaders, outRows);
    }

    const body = writeVendorCsv(outHeaders, outRows);
    const name = `${settings?.fileName || campaign.name}.csv`.replace(
      /\s+/g,
      '-',
    );
    const outputKey = this.storage.buildPlatformObjectKey({
      purpose: MAILER_CAMPAIGN_PURPOSE,
      filename: name,
      parts: ['output', campaignId, String(attempt)],
      unique: false,
    });
    const stored = await this.storage.putObject(
      outputKey,
      body,
      CSV_CONTENT_TYPE,
    );

    await this.campaignModel.updateOne(
      { _id: campaignId },
      {
        $set: {
          outputFile: {
            storageKey: stored.key,
            name,
            size: stored.size,
            contentType: CSV_CONTENT_TYPE,
          },
          stats,
          carrierAgencyIds: codes.carrierAgencyIds,
          carrierAgencyNames: codes.carrierAgencyNames,
        },
      },
    );

    return { outputKey: stored.key, outputRows: outRows.length };
  }

  /**
   * Stream the output CSV back and upsert the mailers.
   *
   * Re-read rather than carried from the previous step: 20,000 mapped rows must
   * never enter a step result, and the object key is stable so the second read
   * sees exactly what was written.
   */
  private async import(
    campaignId: string,
    attempt: number,
    outputKey: string,
    assignment: AssignmentResult,
  ): Promise<ImportResult> {
    const campaign = await this.mustFind(campaignId);
    const body = await this.storage.getObjectStream(outputKey);

    // `columns` receives the raw header row and returns the keys every record
    // is built with, so normalization happens once, at the boundary, and the
    // mapper never sees a source-specific spelling.
    const parser = parse({
      bom: true,
      columns: (header: string[]) => header.map(normalizeHeader),
      skip_empty_lines: true,
      // A trailing short row in a hand-trimmed file is an artifact, not a
      // reason to abort an import of 20,000 good ones.
      relax_column_count: true,
      trim: true,
    });

    // `pipeline`, **never** `body.pipe(parser)`. `pipe()` does not forward a
    // source error to its destination: when object storage aborted the response
    // mid-file — which it does to any client that stops reading for ~30s, and a
    // slow write batch is exactly that — the parser was told nothing at all, so
    // the consumer awaited a row that could never arrive. A job that hangs is
    // strictly worse than one that fails, because nothing downstream sees it.
    //
    // Fired and not awaited on purpose: the returned promise settles only once
    // the parser is fully consumed, which is what `importMailerRows` is doing
    // below. The `catch` keeps a rejection from surfacing as an unhandled
    // rejection in the race where `pipeline` rejects fractionally before the
    // consumer observes the destroyed parser.
    pipeline(body, parser).catch(() => undefined);

    const result = await importMailerRows(
      parser,
      {
        campaignId,
        visibleAgencyIdsFor: visibleAgencyIdsFor(
          campaign.assignment,
          assignment.byCodeKey,
        ),
        system: 'spreadsheet',
        runId: `${campaignId}:${attempt}`,
        uploadedFilename: campaign.vendorFile?.name,
        storageKey: outputKey,
        uploadedAt: new Date(),
        updatedBy: campaign.requestedBy?.toString(),
      },
      { model: this.mailerModel },
    );

    // Rejections are written here rather than returned: they are a capped
    // sample, but a step result is replayed on every retry and this keeps the
    // memoized payload to five integers.
    await this.campaignModel.updateOne(
      { _id: campaignId },
      { $set: { rejections: result.rejections } },
    );

    if (result.inconsistentColumns.length > 0) {
      // Informational since PAC-71: several `agencyid` values is the normal
      // multi-agency case, and the real week-36 file carries two `quotedate`s.
      this.logger.log(
        `Campaign ${campaignId}: columns with more than one value — ` +
          `${result.inconsistentColumns.join(', ')}.`,
      );
    }

    return result.counts;
  }

  /**
   * Overwrite only: delete the rows the replaced campaigns hold that this file
   * does not carry, and mark those campaigns `superseded`.
   *
   * ⚠ **Import first, delete second** — the order is the point. Rows present in
   * both files keep their `_id`, so a prospect still being mailed never has a
   * dangling lead link; only the leftovers are removed, and their leads have
   * `mailer.mailerId` cleared rather than pointing at nothing.
   *
   * The count is logged when it disagrees with what the operator confirmed but
   * **never refuses**: the gate already checked it against a live count minutes
   * ago, and stopping half way through an overwrite is a worse state than
   * finishing one.
   */
  private async deleteReplaced(campaignId: string): Promise<number> {
    const campaign = await this.mustFind(campaignId);
    if (
      campaign.commitMode !== 'overwrite' ||
      campaign.replaceCampaignIds.length === 0
    ) {
      return 0;
    }

    const leftovers = await this.mailerModel
      .find({
        campaignId: { $in: campaign.replaceCampaignIds },
      })
      .select({ _id: 1 })
      .lean();
    const ids = leftovers.map((row) => row._id);

    if (
      campaign.expectedDeleteCount !== null &&
      ids.length !== campaign.expectedDeleteCount
    ) {
      this.logger.warn(
        `Campaign ${campaignId}: deleting ${ids.length} replaced mailers, ` +
          `not the ${campaign.expectedDeleteCount} confirmed at commit.`,
      );
    }

    let deleted = 0;
    for (const batch of chunk(ids, 1_000)) {
      // Unlink before deleting: a lead pointing at a document that no longer
      // exists is worse than one that says the mailer went away.
      await this.leadModel.updateMany(
        { 'mailer.mailerId': { $in: batch } },
        { $set: { 'mailer.mailerId': null } },
      );
      const res = await this.mailerModel.deleteMany({ _id: { $in: batch } });
      deleted += res.deletedCount ?? 0;
    }

    await this.campaignModel.updateMany(
      { _id: { $in: campaign.replaceCampaignIds } },
      {
        $set: {
          status: 'superseded',
          supersededByCampaignId: campaignId,
          finishedAt: new Date(),
        },
      },
    );

    return deleted;
  }

  /**
   * Link the leads that were created before their mailer existed.
   *
   * The "prospect called before the operator imported the file" case, and the
   * same pass that backfills leads which already carried a typed control
   * number. Walks the *leads* with a pending key rather than the keys the
   * import just wrote — there are far fewer of them, and it keeps the step's
   * working set independent of the file's size.
   *
   * ⚠ Links are only ever *filled*, never rewritten: the update is conditioned
   * on `mailer.mailerId` still being null, and an E11000 on the platform-wide
   * unique index means the drawer won the mailer in the meantime. Both count as
   * conflicts and are reported; neither is resolved by picking one, because an
   * arbitrary link is worse than none.
   */
  private async reconcileLeads(
    campaignId: string,
    agencyIds: string[] | null,
    requestedBy: string,
  ): Promise<{ leadsLinked: number; leadsConflicted: number }> {
    const filter: Record<string, unknown> = {
      'mailer.mailerId': null,
      'mailer.controlNumberKey': { $type: 'string' },
      ...(agencyIds ? { agencyId: { $in: agencyIds } } : {}),
    };

    let leadsLinked = 0;
    let leadsConflicted = 0;
    const linkedBy = Types.ObjectId.isValid(requestedBy)
      ? new Types.ObjectId(requestedBy)
      : null;

    const cursor = this.leadModel
      .find(filter)
      .select({ _id: 1, 'mailer.controlNumberKey': 1 })
      .cursor();

    for await (const lead of cursor) {
      const key = lead.mailer?.controlNumberKey;
      if (!key) continue;

      const mailer = await this.mailerModel
        .findOne({ controlNumberKeys: key, campaignId })
        .select({ _id: 1 })
        .lean();
      if (!mailer) continue;

      try {
        const res = await this.leadModel.updateOne(
          { _id: lead._id, 'mailer.mailerId': null },
          {
            $set: {
              'mailer.mailerId': mailer._id,
              'mailer.campaignId': campaignId,
              'mailer.matchedBy': 'control_number',
              'mailer.linkedAt': new Date(),
              'mailer.linkedBy': linkedBy,
            },
          },
        );
        if (res.modifiedCount > 0) leadsLinked += 1;
        else leadsConflicted += 1;
      } catch (error) {
        // E11000 on `mailer.mailerId_1`: another lead owns this mailer. The
        // index is what enforces one lead per mailer platform-wide; this is
        // where that shows up as a number rather than a crash.
        if ((error as { code?: number }).code === 11000) {
          leadsConflicted += 1;
        } else {
          throw error;
        }
      }
    }

    return { leadsLinked, leadsConflicted };
  }

  private async finalize(
    campaignId: string,
    counts: MailerCampaignImportCounts,
  ): Promise<{ imported: true }> {
    await this.campaignModel.updateOne(
      { _id: campaignId },
      {
        $set: {
          status: 'imported',
          importCounts: counts,
          error: null,
          finishedAt: new Date(),
        },
      },
    );
    return { imported: true };
  }

  private async requestOutputEmail(
    campaignId: string,
    attempt: number,
    requestedBy: string,
  ): Promise<{ queued: number }> {
    const campaign = await this.campaignModel
      .findById(campaignId)
      .select({ settings: 1 })
      .lean();
    const recipients = campaign?.settings?.outputRecipients ?? [];
    if (recipients.length === 0) return { queued: 0 };

    // Through `InngestService`, not the raw client: it mints the outbox row
    // before sending, so a completion notice stranded by a queue outage is
    // re-emitted by the sweeper rather than silently lost. The operator's own
    // recovery — `POST /platform/mailer-campaigns/:id/email` — is the second
    // line of defence, not the first.
    await this.events.send(mailerCampaignOutputEmailRequested, {
      campaignId,
      attempt,
      requestedBy,
      recipients,
    });
    return { queued: recipients.length };
  }

  private async mustFind(campaignId: string): Promise<MailerCampaignDocument> {
    const campaign = await this.campaignModel.findById(campaignId);
    if (!campaign) throw new Error(`Campaign ${campaignId} is gone.`);
    return campaign;
  }
}
