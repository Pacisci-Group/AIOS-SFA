import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { AnyBulkWriteOperation, Model, Types } from 'mongoose';
import {
  AuditTemplate,
  AuditTemplateDocument,
} from '../audit-templates/schemas/audit-template.schema';
import {
  DealAudit,
  DealAuditDocument,
} from '../deal-audits/schemas/deal-audit.schema';
import {
  DealAuditAttachment,
  DealAuditItem,
} from '../deal-audit-items/schemas/deal-audit-item.schema';
import { DEFAULT_DEAL_AUDIT_STATUS } from '@sfa/shared';
import { authorshipForInsert } from '../common/context/request-context';
import { syncAuditCounters } from '../deal-audits/audit-counters';
import { Deal, DealDocument } from '../deals/schemas/deal.schema';
import {
  attachmentKey,
  buildDedupeKey,
  buildItemName,
  computeRequiredTitles,
  normalizeTitle,
  type RequiredAuditItem,
} from './audit-titles';

/*
 * The deadline rule now lives in `./audit-due`, so the migration can write the
 * same `dueAt` without importing this request-path service. Re-exported here
 * because `AUDIT_ITEM_DUE_DAYS` was already imported from this module by the
 * demo seed and the specs.
 */
import { auditItemDueAt } from './audit-due';

export { AUDIT_ITEM_DUE_DAYS } from './audit-due';

export interface GenerateAuditInput {
  agencyId: string;
  branchId: string;
  dealId: Types.ObjectId;
  producerId?: Types.ObjectId;
  producerName?: string;
  clientName?: string;
  submissionToken?: string | null;
  /** Policy id per policy type, so an item can point at what triggered it. */
  policyIdByType?: Map<string, Types.ObjectId>;
  /**
   * Proofs the producer uploaded at sale time, keyed by
   * `` `${normalizeTitle(title)}|${normalizeTitle(subjectName)}` `` (PAC-56 #21b).
   *
   * Built by `SoldDealsService` — see `auditAttachmentsByItem`. Keyed on the
   * title/subject pair rather than `buildDedupeKey` so the caller does not need
   * the deal id it has not created yet.
   *
   * ⚠ Without this, PAC-56 #21 would make the hand-off *worse*: producers are
   * now forced to upload a document for every discount they claim, and it would
   * land in object storage where the only person who needs it — the service
   * team working the audit board — could not see it.
   */
  attachmentsByItem?: Map<string, DealAuditAttachment[]>;
}

export interface GenerateAuditResult {
  status: 'generated' | 'no_templates' | 'failed';
  /** The deal's whole checklist, not this run's inserts — see `generate`. */
  itemCount: number;
  /** Titles the agency has no active template for — logged, not created. */
  unresolved: string[];
  error?: string;
}

/**
 * Post-sale audit generation (PAC-40) — the Sold submission's server-side
 * side-effect, and the reason the whole form exists.
 *
 * Runs **after** the deal is committed and is best-effort: a failure here must
 * never fail a sale that has already been booked. The flip side is that a
 * failure is invisible unless it is recorded, which is why every run stamps
 * `auditGenerationStatus` on the deal and every unresolved title is logged.
 */
@Injectable()
export class AuditGenerationService {
  private readonly logger = new Logger(AuditGenerationService.name);

  constructor(
    @InjectModel(AuditTemplate.name)
    private readonly templateModel: Model<AuditTemplateDocument>,
    /*
     * Class-typed rather than `Model<…Document>` for these two, matching the
     * migration and demo seed — `Model<T>` is invariant in `T`, so the two
     * spellings are not interchangeable and `syncAuditCounters` has to be
     * handed one or the other. The class form is already what this service's
     * `AnyBulkWriteOperation<DealAuditItem>` ops are written against.
     */
    @InjectModel(DealAuditItem.name)
    private readonly itemModel: Model<DealAuditItem>,
    @InjectModel(DealAudit.name)
    private readonly dealAuditModel: Model<DealAudit>,
    @InjectModel(Deal.name)
    private readonly dealModel: Model<DealDocument>,
  ) {}

  async generateForDeal(
    input: GenerateAuditInput,
  ): Promise<GenerateAuditResult> {
    try {
      return await this.generate(input);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Audit generation failed for deal ${input.dealId.toString()}: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
      await this.stamp(input.dealId, {
        auditGenerationStatus: 'failed',
        auditGenerationError: message,
      });
      return { status: 'failed', itemCount: 0, unresolved: [], error: message };
    }
  }

  private async generate(
    input: GenerateAuditInput,
  ): Promise<GenerateAuditResult> {
    const deal = await this.dealModel.findById(input.dealId);
    if (!deal) {
      return { status: 'failed', itemCount: 0, unresolved: [] };
    }

    // Only active templates. An agency that switched one off has made a
    // decision, and generation must respect it.
    const templates = await this.templateModel
      .find({ agencyId: input.agencyId, active: true })
      .lean<
        Array<{
          _id: Types.ObjectId;
          name?: string;
          category?: string;
          required?: boolean;
          blocking?: boolean;
          alwaysInclude?: boolean;
        }>
      >();

    if (!templates.length) {
      // Not an error, but never silent: a tenant whose catalog was never
      // seeded books sales that generate no hand-off at all.
      this.logger.warn(
        `No active audit templates for agency ${input.agencyId} — deal ` +
          `${input.dealId.toString()} generated no hand-off items.`,
      );
      await this.stamp(input.dealId, {
        auditGenerationStatus: 'no_templates',
        auditGeneratedAt: new Date(),
        auditItemCount: 0,
      });
      return { status: 'no_templates', itemCount: 0, unresolved: [] };
    }

    const byName = new Map(
      templates.map((template) => [normalizeTitle(template.name), template]),
    );

    const required = computeRequiredTitles({
      policyTypes: deal.policyTypes ?? [],
      mortgagee: deal.mortgagee === true,
      triggers: deal.auditTriggers,
      templates,
    });

    const parent = await this.upsertParentAudit(input, deal.title);

    const unresolved: string[] = [];
    const writes: AnyBulkWriteOperation<DealAuditItem>[] = [];

    for (const item of required) {
      const template = byName.get(normalizeTitle(item.title));
      if (!template) {
        // Legacy dropped these silently, which is exactly how a vocabulary
        // mismatch becomes invisible. Logging is the difference between "the
        // checklist is short" and "nobody knows why".
        unresolved.push(item.title);
        continue;
      }

      writes.push({
        updateOne: {
          filter: {
            agencyId: input.agencyId,
            dedupeKey: buildDedupeKey(input.dealId.toString(), item),
          },
          // `$setOnInsert`, never `$set`: re-running generation must not
          // overwrite an item the service team has already resolved.
          update: {
            $setOnInsert: this.buildItem(input, item, template, parent?._id),
          },
          upsert: true,
        },
      });
    }

    if (unresolved.length) {
      this.logger.warn(
        `Deal ${input.dealId.toString()}: no active template for ` +
          `${unresolved.length} required title(s): ${unresolved.join(', ')}`,
      );
    }

    if (writes.length) {
      await this.itemModel.bulkWrite(writes, { ordered: false });
    }

    /*
     * The board's sort keys and the completion-% denominator (PAC-72).
     *
     * After the items exist, not alongside them: the counters are derived from
     * what actually landed, so a partially-failed `ordered: false` bulk write
     * still leaves them describing reality. Best-effort like everything else on
     * this path — a deal is already booked by now.
     */
    if (parent) {
      try {
        await syncAuditCounters(
          this.itemModel,
          this.dealAuditModel,
          input.agencyId,
          parent._id,
        );
      } catch (error) {
        this.logger.error(
          `Could not sync audit counters for deal ${input.dealId.toString()}: ${
            error instanceof Error ? error.message : String(error)
          }`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }

    // Count the deal's items rather than this run's inserts. The two agree on
    // a first run and diverge on every later one: the upserts are deliberately
    // `$setOnInsert`, so a re-run inserts nothing and reporting the insert
    // count would stamp `auditItemCount: 0` on a deal with a full checklist.
    const itemCount = await this.itemModel.countDocuments({
      agencyId: input.agencyId,
      dealId: input.dealId,
    });

    await this.stamp(input.dealId, {
      auditGeneratedAt: new Date(),
      auditGenerationStatus: 'generated',
      auditItemCount: itemCount,
      // The display mirror of `DealAudit.auditStatus`, which is authoritative.
      // Already the right value before PAC-72 — it is the constant now so the
      // vocabulary has exactly one definition.
      dealAuditStatus: DEFAULT_DEAL_AUDIT_STATUS,
    });

    return { status: 'generated', itemCount, unresolved };
  }

  /**
   * Every field below is load-bearing for the PAC-12 hand-off board, which
   * filters on `{agencyId, isFailed, isResolved, isTestRecord}` (+ `producerId`
   * for `own` scope) and renders `clientName` / `itemName` / `daysOpen`
   * directly.
   *
   * Omitting `producerId` makes the row invisible to the producer who created
   * it; omitting `clientName` renders it as "Unknown Client". Neither errors —
   * which is why the e2e asserts the board, not the documents.
   */
  private buildItem(
    input: GenerateAuditInput,
    item: RequiredAuditItem,
    template: {
      _id: Types.ObjectId;
      name?: string;
      category?: string;
      required?: boolean;
      blocking?: boolean;
    },
    dealAuditId?: Types.ObjectId,
  ): Record<string, unknown> {
    const name = buildItemName(item);
    const now = new Date();

    return {
      /*
       * 🔴 Explicit, because `bulkWrite` below bypasses Mongoose middleware —
       * `authorshipPlugin` never runs for these documents (PAC-72). Every other
       * collection gets `createdBy` / `updatedBy` for free; this one would have
       * silently had neither.
       *
       * Empty outside a request (the seed fixture calls this too), which leaves
       * both fields null and reads as "system" — the intended behaviour.
       */
      ...authorshipForInsert(),
      agencyId: input.agencyId,
      branchId: input.branchId,
      dealId: input.dealId,
      dealAuditId,
      templateId: template._id,
      policyId: input.policyIdByType?.get(item.title),
      title: name,
      itemName: name,
      category: template.category,
      subjectName: item.subjectName,
      // A generated item starts as outstanding work, which on this board means
      // "failed and unresolved". The status pair mirrors what the migration
      // derives `isFailed` from, so any future re-derivation agrees.
      status: 'in_progress',
      statusLabel: 'Failed',
      isFailed: true,
      isResolved: false,
      required: template.required ?? true,
      blocking: template.blocking ?? false,
      applicable: true,
      clientName: input.clientName,
      producerName: input.producerName,
      producerId: input.producerId,
      daysOpen: 0,
      firstCreatedAt: now,
      /*
       * The soft 7-day deadline (PAC-65).
       *
       * ⚠ **Nothing enforces this.** There is no cron, no auto-fail, no
       * escalation, no expiry, and no status that flips itself at day 7. It is
       * a written target the auditor can see on the board and filter by — the
       * team pulls an overdue list, and that is the whole of it. An item past
       * its `dueAt` stays `in_progress` / failed until a human resolves it.
       *
       * This is the second thing someone will try to "fix" in this function.
       * A status that changes itself on a date is exactly the wrong reading of
       * what David asked for.
       *
       * Inside `$setOnInsert` with everything else here, so re-running
       * generation for a deal never moves a deadline already promised.
       */
      dueAt: auditItemDueAt(now),
      submissionToken: input.submissionToken ?? undefined,
      dedupeKey: buildDedupeKey(input.dealId.toString(), item),
      /*
       * The proof the producer uploaded at sale time, if this item has one
       * (PAC-56 #21b).
       *
       * ⚠ The item still opens as `in_progress` / `isFailed` above, and that is
       * deliberate — a pre-attached document is *evidence for* the auditor, not
       * a resolution. Flipping the status because a file exists would delete
       * the item from the hand-off board before anyone verified it. This is the
       * first thing someone will try to "fix".
       */
      attachments: input.attachmentsByItem?.get(attachmentKey(item)) ?? [],
      isTestRecord: false,
    };
  }

  /**
   * The roll-up record, one per deal.
   *
   * Non-unique index on `{agencyId, dealId}` — `DealAudit.legacyDealIds` is an
   * array, so migrated data may legitimately hold several per deal. `upsert`
   * with `$setOnInsert` keeps a re-run idempotent regardless.
   *
   * 🔴 **This record is no longer optional.** Until PAC-72 the board read
   * `dealAuditItems` directly and a missing parent was cosmetic; the board now
   * pages over `dealAudits`, so a deal without one is a deal the service team
   * never sees. The failure is still caught — a booked sale must not be failed
   * by its own side-effect — but it is logged as an error and stamped onto the
   * deal, not shrugged off.
   */
  private async upsertParentAudit(
    input: GenerateAuditInput,
    dealTitle?: string,
  ): Promise<DealAuditDocument | null> {
    try {
      return await this.dealAuditModel.findOneAndUpdate(
        { agencyId: input.agencyId, dealId: input.dealId },
        {
          $setOnInsert: {
            agencyId: input.agencyId,
            branchId: input.branchId,
            dealId: input.dealId,
            title: dealTitle ?? input.clientName,
            auditDate: new Date(),
            /*
             * The workflow's starting state (PAC-72). Was `result: 'Pending'`,
             * which said the opposite of what it meant: nothing has been
             * submitted, let alone reviewed. `Pending` in the real vocabulary
             * means "with the reviewer".
             */
            auditStatus: DEFAULT_DEAL_AUDIT_STATUS,
            /*
             * Default the assignee to the selling producer.
             *
             * Without this the audit reaches nobody: the board scopes on
             * `auditAssignee`, so an unassigned audit is invisible to every
             * `own`-scoped user the moment it is created. Whoever gathers the
             * documents can be reassigned later — this is a starting point,
             * not a policy.
             */
            ...(input.producerId
              ? {
                  auditAssignee: {
                    type: 'user' as const,
                    id: input.producerId,
                  },
                }
              : {}),
            isTestRecord: false,
          },
        },
        { upsert: true, new: true },
      );
    } catch (error) {
      this.logger.error(
        `Could not upsert parent audit for deal ${input.dealId.toString()} — ` +
          `its hand-off will not appear on the board: ${
            error instanceof Error ? error.message : String(error)
          }`,
        error instanceof Error ? error.stack : undefined,
      );
      return null;
    }
  }

  private async stamp(
    dealId: Types.ObjectId,
    update: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.dealModel.updateOne({ _id: dealId }, { $set: update });
    } catch (error) {
      this.logger.error(
        `Failed to stamp audit telemetry on deal ${dealId.toString()}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
