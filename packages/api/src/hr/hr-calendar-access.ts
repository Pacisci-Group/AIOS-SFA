import { AgencyPermission, DataScope, type AccessContext } from '@sfa/shared';
import type { FilterQuery } from 'mongoose';
import {
  coversBranch,
  holdsReview,
} from '../time-off-requests/time-off-access';

/**
 * Whose time off a caller sees on the HR calendar (PAC-169).
 *
 * Everyone with `hr:read` gets the page and **their own** leave. Other
 * people's leave is a separate, dedicated permission — `agency:hr:team_calendar`
 * (decided 2026-11-06: not `hr:write`; knowing who is out next week is not
 * the job of deciding their requests). The rule:
 *
 * - **Without the permission a caller sees only their own leave**, whatever
 *   their data scope. A CRM (branch scope) or Data Team (agency scope) user
 *   holds neither by default.
 * - With it, a caller sees the **Approved** leave of the requests whose
 *   stamped branch their data scope covers: every branch for `agency`, their
 *   own for `branch`, none for `own` — and none for a branch-scoped user with
 *   no branch. The same reach `hr:write` has over the team list
 *   (`time-off-access.ts`), from the same `coversBranch`.
 * - **Pending** requests (Submitted, Changes Requested) of other people need
 *   `hr:write` as well: an undecided request is the reviewer's business.
 *
 * `buildScopeFilter` is not used, for the reasons `time-off-access.ts` gives.
 */

type Scoped = Pick<AccessContext, 'permissions' | 'dataScope' | 'branchId'>;

export function holdsTeamCalendar(
  access: Pick<AccessContext, 'permissions'>,
): boolean {
  return access.permissions.includes(AgencyPermission.HrTeamCalendar);
}

/**
 * The branch clause for other people's leave, or `null` when the caller
 * sees nobody else — in which case the layer is their own leave only, not
 * unfiltered.
 */
export function teamLeaveFilter(
  access: Scoped,
): FilterQuery<{ branchId: string }> | null {
  if (!holdsTeamCalendar(access)) return null;
  if (access.dataScope === DataScope.Agency) return {};
  if (access.dataScope === DataScope.Branch && access.branchId) {
    return { branchId: access.branchId };
  }
  return null;
}

/** `access` sees the Approved leave of a request stamped with `branchId`. */
export function seesTeamLeave(
  access: Scoped,
  branchId: string | null | undefined,
): boolean {
  return (
    holdsTeamCalendar(access) &&
    coversBranch(access.dataScope, access.branchId, branchId)
  );
}

/** Other people's undecided requests are included for this caller. */
export function seesTeamPending(access: Scoped): boolean {
  return teamLeaveFilter(access) !== null && holdsReview(access);
}
