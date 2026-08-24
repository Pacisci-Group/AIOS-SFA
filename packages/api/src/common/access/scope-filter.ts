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
   * **Polymorphic** ownership: the owner is a `{ type: 'user' | 'role', id }`
   * sub-document rather than a bare user ref (PAC-72's `DealAudit.auditAssignee`).
   * Pass the sub-document's path, e.g. `'auditAssignee'`.
   *
   * Takes precedence over {@link producerField} when both are set.
   *
   * ⚠ **The emitted clause deliberately ignores `.type`.** PAC-72 specifies
   * `{ $or: [ {type:'user', id: me}, {type:'role', id: {$in: myRoleIds}} ] }`,
   * and this emits `{ '<path>.id': { $in: [me, ...myRoleIds] } }` instead. The
   * two are equivalent — an ObjectId is unique across collections, so a role's
   * `_id` can never collide with a user's, which is exactly why the ticket
   * insisted `id` is always an ObjectId and never a role slug. Matching on the
   * id alone cannot widen the result: every id in the `$in` is one the caller
   * already owns.
   *
   * Preferred over the `$or` because it is a single-field predicate — it rides
   * the `{ agencyId, '<path>.id', … }` index as one IXSCAN instead of an index
   * union, and it leaves the top-level `$or` free for callers, who would
   * otherwise silently clobber the tenancy clamp by spreading their own.
   *
   * `.type` remains the field that says *how* to render the owner ("the CRM
   * team" vs "Pat Producer"); it is simply not load-bearing for access.
   */
  ownerField?: { path: string; polymorphic: true };

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
 * Ownership comes in two shapes. Most collections carry a scalar producer ref
 * ({@link ScopeFilterOptions.producerField}); `dealAudits` carries a
 * `{ type, id }` sub-document so an audit can belong to a *role* as well as a
 * user ({@link ScopeFilterOptions.ownerField}). Both are handled here rather
 * than by letting the board hand-roll its own clamp — which is the whole
 * reason this function exists.
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
    ownerField,
    excludeTestRecords = true,
  } = options;

  const filter: Record<string, unknown> = { agencyId: access.agencyId };
  if (excludeTestRecords) {
    filter.isTestRecord = { $ne: true };
  }

  const self = new Types.ObjectId(access.userId);

  /**
   * The "owned by the caller" clause, in whichever shape this collection uses.
   * Scalar collections pin the producer ref; polymorphic ones match the caller
   * *or* any role they hold — see {@link ScopeFilterOptions.ownerField}.
   */
  const pinToSelf = (target: Record<string, unknown>): void => {
    if (!ownerField) {
      target[producerField] = self;
      return;
    }
    const owners = [
      self,
      ...access.roleIds
        .filter((roleId) => Types.ObjectId.isValid(roleId))
        .map((roleId) => new Types.ObjectId(roleId)),
    ];
    target[`${ownerField.path}.id`] = { $in: owners };
  };

  /** Narrow to one *user* — never a role, which is a queue, not a person. */
  const pinToUser = (target: Record<string, unknown>, id: string): void => {
    const oid = new Types.ObjectId(id);
    if (!ownerField) {
      target[producerField] = oid;
      return;
    }
    target[`${ownerField.path}.type`] = 'user';
    target[`${ownerField.path}.id`] = oid;
  };

  if (access.dataScope === DataScope.Own) {
    // `own` scope is only meaningful with a concrete user id, and nothing the
    // client sends can loosen it.
    pinToSelf(filter);
    return filter;
  }

  if (access.dataScope === DataScope.Branch && branchId) {
    // Conditional on a resolved branch: an agency-scoped account acting without
    // a branch header must not silently fall through to *no* narrowing here.
    filter.branchId = branchId;
  }
  // Agency scope: no producer/branch narrowing beyond agencyId.

  if (requestedScope === 'own') {
    pinToSelf(filter);
    return filter;
  }

  if (producerId && Types.ObjectId.isValid(producerId)) {
    // Kept alongside the branch clamp above, so a branch-scoped caller cannot
    // reach a producer outside their branch.
    pinToUser(filter, producerId);
  }

  return filter;
}
