import { Model, Types } from 'mongoose';
import { DealAuditItem } from '../deal-audit-items/schemas/deal-audit-item.schema';
import { DealAudit } from './schemas/deal-audit.schema';

/*
 * Generic over the document type on purpose.
 *
 * The three callers hold their models in two different shapes —
 * `AuditGenerationService` injects `Model<DealAuditDocument>` while the
 * migration and the demo seed inject `Model<DealAuditItem>` — and `Model<T>` is
 * not assignable between them. Constraining to the schema class accepts both,
 * since `HydratedDocument<T>` includes `& T`.
 */

/** The roll-up figures `DealAudit` denormalizes from its items. */
export interface AuditCounters {
  itemCount: number;
  resolvedCount: number;
  openFailedCount: number;
  /** The same three over producer-actionable items only (PAC-106). */
  producerItemCount: number;
  producerResolvedCount: number;
  producerOpenCount: number;
  oldestOpenAt: Date | null;
  dueAt: Date | null;
}

const EMPTY: AuditCounters = {
  itemCount: 0,
  resolvedCount: 0,
  openFailedCount: 0,
  producerItemCount: 0,
  producerResolvedCount: 0,
  producerOpenCount: 0,
  oldestOpenAt: null,
  dueAt: null,
};

/**
 * "Open" means what the board has always meant by it: failed the audit and not
 * yet resolved. Written as `$ne: true` rather than `$eq: false` because a
 * migrated item may lack the flag entirely, and a missing `isResolved` is
 * unresolved.
 */
const IS_OPEN = {
  $and: [{ $eq: ['$isFailed', true] }, { $ne: ['$isResolved', true] }],
};

/**
 * Whether an item belongs on the producer's hand-off board (PAC-106) — the
 * aggregation twin of `isProducerActionable` in `@sfa/shared`.
 *
 * Producer-visible, **or** failed by the manager: a failed manager-only item
 * carries the note the producer has to act on. `$ne: false` rather than
 * `$eq: true` because a pre-PAC-106 item may lack the flag, and absent reads
 * as visible.
 *
 * ⚠ `audit-counters.unit-spec.ts` evaluates this expression against the shared
 * helper on every combination. Change both or neither.
 */
export const IS_PRODUCER_ACTIONABLE = {
  $or: [
    { $ne: ['$producerVisible', false] },
    { $eq: ['$reviewVerdict', 'fail'] },
  ],
};

/**
 * Recompute one audit's denormalized counters from its items (PAC-72).
 *
 * These exist so the hand-off board can **sort and paginate deals server-side**
 * — an aggregation over `dealAuditItems` cannot do that and stay index-backed,
 * because the data-scope clamp lives on the audit — and because the completion
 * percentage needs a stored denominator at all. `Deal.auditItemCount` held a
 * total nothing read, and a resolved count was stored nowhere.
 *
 * Called after generation, after every resolve, and after every review write
 * (verdict, send-back, resubmission — PAC-106). Also the recompute for drift:
 * it derives everything from the items, so running it again is always safe and
 * always converges.
 *
 * A single aggregation rather than four `countDocuments` calls — this runs on
 * the resolve path, which a user is waiting on.
 */
export async function syncAuditCounters<
  TItem extends DealAuditItem,
  TAudit extends DealAudit,
>(
  itemModel: Model<TItem>,
  dealAuditModel: Model<TAudit>,
  agencyId: string,
  dealAuditId: Types.ObjectId,
): Promise<AuditCounters> {
  const rows = await itemModel.aggregate<AuditCounters & { _id: null }>([
    { $match: { agencyId, dealAuditId } },
    {
      $group: {
        _id: null,
        itemCount: { $sum: 1 },
        resolvedCount: {
          $sum: { $cond: [{ $eq: ['$isResolved', true] }, 1, 0] },
        },
        openFailedCount: { $sum: { $cond: [IS_OPEN, 1, 0] } },
        producerItemCount: {
          $sum: { $cond: [IS_PRODUCER_ACTIONABLE, 1, 0] },
        },
        producerResolvedCount: {
          $sum: {
            $cond: [
              {
                $and: [IS_PRODUCER_ACTIONABLE, { $eq: ['$isResolved', true] }],
              },
              1,
              0,
            ],
          },
        },
        producerOpenCount: {
          $sum: {
            $cond: [{ $and: [IS_PRODUCER_ACTIONABLE, IS_OPEN] }, 1, 0],
          },
        },
        /*
         * `$min` skips nulls, so the `$cond`'s null branch removes resolved
         * items from consideration rather than dragging the minimum to
         * epoch. `firstCreatedAt` falls back to `createdAt` for the same
         * reason `DealAuditsService` does on read: migrated items carry one
         * and app-created items the other.
         */
        oldestOpenAt: {
          $min: {
            $cond: [
              IS_OPEN,
              { $ifNull: ['$firstCreatedAt', '$createdAt'] },
              null,
            ],
          },
        },
        dueAt: { $min: { $cond: [IS_OPEN, '$dueAt', null] } },
      },
    },
  ]);

  const counters: AuditCounters = rows[0]
    ? {
        itemCount: rows[0].itemCount,
        resolvedCount: rows[0].resolvedCount,
        openFailedCount: rows[0].openFailedCount,
        producerItemCount: rows[0].producerItemCount,
        producerResolvedCount: rows[0].producerResolvedCount,
        producerOpenCount: rows[0].producerOpenCount,
        oldestOpenAt: rows[0].oldestOpenAt ?? null,
        dueAt: rows[0].dueAt ?? null,
      }
    : EMPTY;

  await dealAuditModel.updateOne({ _id: dealAuditId }, { $set: counters });
  return counters;
}

/**
 * Completion as a whole percentage, 0–100.
 *
 * An audit with no items reads as **100%** rather than 0: nothing was required,
 * so nothing is outstanding. Showing "0% complete" on a deal that needs no
 * documents would send the service team chasing a client for nothing.
 */
export function completionPercent(counters: {
  itemCount: number;
  resolvedCount: number;
}): number {
  if (counters.itemCount <= 0) return 100;
  const pct = Math.round((counters.resolvedCount / counters.itemCount) * 100);
  // Clamped because the inputs are denormalized and can drift between a resolve
  // and the next recompute. A progress bar rendering 250% is a visible bug in a
  // place nobody would think to look for one.
  return Math.min(100, Math.max(0, pct));
}
