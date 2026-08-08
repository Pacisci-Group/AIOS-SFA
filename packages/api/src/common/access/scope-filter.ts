import { AccessContext, DataScope } from '@sfa/shared';
import { FilterQuery, Types } from 'mongoose';

export interface ScopeFilterOptions {
  /**
   * The client's *voluntary* narrowing — the My/Agency toggle. Never widens:
   * `agency` is a request to skip the producer pin, which is only honoured for
   * a caller whose `DataScope` already reaches that far.
   */
  requestedScope?: 'own' | 'agency';

  /** Narrow to one producer, within whatever the caller may already see. */
  producerId?: string;

  /**
   * The owning-user field on the collection. Defaults to `producerId`; every
   * collection this serves today uses that name.
   */
  producerField?: string;

  /**
   * Drop `isTestRecord` documents. On by default — every tenant collection
   * carries the flag and no producer-facing surface wants them. Pass `false`
   * only for a collection that genuinely lacks the field.
   */
  excludeTestRecords?: boolean;
}

/**
 * Build the tenancy + data-scope clamp that every producer-facing read starts
 * from. The returned object is a `find()` filter *and* an aggregation `$match`
 * — there is deliberately no second function for pipelines.
 *
 * A client-supplied `requestedScope`/`producerId` can only ever **narrow** the
 * result set:
 *
 * - `own`    — pinned to the caller. `requestedScope: 'agency'` and a foreign
 *              `producerId` are silently ignored rather than rejected, so a
 *              stale tab or a tampered query returns the caller's own rows
 *              instead of an error or (as in legacy) somebody else's.
 * - `branch` — pinned to the caller's branch; `producerId` applies *within* it.
 * - `agency` — pinned to the agency; `producerId` applies within it.
 *
 * `requestedScope: 'own'` is honoured at every level, since narrowing is always
 * safe.
 *
 * **The type asymmetry is the reason this is a function and not a snippet.**
 * `agencyId` and `branchId` are `string`s on `TenantRecord`, while `producerId`
 * is an `ObjectId`. Comparing the wrong one silently matches zero documents —
 * an empty scorecard reads as "no sales this month", not as a bug. Callers
 * should not be re-deriving that by hand.
 *
 * Extracted per the precedent set by `LeadAccessService`: the rule was
 * hand-duplicated in two services and about to acquire four more call sites.
 *
 * One deliberate non-caller: `LeaderboardService` reads agency-wide regardless
 * of `DataScope`, because a producer must see the office total and other
 * producers' ranks. See its docblock — that bypass is the product requirement,
 * not an oversight.
 */
export function buildScopeFilter<T>(
  access: AccessContext,
  branchId: string | null,
  options: ScopeFilterOptions = {},
): FilterQuery<T> {
  const {
    requestedScope,
    producerId,
    producerField = 'producerId',
    excludeTestRecords = true,
  } = options;

  const filter: Record<string, unknown> = { agencyId: access.agencyId };
  if (excludeTestRecords) {
    filter.isTestRecord = { $ne: true };
  }

  const self = new Types.ObjectId(access.userId);

  if (access.dataScope === DataScope.Own) {
    // `own` scope is only meaningful with a concrete user id, and nothing the
    // client sends can loosen it.
    filter[producerField] = self;
    return filter;
  }

  if (access.dataScope === DataScope.Branch && branchId) {
    // Conditional on a resolved branch: an agency-scoped account acting without
    // a branch header must not silently fall through to *no* narrowing here.
    filter.branchId = branchId;
  }
  // Agency scope: no producer/branch narrowing beyond agencyId.

  if (requestedScope === 'own') {
    filter[producerField] = self;
    return filter;
  }

  if (producerId && Types.ObjectId.isValid(producerId)) {
    // Kept alongside the branch clamp above, so a branch-scoped caller cannot
    // reach a producer outside their branch.
    filter[producerField] = new Types.ObjectId(producerId);
  }

  return filter;
}
