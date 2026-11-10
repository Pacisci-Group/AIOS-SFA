import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  AgencyPermission,
  DataScope,
  modulePermission,
  ModuleKey,
  PAYOUT_STATEMENT_OWN_STATEMENT,
  type AccessContext,
} from '@sfa/shared';
import { Types, type FilterQuery, type Model } from 'mongoose';
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
 * One statement the caller may see, or a 404 — never a 403, so whether a
 * statement exists is not given away. Every statement route starts here.
 *
 * `projection` reads only the fields a route needs (an inclusion
 * projection): the result then carries those fields and `_id` alone, so the
 * caller must list every field it reads.
 */
export async function loadVisibleStatement(
  model: Model<PayStatement>,
  access: AccessContext,
  branchId: string | null,
  id: string,
  projection?: Partial<Record<keyof PayStatement, 1>>,
): Promise<PayStatement & { _id: Types.ObjectId }> {
  const query = model.findOne({
    ...statementVisibility(access, branchId),
    _id: new Types.ObjectId(id),
  });
  if (projection) query.select(projection);
  const doc = await query.lean<
    (PayStatement & { _id: Types.ObjectId }) | null
  >();
  if (!doc) throw new NotFoundException('Statement not found');
  return doc;
}

/**
 * May the caller issue this statement — send, reopen or recalculate it? Not
 * their own without `agency:payouts:admin` (PAC-181 review fixes): what it
 * says is their pay, so someone else decides it — the rule
 * `updateInputs` already applied to the figures (`PAYOUT_STATEMENT_OWN_INPUTS`).
 */
export function issuesOwnStatement(
  access: AccessContext,
  statement: { userId: Types.ObjectId | string },
): boolean {
  return (
    String(statement.userId) === access.userId &&
    !access.permissions.includes(AgencyPermission.PayoutsAdmin)
  );
}

/** 403 `PAYOUT_STATEMENT_OWN_STATEMENT` — see `issuesOwnStatement`. */
export function assertNotOwnStatement(
  access: AccessContext,
  statement: { userId: Types.ObjectId | string },
): void {
  if (issuesOwnStatement(access, statement)) {
    throw new ForbiddenException({
      code: PAYOUT_STATEMENT_OWN_STATEMENT,
      message:
        'Someone else sends, reopens and recalculates your own statement.',
    });
  }
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
