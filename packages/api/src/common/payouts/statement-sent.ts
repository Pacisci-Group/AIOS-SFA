import type { NotificationRequestedData } from '../../inngest/events';
import { monthLabel } from './month-window';

/**
 * The `payouts.statement_sent` request for one issued statement (PAC-181):
 * the employee is told it is ready, with a link to it.
 *
 * The dedupe key carries the version, so sending the same version twice
 * tells nobody twice, while a version issued again after a reopen or a
 * dispute is news. No amounts: the email may be read where others can see
 * it, and the link opens the statement behind sign-in.
 */
export function statementSentDedupeKey(
  statementId: string,
  version: number,
): string {
  return `pay-statement:${statementId}:sent:v${version}`;
}

export function statementSentNotification(args: {
  agencyId: string;
  statementId: string;
  month: string;
  version: number;
  recipientId: string;
  actorId: string;
  senderName: string | null;
}): Omit<NotificationRequestedData, 'eventLogId'> {
  return {
    type: 'payouts.statement_sent',
    recipientIds: [args.recipientId],
    agencyId: args.agencyId,
    actorId: args.actorId,
    entity: { kind: 'payStatement', id: args.statementId },
    data: {
      statementId: args.statementId,
      month: args.month,
      monthLabel: monthLabel(args.month),
      version: args.version,
      senderName: args.senderName,
    },
    dedupeKey: statementSentDedupeKey(args.statementId, args.version),
  };
}
