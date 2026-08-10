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
  DealAuditItem,
  DealAuditItemDocument,
} from '../deal-audit-items/schemas/deal-audit-item.schema';
import { Deal, DealDocument } from '../deals/schemas/deal.schema';
import {
  buildDedupeKey,
  buildItemName,
  computeRequiredTitles,
  normalizeTitle,
  type RequiredAuditItem,
} from './audit-titles';

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
    @InjectModel(DealAuditItem.name)
    private readonly itemModel: Model<DealAuditItemDocument>,
    @InjectModel(DealAudit.name)
    private readonly dealAuditModel: Model<DealAuditDocument>,
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
      dealAuditStatus: 'Not Submitted',
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
      submissionToken: input.submissionToken ?? undefined,
      dedupeKey: buildDedupeKey(input.dealId.toString(), item),
      attachments: [],
      isTestRecord: false,
    };
  }

  /**
   * The roll-up record, one per deal.
   *
   * Non-unique index on `{agencyId, dealId}` — `DealAudit.legacyDealIds` is an
   * array, so migrated data may legitimately hold several per deal. `upsert`
   * with `$setOnInsert` keeps a re-run idempotent regardless.
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
            // Deliberately not Pass/Fail: nothing has been audited yet. The
            // finalize flow (out of scope) computes the real result.
            result: 'Pending',
            isTestRecord: false,
          },
        },
        { upsert: true, new: true },
      );
    } catch (error) {
      // A missing parent link is cosmetic — the items are what the board reads.
      this.logger.warn(
        `Could not upsert parent audit for deal ${input.dealId.toString()}: ${
          error instanceof Error ? error.message : String(error)
        }`,
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
