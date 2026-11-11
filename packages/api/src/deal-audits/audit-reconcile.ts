import {
  DEFAULT_DEAL_AUDIT_STATUS,
  normalizeDealAuditStatus,
} from '@sfa/shared';
import type { DealAuditStatus } from '@sfa/shared';
import { Model, Types } from 'mongoose';
import { AuditTemplate } from '../audit-templates/schemas/audit-template.schema';
import { DealAuditItem } from '../deal-audit-items/schemas/deal-audit-item.schema';
import { Deal } from '../deals/schemas/deal.schema';
import { syncAuditCounters } from './audit-counters';
import { DealAudit } from './schemas/deal-audit.schema';

export interface ReconcileAuditsResult {
  /** Deals that had items but no roll-up record. */
  auditsCreated: number;
  /** Items that gained a `dealAuditId` link. */
  itemsLinked: number;
  /** Roll-ups that gained a default assignee. */
  assigneesSet: number;
  /** Roll-ups whose counters were recomputed. */
  countersSynced: number;
  /** Roll-ups migrated off the retired `result` field. */
  statusesHealed: number;
  /**
   * Items on an audit not yet approved whose `producerVisible` /
   * `requiresUpload` were re-copied from their template (PAC-106 review).
   */
  flagsRestamped: number;
  /**
   * `Not Submitted` audits with nothing for the producer to provide, handed to
   * the reviewer (PAC-106) — the rule `AuditGenerationService` applies to a
   * new sale.
   */
  autoSubmitted: number;
}

/**
 * Models this pass touches, grouped so the signature stays readable.
 *
 * Generic over the document type for the same reason as `syncAuditCounters` —
 * the migration and demo seed inject class-typed models, the runtime services
 * hydrated ones, and `Model<T>` is not assignable between the two.
 */
export interface AuditReconcileModels<
  TItem extends DealAuditItem = DealAuditItem,
  TAudit extends DealAudit = DealAudit,
  TDeal extends Deal = Deal,
  TTemplate extends AuditTemplate = AuditTemplate,
> {
  itemModel: Model<TItem>;
  dealAuditModel: Model<TAudit>;
  dealModel: Model<TDeal>;
  /** When given, open items are re-stamped from it — see {@link restampTemplateFlags}. */
  templateModel?: Model<TTemplate>;
}

/**
 * Make migrated audit data usable by the PAC-72 hand-off board.
 *
 * The migration imports `dealAuditItems` **before** `dealAudits` (items are
 * fetched from one SmartSuite table, roll-ups from another), so at import time
 * an item cannot know its parent's `_id`. Legacy also has no notion of an audit
 * assignee at all. Both gaps are invisible until the board is queried, at which
 * point every migrated deal is either missing or unreachable.
 *
 * Three fixes, all derived from data already in Mongo:
 *
 * 1. **A roll-up per deal that has items.** SmartSuite's Deal Audits table is
 *    sparse — plenty of deals have checklist items and no audit record. The
 *    board pages over roll-ups, so those deals would simply not exist to it.
 * 2. **`dealAuditId` on every item**, which is how the board loads a card's
 *    checklist.
 * 3. **A default `auditAssignee`** — the deal's producer. The board scopes on
 *    the assignee, so an unassigned audit reaches nobody.
 *
 * Then recomputes each roll-up's counters, which is what the board sorts,
 * paginates and renders the completion percentage from — after re-stamping
 * open items' flags from their templates, when given the template model.
 *
 * Idempotent and derived entirely from Mongo: it needs no SmartSuite
 * credentials and is safe to re-run. It is also the recompute for counter
 * drift. Modelled on `reconcileHouseholdRefs`, which the migration calls at the
 * end of its household pass for the same reason.
 */
export async function reconcileDealAudits<
  TItem extends DealAuditItem,
  TAudit extends DealAudit,
  TDeal extends Deal,
  TTemplate extends AuditTemplate,
>(
  models: AuditReconcileModels<TItem, TAudit, TDeal, TTemplate>,
  agencyId: string,
): Promise<ReconcileAuditsResult> {
  const { itemModel, dealAuditModel, dealModel, templateModel } = models;
  const result: ReconcileAuditsResult = {
    auditsCreated: 0,
    itemsLinked: 0,
    assigneesSet: 0,
    countersSynced: 0,
    statusesHealed: 0,
    flagsRestamped: 0,
    autoSubmitted: 0,
  };

  result.statusesHealed = await healRetiredResultField(
    dealAuditModel,
    agencyId,
  );

  // Before the counters below, which then count the re-stamped flags.
  if (templateModel) {
    result.flagsRestamped = await restampTemplateFlags(
      itemModel,
      dealAuditModel,
      templateModel,
      agencyId,
    );
  }

  const dealIds = (await itemModel.distinct('dealId', {
    agencyId,
    dealId: { $ne: null },
  })) as Types.ObjectId[];

  for (const dealId of dealIds) {
    // `$setOnInsert` so a roll-up the migration already imported keeps its
    // legacy title, audit date and verdict.
    const audit = await dealAuditModel.findOneAndUpdate(
      { agencyId, dealId },
      {
        $setOnInsert: {
          agencyId,
          // Mirrors the deal's branch; an audit is never in a different one.
          branchId: await branchIdFor(dealModel, dealId),
          dealId,
          auditDate: new Date(),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    if (!audit) continue;

    // `upsert` gives no direct "did it insert" signal on this driver path;
    // an audit with no legacy id is one this pass created.
    if (!audit.legacySmartSuiteId) result.auditsCreated++;

    const linked = await itemModel.updateMany(
      { agencyId, dealId, dealAuditId: { $in: [null, undefined] } },
      { $set: { dealAuditId: audit._id } },
    );
    result.itemsLinked += linked.modifiedCount ?? 0;

    if (!audit.auditAssignee) {
      const producerId = await producerIdFor(dealModel, dealId);
      if (producerId) {
        await dealAuditModel.updateOne(
          { _id: audit._id },
          { $set: { auditAssignee: { type: 'user', id: producerId } } },
        );
        result.assigneesSet++;
      }
    }

    const counters = await syncAuditCounters(
      itemModel,
      dealAuditModel,
      agencyId,
      audit._id,
    );
    result.countersSynced++;

    /*
     * Nothing for the producer to provide → with the reviewer (PAC-106). A
     * migrated audit of only manager-only items would otherwise sit at
     * `Not Submitted`, off the producer's board and waiting on a submit nobody
     * will click. Guarded on the status, so a re-run is a no-op.
     */
    if (counters.producerItemCount === 0) {
      const flipped = await dealAuditModel.updateOne(
        { _id: audit._id, auditStatus: DEFAULT_DEAL_AUDIT_STATUS },
        {
          $set: {
            auditStatus: 'Pending',
            submittedAt: new Date(),
            submittedById: null,
          },
        },
      );
      if (flipped.modifiedCount > 0) {
        await dealModel.updateOne(
          { _id: dealId },
          { $set: { dealAuditStatus: 'Pending' } },
        );
        result.autoSubmitted++;
      }
    }
  }

  return result;
}

/**
 * Re-copy `producerVisible` / `requiresUpload` from each template onto the
 * items generated from it, on every audit not yet approved (PAC-106 review).
 *
 * The flags are **copied** onto an item at generation (so the board filters
 * without joining the catalog), and nothing re-syncs them afterwards. That is a
 * deliberate trade, but it means a template change — David has revised that
 * table twice — leaves every item already raised on the old flag. This is the
 * lever: change the template, re-run the reconcile, and the in-flight items
 * follow; the counters and the auto-submit below then act on the new flags.
 *
 * - **By `templateId`**, so only app-generated items. A migrated item has none
 *   and takes its flags from its name (`auditItemFlagsForName`), which the
 *   PAC-106 migration applied.
 * - **Approved audits are left alone.** Their items are history, and moving
 *   one onto or off the producer's board would rewrite a closed audit.
 * - Only items whose flags actually differ are written, so a re-run is free.
 */
async function restampTemplateFlags<
  TItem extends DealAuditItem,
  TAudit extends DealAudit,
  TTemplate extends AuditTemplate,
>(
  itemModel: Model<TItem>,
  dealAuditModel: Model<TAudit>,
  templateModel: Model<TTemplate>,
  agencyId: string,
): Promise<number> {
  const templates = await templateModel
    .find({ agencyId })
    .select('producerVisible requiresUpload')
    .lean<
      Array<{
        _id: Types.ObjectId;
        producerVisible?: boolean;
        requiresUpload?: boolean;
      }>
    >();
  if (!templates.length) return 0;

  const openAuditIds = (await dealAuditModel.distinct('_id', {
    agencyId,
    auditStatus: { $ne: 'Pass' },
  })) as Types.ObjectId[];
  if (!openAuditIds.length) return 0;

  let restamped = 0;
  for (const template of templates) {
    // A template missing a flag predates PAC-106 — visible, no file, the
    // generator's own fallback.
    const flags = {
      producerVisible: template.producerVisible ?? true,
      requiresUpload: template.requiresUpload ?? false,
    };
    const updated = await itemModel.updateMany(
      {
        agencyId,
        templateId: template._id,
        dealAuditId: { $in: openAuditIds },
        $or: [
          { producerVisible: { $ne: flags.producerVisible } },
          { requiresUpload: { $ne: flags.requiresUpload } },
        ],
      },
      { $set: flags },
    );
    restamped += updated.modifiedCount ?? 0;
  }
  return restamped;
}

/**
 * The retired `result` value → a workflow state.
 *
 * ⚠ `'Pending'` maps to **`Not Submitted`**, not to `Pending`, and the
 * difference is not cosmetic. SmartSuite's `Result` select has exactly two
 * choices, `Pass` and `Fail` — so a stored `'Pending'` can only have come from
 * the pre-PAC-72 generator, where it was a sentinel meaning *"nothing has been
 * audited yet"*. In the new vocabulary `Pending` means the opposite: "submitted,
 * sitting with the reviewer". Passing it through {@link normalizeDealAuditStatus}
 * unchanged would put a pile of never-submitted audits in front of a reviewer.
 */
function statusFromRetiredResult(result?: string): DealAuditStatus {
  if (result === 'Pending') return DEFAULT_DEAL_AUDIT_STATUS;
  return normalizeDealAuditStatus(result);
}

/**
 * Fold the retired `result` field into `auditStatus`, then remove it.
 *
 * `DealAudit.result` was a `Pass`/`Fail` single-select — a strict subset of the
 * four workflow states — so PAC-72 folded it in rather than keeping two fields
 * answering the same question. Two populations still carry the old shape:
 * documents written by the pre-PAC-72 generator (which stamped
 * `result: 'Pending'`), and anything imported before the migration was updated.
 *
 * Both are **invisible failures** without this. An audit with no `auditStatus`
 * matches none of the board's status filters, so the deal silently disappears;
 * and a lingering `result` is a second source of truth that will drift.
 *
 * Mongoose strips unknown paths from a `$set` under strict mode, so `result` is
 * read through a lean projection and cleared with an explicit `$unset` — the
 * schema no longer declares it, and the ODM would otherwise refuse to touch it.
 */
async function healRetiredResultField<TAudit extends DealAudit>(
  dealAuditModel: Model<TAudit>,
  agencyId: string,
): Promise<number> {
  const stale = await dealAuditModel
    .find({ agencyId, auditStatus: { $exists: false } })
    .select('result')
    .lean<Array<{ _id: Types.ObjectId; result?: string }>>();

  for (const audit of stale) {
    await dealAuditModel.updateOne(
      { _id: audit._id },
      { $set: { auditStatus: statusFromRetiredResult(audit.result) } },
    );
  }

  // Everything in the agency, not just the healed rows: a document that already
  // had `auditStatus` may still be carrying the dead field alongside it.
  await dealAuditModel.collection.updateMany(
    { agencyId, result: { $exists: true } },
    { $unset: { result: '' } },
  );

  return stale.length;
}

/** The deal's branch, or `''` when the deal has vanished — never undefined. */
async function branchIdFor<TDeal extends Deal>(
  dealModel: Model<TDeal>,
  dealId: Types.ObjectId,
): Promise<string> {
  const deal = await dealModel
    .findById(dealId)
    .select('branchId')
    .lean<{ branchId?: string }>();
  return deal?.branchId ?? '';
}

/** The deal's selling producer, if it has one. */
async function producerIdFor<TDeal extends Deal>(
  dealModel: Model<TDeal>,
  dealId: Types.ObjectId,
): Promise<Types.ObjectId | null> {
  const deal = await dealModel
    .findById(dealId)
    .select('producerId')
    .lean<{ producerId?: Types.ObjectId }>();
  return deal?.producerId ?? null;
}
