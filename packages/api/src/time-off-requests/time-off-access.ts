import {
  DataScope,
  ModuleKey,
  modulePermission,
  type AccessContext,
} from '@sfa/shared';
import type { FilterQuery } from 'mongoose';

/**
 * Who may see and decide whose time off (PAC-165).
 *
 * `buildScopeFilter` is not used for this collection, on purpose. It takes
 * no permission — so a CRM (branch scope) or Data Team (agency scope) user
 * holding only `hr:read` would read a whole branch's or agency's requests
 * through it — and it skips the branch clamp when the caller has no branch,
 * which under `@SkipBranch()` (no `BranchGuard` 403 in front) reads
 * agency-wide. Both are the wrong default for people's leave.
 *
 * The rule here instead:
 *
 * - **Without `hr:write` a caller sees only their own requests**, whatever
 *   their data scope.
 * - With it, a caller reviews the requests whose **stamped branch** their
 *   data scope covers: every branch for `agency`, their own for `branch`,
 *   none for `own` — and none for a branch-scoped user with no branch.
 * - Never their own. That one is the service's to enforce per request.
 */

/** The reviewer capability: the HR module's write permission. */
export const HR_REVIEW_PERMISSION = modulePermission(ModuleKey.Hr, 'write');

export function holdsReview(
  access: Pick<AccessContext, 'permissions'>,
): boolean {
  return access.permissions.includes(HR_REVIEW_PERMISSION);
}

/**
 * Whether a data scope reaches a branch. `own` reaches nobody else's
 * records, and a branch scope with no branch of its own reaches nothing —
 * never "everything".
 */
export function coversBranch(
  dataScope: DataScope,
  viewerBranchId: string | null | undefined,
  branchId: string | null | undefined,
): boolean {
  if (dataScope === DataScope.Agency) return true;
  if (dataScope !== DataScope.Branch) return false;
  return (
    Boolean(viewerBranchId) && Boolean(branchId) && viewerBranchId === branchId
  );
}

/** `access` may review requests stamped with `branchId`. */
export function reviewsBranch(
  access: Pick<AccessContext, 'permissions' | 'dataScope' | 'branchId'>,
  branchId: string | null | undefined,
): boolean {
  return (
    holdsReview(access) &&
    coversBranch(access.dataScope, access.branchId, branchId)
  );
}

/**
 * The branch clause of the team list, or `null` when the caller reviews
 * nothing — in which case the list is empty, not unfiltered.
 */
export function reviewScopeFilter(
  access: Pick<AccessContext, 'permissions' | 'dataScope' | 'branchId'>,
): FilterQuery<{ branchId: string }> | null {
  if (!holdsReview(access)) return null;
  if (access.dataScope === DataScope.Agency) return {};
  if (access.dataScope === DataScope.Branch && access.branchId) {
    return { branchId: access.branchId };
  }
  return null;
}
