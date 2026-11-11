import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  AgencyPermission,
  DataScope,
  modulePermission,
  ModuleKey,
  PAYOUT_STATEMENT_NOT_SENT,
  PAYOUT_STATEMENT_NOT_YOURS,
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
 * A reviewer sees what their scope reaches **and their own sent statements
 * wherever they are** (PAC-182): a statement keeps the branch it was
 * computed in, so a branch manager who moved branch would otherwise list
 * their own in My Pay and get a 404 opening it — and could never answer it.
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
  const visible = readsOthersPay(access)
    ? { $or: [statementVisibility(access, branchId), ownStatements(access)] }
    : statementVisibility(access, branchId);
  const query = model.findOne({ ...visible, _id: new Types.ObjectId(id) });
  if (projection) query.select(projection);
  const doc = await query.lean<
    (PayStatement & { _id: Types.ObjectId }) | null
  >();
  if (!doc) throw new NotFoundException('Statement not found');
  return doc;
}

/**
 * The caller's own **sent** statement, for the employee's answer — accept
 * or dispute (PAC-182). Only the person it is for answers it: a reviewer who
 * can see someone else's statement gets a 403 `PAYOUT_STATEMENT_NOT_YOURS`
 * (`agency:payouts:admin` too — an answer is a signature); one they cannot
 * see is a 404, as everywhere. Their own statement in any other status is a
 * 409 `PAYOUT_STATEMENT_NOT_SENT`.
 */
export async function loadOwnSentStatement(
  model: Model<PayStatement>,
  access: AccessContext,
  branchId: string | null,
  id: string,
): Promise<PayStatement & { _id: Types.ObjectId }> {
  const doc = await model
    .findOne({ ...ownStatements(access), _id: new Types.ObjectId(id) })
    .lean<(PayStatement & { _id: Types.ObjectId }) | null>();
  if (!doc) {
    // Not among their own non-drafts: someone else's they may see (403), a
    // draft of their own a reviewer can see (409), or nothing (404).
    const seen = await loadVisibleStatement(model, access, branchId, id, {
      userId: 1,
    });
    if (String(seen.userId) === access.userId) throw notSentToAnswer();
    throw new ForbiddenException({
      code: PAYOUT_STATEMENT_NOT_YOURS,
      message: 'Only the person a statement is for can accept or dispute it.',
    });
  }
  if (doc.status !== 'sent') throw notSentToAnswer(doc.status);
  return doc;
}

function notSentToAnswer(status?: PayStatement['status']): ConflictException {
  return new ConflictException({
    code: PAYOUT_STATEMENT_NOT_SENT,
    message:
      status === 'accepted'
        ? 'You have already accepted this statement.'
        : status === 'rejected'
          ? 'You have disputed this statement. It will be sent to you again once it is corrected.'
          : 'This statement has not been sent to you yet.',
  });
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
