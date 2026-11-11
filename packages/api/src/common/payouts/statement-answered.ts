import { Types, type Model } from 'mongoose';
import type { NotificationRequestedData } from '../../inngest/events';
import {
  activeRoleHolders,
  type RoleHolderModels,
} from '../../permissions/role-holders';
import type { UserDocument } from '../../users/schemas/user.schema';
import { monthLabel } from './month-window';

/**
 * The employee's answer to a statement (PAC-182): `payouts.statement_rejected`
 * when they dispute it, `payouts.statement_accepted` when they accept it.
 */

/**
 * Who hears an employee's answer: the branch managers of the statement's
 * branch — the reviewers whose scope reaches it — else, when it has none or
 * none is left once the employee is taken out, the agency owners. Never the
 * employee, even when they hold one of those roles. Active accounts only.
 */
export async function statementReviewerIds(
  models: RoleHolderModels,
  args: { agencyId: string; branchId: string | null; employeeId: string },
): Promise<string[]> {
  const others = (holders: { _id: Types.ObjectId }[]) =>
    holders
      .map((holder) => String(holder._id))
      .filter((id) => id !== args.employeeId);
  if (args.branchId && Types.ObjectId.isValid(args.branchId)) {
    // `User.branchId` is an ObjectId; the statement's is a string.
    const managers = others(
      await activeRoleHolders(models, args.agencyId, ['branch_manager'], {
        branchId: new Types.ObjectId(args.branchId),
      }),
    );
    if (managers.length) return managers;
  }
  return others(
    await activeRoleHolders(models, args.agencyId, ['agency_owner']),
  );
}

/**
 * Of `ids`, the agency's active accounts — by `activeRoleHolders`' rule:
 * `isActive` not false, never a platform admin. For a recipient named by a
 * stored id (the statement's sender), whose account may have been
 * deactivated since (PAC-182 review).
 */
export async function activeAccountIds(
  userModel: Model<UserDocument>,
  agencyId: string,
  ids: readonly string[],
): Promise<string[]> {
  const wanted = ids.filter((id) => Types.ObjectId.isValid(id));
  if (!wanted.length) return [];
  const users = await userModel
    .find({
      _id: { $in: wanted.map((id) => new Types.ObjectId(id)) },
      // `users.agencyId` is an ObjectId, unlike TenantRecord.
      agencyId: new Types.ObjectId(agencyId),
      isPlatformAdmin: { $ne: true },
      isActive: { $ne: false },
    })
    .select({ _id: 1 })
    .lean<{ _id: Types.ObjectId }[]>();
  const active = new Set(users.map((user) => String(user._id)));
  return wanted.filter((id) => active.has(id));
}

type AnswerType = 'payouts.statement_rejected' | 'payouts.statement_accepted';

/** One notification per answer per version: a version is answered once. */
export function statementAnswerDedupeKey(
  type: AnswerType,
  statementId: string,
  version: number,
): string {
  const verb = type === 'payouts.statement_rejected' ? 'rejected' : 'accepted';
  return `pay-statement:${statementId}:${verb}:v${version}`;
}

/**
 * The request for an answer. No notes and no amounts: the dispute's notes
 * may quote pay, and the link opens them behind sign-in.
 */
export function statementAnswerNotification(args: {
  type: AnswerType;
  agencyId: string;
  statementId: string;
  month: string;
  version: number;
  employeeName: string;
  recipientIds: string[];
  actorId: string;
}): Omit<NotificationRequestedData, 'eventLogId'> {
  return {
    type: args.type,
    recipientIds: args.recipientIds,
    agencyId: args.agencyId,
    actorId: args.actorId,
    entity: { kind: 'payStatement', id: args.statementId },
    data: {
      statementId: args.statementId,
      month: args.month,
      monthLabel: monthLabel(args.month),
      version: args.version,
      employeeName: args.employeeName,
    },
    dedupeKey: statementAnswerDedupeKey(
      args.type,
      args.statementId,
      args.version,
    ),
  };
}
