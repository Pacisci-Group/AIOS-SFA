import type { NotificationRequestedData } from '../../inngest/events';
import {
  activeRoleHolders,
  type RoleHolderModels,
} from '../../permissions/role-holders';
import { monthLabel } from './month-window';

/**
 * Who reviews a drafted month (PAC-178): the agency's owners and branch
 * managers, by the default templates' role slugs. Active accounts only — an
 * invite nobody accepted reads no email.
 */
export const RUN_READY_ROLE_SLUGS = ['agency_owner', 'branch_manager'] as const;

export async function runReadyRecipients(
  models: RoleHolderModels,
  agencyId: string,
): Promise<string[]> {
  const holders = await activeRoleHolders(
    models,
    agencyId,
    RUN_READY_ROLE_SLUGS,
  );
  return holders.map((holder) => String(holder._id));
}

/**
 * The `payouts.run_ready` request for a run. One per run, ever — the dedupe
 * key is the run — so a job that re-drafts a month that was generated early
 * does not tell anyone twice.
 */
export function runReadyNotification(args: {
  agencyId: string;
  runId: string;
  month: string;
  statements: number;
  recipientIds: string[];
}): Omit<NotificationRequestedData, 'eventLogId'> {
  return {
    type: 'payouts.run_ready',
    recipientIds: args.recipientIds,
    agencyId: args.agencyId,
    actorId: null,
    entity: { kind: 'payoutRun', id: args.runId },
    data: {
      runId: args.runId,
      month: args.month,
      monthLabel: monthLabel(args.month),
      statements: args.statements,
    },
    dedupeKey: `payout-run:${args.runId}:ready`,
  };
}
