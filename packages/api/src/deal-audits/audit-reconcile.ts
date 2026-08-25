import {
  DEFAULT_DEAL_AUDIT_STATUS,
  normalizeDealAuditStatus,
} from '@sfa/shared';
import type { DealAuditStatus } from '@sfa/shared';
import { Model, Types } from 'mongoose';
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
> {
  itemModel: Model<TItem>;
  dealAuditModel: Model<TAudit>;
  dealModel: Model<TDeal>;
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
 * paginates and renders the completion percentage from.
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
>(
  models: AuditReconcileModels<TItem, TAudit, TDeal>,
  agencyId: string,
): Promise<ReconcileAuditsResult> {
  const { itemModel, dealAuditModel, dealModel } = models;
  const result: ReconcileAuditsResult = {
    auditsCreated: 0,
    itemsLinked: 0,
    assigneesSet: 0,
    countersSynced: 0,
    statusesHealed: 0,
  };

  result.statusesHealed = await healRetiredResultField(
    dealAuditModel,
    agencyId,
  );

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

    await syncAuditCounters(itemModel, dealAuditModel, agencyId, audit._id);
    result.countersSynced++;
  }

  return result;
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
