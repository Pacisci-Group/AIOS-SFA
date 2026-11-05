import { ForbiddenException } from '@nestjs/common';
import {
  DataScope,
  modulePermission,
  ModuleKey,
  type AccessContext,
} from '@sfa/shared';
import { Types, type FilterQuery } from 'mongoose';
import { buildScopeFilter } from '../common/access/scope-filter';
import type { PayStatement } from './schemas/pay-statement.schema';

/**
 * Who may see whose pay (PAC-176 decision, recorded on PAC-178 and in
 * AGENTS.md).
 *
 * **`payouts:read` is the employee's permission: their own statements, and
 * only once sent.** It is *not* scoped by the role's data scope — CRM
 * (branch) and Data Team (agency) hold it too, and data scope would let them
 * read colleagues' pay. Seeing anyone else's statement needs
 * **`payouts:write`**, the reviewer's permission, and that one is scoped as
 * every other read is: a branch manager sees their branch, the owner the
 * agency.
 */

export function agencyOf(access: AccessContext): string {
  if (!access.agencyId) {
    throw new ForbiddenException('Agency context required');
  }
  return access.agencyId;
}

/** May the caller see other people's statements (in their data scope)? */
export function readsOthersPay(access: AccessContext): boolean {
  return access.permissions.includes(
    modulePermission(ModuleKey.Payouts, 'write'),
  );
}

/** The employee rule: one's own statements, never a draft. */
export function ownStatements(
  access: AccessContext,
): FilterQuery<PayStatement> {
  return {
    agencyId: agencyOf(access),
    userId: new Types.ObjectId(access.userId),
    status: { $ne: 'draft' },
  };
}

/**
 * The statements the caller may see. `mine` asks for the employee view
 * whatever else the caller may see — My Pay is the same page for a branch
 * manager as for a producer.
 */
export function statementVisibility(
  access: AccessContext,
  branchId: string | null,
  options: { mine?: boolean } = {},
): FilterQuery<PayStatement> {
  if (options.mine || !readsOthersPay(access)) return ownStatements(access);
  return buildScopeFilter<PayStatement>(access, branchId, {
    producerField: 'userId',
    excludeTestRecords: false,
  });
}

/**
 * May the caller open `user`'s activity (PAC-179)? Their own, always; anyone
 * else's only with `payouts:write`, within their data scope.
 *
 * `'forbidden'` — another person without the permission (403, the ticket's
 * "own or 403"); `'out_of_scope'` — someone the caller's scope does not
 * reach (404, as for a statement).
 */
export function activityAccess(
  access: AccessContext,
  branchId: string | null,
  user: { _id: Types.ObjectId; branchId?: Types.ObjectId | null },
): 'ok' | 'forbidden' | 'out_of_scope' {
  if (String(user._id) === access.userId) return 'ok';
  if (!readsOthersPay(access)) return 'forbidden';
  switch (access.dataScope) {
    case DataScope.Agency:
      return 'ok';
    case DataScope.Branch:
      return branchId && user.branchId && String(user.branchId) === branchId
        ? 'ok'
        : 'out_of_scope';
    default:
      return 'out_of_scope';
  }
}
