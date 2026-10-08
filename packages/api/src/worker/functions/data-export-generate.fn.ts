import { createWriteStream } from 'fs';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { finished } from 'stream/promises';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import {
  type AccessContext,
  AccessScope,
  type DataExportDatasetKey,
  DataScope,
} from '@sfa/shared';
import type { Model } from 'mongoose';
import type { ExportModels } from '../../common/data-export/engine/lookups';
import { DATASETS } from '../../common/data-export/engine/registry';
import { planExport } from '../../common/data-export/plan';
import { runExport } from '../../common/data-export/run';
import { TenantUrlService } from '../../common/tenancy/tenant-url.service';
import {
  dataExportBatchSize,
  dataExportMaxRows,
  dataExportRetentionDays,
} from '../../config/data-export.config';
import { Branch } from '../../branches/schemas/branch.schema';
import { Chargeback } from '../../chargebacks/schemas/chargeback.schema';
import { Contact } from '../../contacts/schemas/contact.schema';
import {
  DataExport,
  type DataExportDocument,
} from '../../data-export/schemas/data-export.schema';
import { DealAudit } from '../../deal-audits/schemas/deal-audit.schema';
import { Deal } from '../../deals/schemas/deal.schema';
import { HouseholdMember } from '../../households/schemas/household-member.schema';
import { Household } from '../../households/schemas/household.schema';
import {
  dataExportRequested,
  type DataExportJobData,
} from '../../inngest/events';
import {
  INNGEST_CLIENT,
  type InngestClient,
} from '../../inngest/inngest.client';
import {
  InngestFunction,
  type InngestFunctionProvider,
} from '../../inngest/inngest-registry.service';
import { InterestedParty } from '../../interested-parties/schemas/interested-party.schema';
import { LeadSource } from '../../lead-sources/schemas/lead-source.schema';
import { Lead } from '../../leads/schemas/lead.schema';
import { Policy } from '../../policies/schemas/policy.schema';
import { QuoteRecap } from '../../quote-recaps/schemas/quote-recap.schema';
import { StorageService } from '../../storage/storage.service';
import { User } from '../../users/schemas/user.schema';
import {
  MailDeliveryService,
  type SentEmail,
} from '../email/mail-delivery.service';
import type { StepLike } from './mailer-campaign.support';

type AnyModel = Model<any>;

/** The storage purpose — `agencies/<agencyId>/data-exports/<year>/<exportId>/<file>`. */
export const DATA_EXPORT_PURPOSE = 'data-exports';

/** Step results. **Ids and counts only** — see `MailerCampaignCommitFn`. */
interface ClaimResult {
  ok: boolean;
  reason?: string;
}
interface GenerateResult {
  rowCount: number;
  bytes: number;
}
interface NotifyResult {
  sent: boolean;
  reason?: string;
}

/**
 * Produce a requested Data Export (PAC-152): re-plan it from its row, write
 * the file, store it, email the requester.
 *
 * ## Re-planned, not replayed
 *
 * The API validated and counted the export, then stored the request — the
 * filter echo and a snapshot of the requester's scope — on the `dataExports`
 * row. A pipeline cannot be stored (`$match` keys are illegal field names), so
 * this rebuilds the `AccessContext` from that snapshot and runs the same pure
 * `planExport` the API ran. The file therefore holds what the requester could
 * see when they asked, clamped by the same scope rules, and nothing else.
 *
 * ## Three steps
 *
 * 1. **claim** — compare-and-set `queued` → `processing`. A duplicate event, a
 *    replay of a finished export or a deleted row is a no-op, never a failure.
 *    A row this job failed is admitted too, so an Inngest retry of a
 *    `generate` that threw resumes rather than refusing.
 * 2. **generate** — cursor → temp file → object storage → `ready`. The object
 *    key is deterministic per export, so a retry overwrites its own partial
 *    upload. A throw marks the row `failed` (what the page shows) and rethrows
 *    (what makes Inngest retry).
 * 3. **notify** — the "your export is ready" email. Never throws: a mail outage
 *    must not fail, or retry, an export whose file is already stored. Its
 *    outcome is written to `notification` on the row.
 *
 * ## Import boundary
 *
 * `*.schema.ts`, `common/` (the engine lives in `common/data-export/` for this
 * reason), `config/`, `storage/` and `inngest/` only. See `eslint.config.mjs`.
 */
@Injectable()
@InngestFunction()
export class DataExportGenerateFn implements InngestFunctionProvider {
  private readonly logger = new Logger(DataExportGenerateFn.name);
  private readonly models: ExportModels;

  constructor(
    @Inject(INNGEST_CLIENT) private readonly inngest: InngestClient,
    private readonly storage: StorageService,
    private readonly mail: MailDeliveryService,
    private readonly tenantUrls: TenantUrlService,
    private readonly config: ConfigService,
    @InjectModel(DataExport.name)
    private readonly exportModel: Model<DataExportDocument>,
    @InjectModel(Lead.name) lead: AnyModel,
    @InjectModel(Deal.name) deal: AnyModel,
    @InjectModel(QuoteRecap.name) quoteRecap: AnyModel,
    @InjectModel(Policy.name) policy: AnyModel,
    @InjectModel(Household.name) household: AnyModel,
    @InjectModel(HouseholdMember.name) householdMember: AnyModel,
    @InjectModel(Contact.name) contact: AnyModel,
    @InjectModel(DealAudit.name) dealAudit: AnyModel,
    @InjectModel(InterestedParty.name) interestedParty: AnyModel,
    @InjectModel(Chargeback.name) chargeback: AnyModel,
    @InjectModel(User.name) private readonly userModel: AnyModel,
    @InjectModel(Branch.name) branch: AnyModel,
    @InjectModel(LeadSource.name) leadSource: AnyModel,
  ) {
    this.models = {
      lead,
      deal,
      quoteRecap,
      policy,
      household,
      householdMember,
      contact,
      dealAudit,
      interestedParty,
      chargeback,
      user: userModel,
      branch,
      leadSource,
    };
  }

  build() {
    return this.inngest.createFunction(
      {
        id: 'data-export-generate',
        name: 'Generate a data export',
        triggers: [dataExportRequested],
        /** One run per export; `claim` covers anything that slips through. */
        idempotency: 'event.data.exportId',
        /**
         * A handful at a time: each holds a cursor over a tenant collection
         * and a temp file. Exports are minutes apart in practice, and a burst
         * should queue rather than compete with the API for the database.
         */
        concurrency: { limit: 2 },
        /** A retry resumes at the failed step; every step is repeat-safe. */
        retries: 2,
      },
      ({ event, step }) => this.handle(event, step),
    );
  }

  /** The handler body, lifted out so a test can drive it with a fake `step`. */
  async handle(
    event: { id?: string; name: string; data: DataExportJobData },
    step: StepLike,
  ): Promise<{ status: string }> {
    const { exportId } = event.data;

    const claim = (await step.run('claim', () =>
      this.claim(exportId),
    )) as ClaimResult;
    if (!claim.ok) {
      this.logger.log(`Skipping export ${exportId}: ${claim.reason}.`);
      return { status: 'skipped' };
    }

    await step.run('generate', () =>
      this.guard(exportId, () => this.generate(exportId)),
    );

    await step.run('notify', () => this.notify(event));

    return { status: 'ready' };
  }

  // -------------------------------------------------------------------------

  private async claim(exportId: string): Promise<ClaimResult> {
    const claimed = await this.exportModel.findOneAndUpdate(
      {
        _id: exportId,
        scope: { $ne: null },
        // `failed` only when *this job* failed it (it had started): an Inngest
        // retry of a `generate` that threw. A request refused at the row cap
        // is also `failed`, but never started, and must stay refused.
        $or: [
          { status: 'queued' },
          { status: 'failed', startedAt: { $ne: null } },
        ],
      },
      { $set: { status: 'processing', startedAt: new Date(), error: null } },
      { new: true },
    );
    if (claimed) return { ok: true };

    const row = await this.exportModel
      .findById(exportId)
      .select({ status: 1 })
      .lean();
    return {
      ok: false,
      reason: row ? `status is "${row.status}"` : 'the export is gone',
    };
  }

  /** Both halves matter — see `MailerCampaignCommitFn.guard`. */
  private async guard<T>(exportId: string, body: () => Promise<T>): Promise<T> {
    try {
      return await body();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Export ${exportId} failed: ${message}`);
      await this.exportModel.updateOne(
        { _id: exportId },
        { $set: { status: 'failed', error: message, finishedAt: new Date() } },
      );
      throw error;
    }
  }

  private async generate(exportId: string): Promise<GenerateResult> {
    const row = await this.exportModel.findById(exportId).lean();
    if (!row?.scope) throw new Error(`Export ${exportId} is gone.`);
    const started = Date.now();

    const access = accessFromSnapshot(row.agencyId, row.scope);
    const key = row.datasetKey as DataExportDatasetKey;
    if (!DATASETS[key]) throw new Error(`Unknown dataset ${row.datasetKey}`);
    const plan = planExport(
      access,
      row.scope.requestBranchId,
      key,
      row.filters,
    );

    const dir = await mkdtemp(join(tmpdir(), 'sfa-export-'));
    const path = join(dir, `export.${row.format}`);
    try {
      const sink = createWriteStream(path);
      const result = await runExport({
        models: this.models,
        plan,
        format: row.format,
        sink,
        timeZone: access.timeZone,
        maxRows: dataExportMaxRows(),
        batchSize: dataExportBatchSize(),
      });
      await finished(sink);

      const storageKey = this.storage.buildObjectKey({
        agencyId: row.agencyId,
        purpose: DATA_EXPORT_PURPOSE,
        filename: row.filename,
        parts: [exportId],
        unique: false,
      });
      const stored = await this.storage.putObjectFromFile(
        storageKey,
        path,
        result.contentType,
      );

      const finishedAt = new Date();
      const retentionDays = dataExportRetentionDays(
        this.config.get<string>('DATA_EXPORT_RETENTION_DAYS'),
      );
      await this.exportModel.updateOne(
        { _id: exportId },
        {
          $set: {
            status: 'ready',
            file: {
              storageKey: stored.key,
              size: stored.size,
              contentType: result.contentType,
            },
            rowCount: result.rowCount,
            bytes: stored.size,
            truncated: result.truncated,
            durationMs: Date.now() - started,
            error: null,
            finishedAt,
            expiresAt: new Date(
              finishedAt.getTime() + retentionDays * 86_400_000,
            ),
          },
        },
      );
      return { rowCount: result.rowCount, bytes: stored.size };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /**
   * Tell the requester, at the address their account carries now.
   *
   * Send and record are deliberately in **one** step here, unlike the invite:
   * this step never throws, so Inngest never replays it, and the provider's
   * idempotency key (`data-export:<id>`) collapses any duplicate send anyway.
   */
  private async notify(event: {
    id?: string;
    name: string;
    data: DataExportJobData;
  }): Promise<NotifyResult> {
    const { exportId, agencyId, requestedBy, brand } = event.data;
    let to: string | null = null;
    try {
      const row = await this.exportModel.findById(exportId).lean();
      if (row?.status !== 'ready' || !row.expiresAt) {
        return { sent: false, reason: 'not ready' };
      }
      const user = await this.userModel
        .findById(requestedBy, { email: 1, firstName: 1, isActive: 1 })
        .lean<{
          email?: string;
          firstName?: string;
          isActive?: boolean;
        } | null>();
      if (!user?.email || user.isActive === false) {
        await this.recordNotification(exportId, null, null, 'no_recipient');
        return { sent: false, reason: 'no recipient' };
      }
      to = user.email;

      const base = (await this.tenantUrls.baseUrlFor(agencyId)).replace(
        /\/+$/,
        '',
      );
      const sent: SentEmail = await this.mail.send(
        'dataExportReady',
        {
          to,
          firstName: user.firstName?.trim() || null,
          datasetLabel:
            DATASETS[row.datasetKey as DataExportDatasetKey]?.label ??
            row.datasetKey,
          format: row.format,
          rowCount: row.rowCount,
          bytes: row.bytes,
          truncated: row.truncated,
          expiresAt: new Date(row.expiresAt).toISOString(),
          pageUrl: `${base}/data-export`,
          ...(brand ? { brand } : {}),
        },
        `data-export:${exportId}`,
        agencyId,
      );
      await this.mail.record(
        {
          eventId: event.id ?? '',
          eventType: event.name,
          agencyId,
          branchId: row.branchId ?? null,
        },
        sent,
      );
      await this.recordNotification(exportId, to, new Date(), null);
      return { sent: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Export ${exportId} is ready but the email failed: ${message}`,
      );
      await this.recordNotification(exportId, to, null, message).catch(
        () => undefined,
      );
      return { sent: false, reason: message };
    }
  }

  private async recordNotification(
    exportId: string,
    to: string | null,
    sentAt: Date | null,
    error: string | null,
  ): Promise<void> {
    await this.exportModel.updateOne(
      { _id: exportId },
      { $set: { notification: { to, sentAt, error } } },
    );
  }
}

/**
 * The requester's access, as it was when they asked.
 *
 * Only what the planner reads is meaningful: tenancy, data scope, the user and
 * their roles (polymorphic ownership), the branch and the timezone. The
 * permission list is empty because the page's gate was checked at request time
 * and nothing in the planner consults it.
 */
function accessFromSnapshot(
  agencyId: string,
  scope: NonNullable<DataExport['scope']>,
): AccessContext {
  const dataScope = Object.values(DataScope).includes(
    scope.dataScope as DataScope,
  )
    ? (scope.dataScope as DataScope)
    : DataScope.Own;
  return {
    userId: scope.userId,
    agencyId,
    branchId: scope.branchId,
    isPlatformAdmin: false,
    scope: scope.branchId ? AccessScope.Branch : AccessScope.Agency,
    dataScope,
    permissions: [],
    roleIds: scope.roleIds ?? [],
    timeZone: scope.timeZone,
  };
}
