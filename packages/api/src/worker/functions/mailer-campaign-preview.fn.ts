import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  MAILER_CAMPAIGN_RECOMMENDED_COLUMNS,
  MAILER_CAMPAIGN_REQUIRED_COLUMNS,
  mailerControlNumberKeys,
  type MailerCampaignConflict,
  type MailerCampaignPreview,
} from '@sfa/shared';
import { Model } from 'mongoose';
import { resolveAssignment } from '../../common/mailers/campaign-assignment';
import { importMailerRows } from '../../common/mailers/mailer-import';
import {
  parseSourceDate,
  parseWeekNumber,
} from '../../common/mailers/mailer-parse';
import { processMailerFile } from '../../common/mailers/mailer-processor';
import { normalizeHeader } from '../../common/mailers/mailer-row.mapper';
import {
  mailerCampaignPreviewRequested,
  type MailerCampaignJobData,
} from '../../inngest/events';
import {
  INNGEST_CLIENT,
  type InngestClient,
} from '../../inngest/inngest.client';
import {
  InngestFunction,
  type InngestFunctionProvider,
} from '../../inngest/inngest-registry.service';
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
  columnIndex,
  failCampaign,
  loadZipMarkets,
  plainSettings,
  readCampaignFile,
  rowsAsRecords,
  summarizeCarrierCodes,
  type StepLike,
} from './mailer-campaign.support';

/** What the handler reports back; the campaign record holds the detail. */
interface PreviewSummary {
  skipped?: 'missing' | 'stale';
  status?: 'previewed' | 'failed';
  inputRows?: number;
  outputRows?: number;
  unmatchedCodes?: number;
}

/**
 * Look at a vendor file and report what committing it would do (PAC-71).
 *
 * **Writes no mailers.** The operator sees row counts, the assignment
 * resolution, unmatched ZIPs, the premium spread, the floor hit rate and any
 * campaign this file overlaps — before deciding. Cancelling writes nothing at
 * all, which is the property that makes a 20,000-row mail drop safe to run from
 * a web page.
 *
 * ## One step, deliberately
 *
 * Nothing here writes anything but the campaign's own `preview` field, and that
 * write is idempotent, so there is no partial state for a memoized boundary to
 * protect. Splitting it would memoize intermediate results a retry would
 * re-derive identically — and the intermediates are the *rows*, which must
 * never enter a step result.
 *
 * ## Import boundary
 *
 * This file may import `*.schema.ts` and the pure helpers in `common/`, but no
 * feature service — see `eslint.config.mjs`. That is why the transform, the
 * import engine and the assignment resolver are all plain functions taking
 * their collaborators as arguments.
 */
@Injectable()
@InngestFunction()
export class MailerCampaignPreviewFn implements InngestFunctionProvider {
  private readonly logger = new Logger(MailerCampaignPreviewFn.name);

  constructor(
    @Inject(INNGEST_CLIENT) private readonly inngest: InngestClient,
    private readonly storage: StorageService,
    @InjectModel(MailerCampaign.name)
    private readonly campaignModel: Model<MailerCampaignDocument>,
    @InjectModel(Mailer.name)
    private readonly mailerModel: Model<MailerDocument>,
    @InjectModel(MailerZipMarket.name)
    private readonly zipModel: Model<MailerZipMarketDocument>,
    @InjectModel(Agency.name)
    private readonly agencyModel: Model<AgencyDocument>,
  ) {}

  build() {
    return this.inngest.createFunction(
      {
        id: 'mailer-campaign-preview',
        name: 'Preview a mailer campaign',
        triggers: [mailerCampaignPreviewRequested],
        /**
         * Keyed on the campaign **and the attempt**, so a double-submitted
         * `PATCH` previews once while a deliberate re-preview — which bumps
         * `previewAttempt` — correctly runs again.
         */
        idempotency: 'event.data.campaignId + "-" + event.data.attempt',
        /**
         * A preview holds a whole file in memory. Three at once is a comfortable
         * ceiling for a worker container; the key keeps two previews of the
         * *same* campaign from racing to write its `preview` field.
         */
        concurrency: { limit: 3, key: 'event.data.campaignId' },
        /**
         * A retry re-reads the object and recomputes. Safe because the preview
         * writes nothing but its own report, and the object key is
         * UUID-suffixed and therefore immutable — the second read sees
         * byte-identical input.
         */
        retries: 2,
      },
      ({ event, step }) => this.handle(event, step),
    );
  }

  /**
   * The handler body, lifted out of `createFunction` so it can be called
   * directly — the same seam `SendInviteEmailFn` uses. A handler written inline
   * is only reachable by standing up a real Inngest server, which tests the
   * platform rather than our code.
   */
  async handle(
    event: { id?: string; name: string; data: MailerCampaignJobData },
    step: StepLike,
  ): Promise<PreviewSummary> {
    const { campaignId, attempt } = event.data;

    const summary = await step.run('preview', async () => {
      const campaign = await this.campaignModel.findById(campaignId);
      if (!campaign) return { skipped: 'missing' } satisfies PreviewSummary;

      // ⚠ A stale dispatch is a **no-op, never a failure**. A retried preview
      // landing after a newer one would otherwise overwrite its result with
      // older numbers — which the operator then commits against.
      if (
        campaign.status !== 'uploaded' ||
        campaign.previewAttempt !== attempt
      ) {
        this.logger.log(
          `Skipping stale preview for ${campaignId} (attempt ${attempt}, ` +
            `campaign is "${campaign.status}" at ${campaign.previewAttempt}).`,
        );
        return { skipped: 'stale' } satisfies PreviewSummary;
      }

      try {
        return await this.buildPreview(campaign);
      } catch (error) {
        return failCampaign(this.campaignModel, campaignId, error);
      }
    });

    return summary as PreviewSummary;
  }

  private async buildPreview(
    campaign: MailerCampaignDocument,
  ): Promise<PreviewSummary> {
    const campaignId = campaign._id.toString();
    if (!campaign.vendorFile) {
      throw new Error('This campaign has no uploaded file.');
    }

    const { headers, rows } = await readCampaignFile(
      this.storage,
      campaign.vendorFile,
    );

    // --- Column contract ---------------------------------------------------
    const present = new Set(headers.map((header) => normalizeHeader(header)));
    const missingRequiredColumns = MAILER_CAMPAIGN_REQUIRED_COLUMNS.filter(
      (column) => !present.has(column),
    );
    const missingRecommendedColumns =
      MAILER_CAMPAIGN_RECOMMENDED_COLUMNS.filter(
        (column) => !present.has(column),
      );

    if (missingRequiredColumns.length > 0) {
      // Fail with the report attached rather than a bare error: "which columns"
      // is the entire actionable content, and an operator cannot re-export a
      // file from a message that only says the file was rejected.
      await this.campaignModel.updateOne(
        { _id: campaignId },
        {
          $set: {
            status: 'failed',
            error: `Missing required columns: ${missingRequiredColumns.join(', ')}.`,
            preview: this.emptyPreview(
              missingRequiredColumns,
              missingRecommendedColumns,
            ),
            finishedAt: new Date(),
          },
        },
      );
      return { status: 'failed', inputRows: rows.length };
    }

    // --- Who the rows belong to -------------------------------------------
    const codes = summarizeCarrierCodes(headers, rows);
    const resolution = await resolveAssignment(
      this.agencyModel,
      { carrierId: campaign.carrierId, assignment: campaign.assignment },
      codes.codeCounts,
    );

    // --- Transform ---------------------------------------------------------
    const settings = plainSettings(campaign.settings);
    const zipMarkets = await loadZipMarkets(
      this.zipModel,
      settings?.zipResolutions ?? {},
    );

    // A `processed` file has already been through the transform somewhere else;
    // running it again would discount `yearlyprem` a second time — the exact
    // defect the Apex round trip has today.
    const processed =
      campaign.source === 'processed' || !settings
        ? { headers, rows, stats: null, unmatchedZips: {} }
        : processMailerFile(headers, rows, {
            ...settings,
            campaignNumber: campaign.campaignNumber ?? '',
            zipMarkets,
          });

    const stats = processed.stats;
    const floorHitRate =
      stats && stats.outputRows > 0 ? stats.floorRaised / stats.outputRows : 0;

    // --- What the import would make of it ---------------------------------
    const dry = await importMailerRows(
      rowsAsRecords(processed.headers, processed.rows),
      {
        campaignId,
        // The dry run only needs to know *whether* a row is assignable — the
        // rejection it produces is what the operator has to see.
        visibleAgencyIdsFor: (codeKey) =>
          resolution.byCodeKey[codeKey ?? '(blank)'],
        system: 'spreadsheet',
      },
      { model: this.mailerModel },
      { dryRun: true },
    );

    // --- Overlap with campaigns already imported --------------------------
    const overlap = await this.measureOverlap(campaign, processed);

    // --- Provenance --------------------------------------------------------
    const quoteDate = this.earliestQuoteDate(processed.headers, processed.rows);

    const preview: MailerCampaignPreview = {
      missingRequiredColumns: [...missingRequiredColumns],
      missingRecommendedColumns: [...missingRecommendedColumns],
      stats,
      unmatchedZips: Object.keys(processed.unmatchedZips).sort(),
      floorHitRate,
      assignment: {
        resolved: resolution.resolved,
        unmatched: resolution.unmatched,
      },
      existingCampaigns: overlap.existingCampaigns,
      overlap: {
        existingInOtherCampaigns: overlap.existingInOtherCampaigns,
        replacedRecordCount: overlap.replacedRecordCount,
        deleteCountIfOverwrite: overlap.deleteCountIfOverwrite,
      },
      rejections: dry.rejections,
      inconsistentColumns: dry.inconsistentColumns,
    };

    await this.campaignModel.updateOne(
      { _id: campaignId },
      {
        $set: {
          status: 'previewed',
          preview,
          error: null,
          carrierAgencyIds: codes.carrierAgencyIds,
          carrierAgencyNames: codes.carrierAgencyNames,
          quoteDate,
          weekNumber: parseWeekNumber(campaign.campaignNumber) ?? null,
          year: settings?.runYear ?? quoteDate?.getUTCFullYear() ?? null,
        },
      },
    );

    return {
      status: 'previewed',
      inputRows: rows.length,
      outputRows: processed.rows.length,
      unmatchedCodes: resolution.unmatched.length,
    };
  }

  /**
   * Which imported campaigns this file collides with, and by how much.
   *
   * Two different questions, and the preview shows both:
   *
   * - `existingInOtherCampaigns` — rows of *this* file some other campaign
   *   already owns. On an append those rows move here and the other campaign's
   *   live count drops, which is worth seeing beforehand.
   * - `deleteCountIfOverwrite` — rows the *replaced* campaigns hold that this
   *   file does **not** contain. Those are what an overwrite deletes, and the
   *   number the operator has to confirm.
   *
   * ⚠ Keys are chunked rather than sent as one `$in`: a 20,000-row file carries
   * up to 40,000 keys, and one query built from all of them approaches the
   * 16 MB command limit.
   */
  private async measureOverlap(
    campaign: MailerCampaignDocument,
    processed: { headers: string[]; rows: unknown[][] },
  ): Promise<{
    existingCampaigns: MailerCampaignConflict[];
    existingInOtherCampaigns: number;
    replacedRecordCount: number;
    deleteCountIfOverwrite: number;
  }> {
    const campaignId = campaign._id.toString();

    // The campaign-exists check: same carrier, same week, same year, and
    // actually holding rows. An abandoned `uploaded` campaign is not a conflict.
    const existing = await this.campaignModel
      .find({
        _id: { $ne: campaign._id },
        carrierId: campaign.carrierId,
        campaignNumber: campaign.campaignNumber,
        year: campaign.year,
        status: { $in: ['imported', 'processing'] },
      })
      .select({ name: 1, campaignNumber: 1, year: 1, status: 1 })
      .lean();

    const controlColumn = columnIndex(processed.headers, 'controlno');
    const shortColumn = columnIndex(processed.headers, 'newcontrolnumber');
    const keys = new Set<string>();
    for (const row of processed.rows) {
      for (const key of mailerControlNumberKeys(
        controlColumn >= 0 ? row[controlColumn] : undefined,
        shortColumn >= 0 ? row[shortColumn] : undefined,
      )) {
        keys.add(key);
      }
    }

    // Rows of this file already held somewhere else, grouped by owner.
    const matchedByCampaign = new Map<string, number>();
    for (const batch of chunk([...keys])) {
      const groups = await this.mailerModel.aggregate<{
        _id: string;
        n: number;
      }>([
        {
          $match: {
            controlNumberKeys: { $in: batch, $type: 'string' },
            campaignId: { $ne: campaignId },
          },
        },
        { $group: { _id: '$campaignId', n: { $sum: 1 } } },
      ]);
      for (const group of groups) {
        matchedByCampaign.set(
          group._id,
          (matchedByCampaign.get(group._id) ?? 0) + group.n,
        );
      }
    }

    const existingIds = existing.map((row) => row._id.toString());
    const counts = await this.mailerModel.aggregate<{ _id: string; n: number }>(
      [
        { $match: { campaignId: { $in: existingIds } } },
        { $group: { _id: '$campaignId', n: { $sum: 1 } } },
      ],
    );
    const recordCounts = new Map(counts.map((row) => [row._id, row.n]));

    const replacedRecordCount = existingIds.reduce(
      (total, id) => total + (recordCounts.get(id) ?? 0),
      0,
    );
    const matchedInReplaced = existingIds.reduce(
      (total, id) => total + (matchedByCampaign.get(id) ?? 0),
      0,
    );

    return {
      existingCampaigns: existing.map((row): MailerCampaignConflict => ({
        campaignId: row._id.toString(),
        name: row.name,
        campaignNumber: row.campaignNumber ?? null,
        year: row.year,
        status: row.status,
        recordCount: recordCounts.get(row._id.toString()) ?? 0,
      })),
      existingInOtherCampaigns: [...matchedByCampaign.values()].reduce(
        (total, n) => total + n,
        0,
      ),
      replacedRecordCount,
      // Rows the replaced campaigns hold that this file does not carry. Never
      // negative: `matchedInReplaced` counts a subset of `replacedRecordCount`.
      deleteCountIfOverwrite: replacedRecordCount - matchedInReplaced,
    };
  }

  /** The earliest `quotedate` in the file, as provenance on the campaign. */
  private earliestQuoteDate(headers: string[], rows: unknown[][]): Date | null {
    const column = columnIndex(headers, 'quotedate');
    if (column < 0) return null;

    let earliest: Date | null = null;
    for (const row of rows) {
      const parsed = parseSourceDate(row[column]);
      if (parsed && (!earliest || parsed < earliest)) earliest = parsed;
    }
    return earliest;
  }

  private emptyPreview(
    missingRequiredColumns: readonly string[],
    missingRecommendedColumns: readonly string[],
  ): MailerCampaignPreview {
    return {
      missingRequiredColumns: [...missingRequiredColumns],
      missingRecommendedColumns: [...missingRecommendedColumns],
      stats: null,
      unmatchedZips: [],
      floorHitRate: 0,
      assignment: { resolved: [], unmatched: [] },
      existingCampaigns: [],
      overlap: {
        existingInOtherCampaigns: 0,
        replacedRecordCount: 0,
        deleteCountIfOverwrite: 0,
      },
      rejections: [],
      inconsistentColumns: [],
    };
  }
}
