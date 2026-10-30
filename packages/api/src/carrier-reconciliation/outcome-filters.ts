import type { FilterQuery } from 'mongoose';
import {
  isPendingServiceIntake,
  type RowOutcome,
} from '../common/carrier-reconciliation/carry-forward';
import type { ReconciliationRow } from './schemas/reconciliation-row.schema';

/** How long a welcome-call opener holds a pending row before another may try. */
export const HAND_OFF_CLAIM_MS = 2 * 60 * 1000;

/**
 * Whether someone is opening this pending service intake's welcome call right
 * now (PAC-173 PR 5): a claim younger than {@link HAND_OFF_CLAIM_MS}. One a
 * crash left behind lapses.
 */
export function handOffClaimed(
  outcome: RowOutcome | null | undefined,
  at: Date = new Date(),
): boolean {
  return (
    isPendingServiceIntake(outcome) &&
    !!outcome?.handOffAt &&
    outcome.handOffAt.getTime() > at.getTime() - HAND_OFF_CLAIM_MS
  );
}

/**
 * No live claim on the row's welcome call — what the opener matches to take
 * one, and what an owner write clearing a pending service intake matches, so
 * it never clears one whose call is being opened.
 */
export function noLiveHandOffClaim(
  at: Date = new Date(),
): FilterQuery<ReconciliationRow> {
  return {
    $nor: [
      {
        'outcome.handOffAt': {
          $gt: new Date(at.getTime() - HAND_OFF_CLAIM_MS),
        },
      },
    ],
  };
}

/**
 * Compare-and-swap on a row's outcome as it was read (PAC-173 PR 4): every
 * write that sets or clears `outcome` — the assignee's, the sale hook's, the
 * owner's review and assignment, which each clear an unfinished one — matches
 * it first, so two of them racing cannot both believe they won.
 *
 * Kind, status, step and start identify the outcome and where it stands; the
 * lead and deal links are in the match too, because a write replaces the
 * whole object and would otherwise drop a link stamped since it was read.
 * `{ outcome: null }` also matches a row stored before outcomes existed.
 */
export function outcomeAsRead(
  outcome: RowOutcome | null | undefined,
): FilterQuery<ReconciliationRow> {
  if (!outcome) return { outcome: null };
  return {
    'outcome.kind': outcome.kind,
    'outcome.status': outcome.status,
    'outcome.step': outcome.step,
    'outcome.startedAt': outcome.startedAt,
    'outcome.leadId': outcome.leadId,
    'outcome.dealId': outcome.dealId,
  };
}
