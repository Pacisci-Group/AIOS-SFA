import type { FilterQuery } from 'mongoose';
import type { RowOutcome } from '../common/carrier-reconciliation/carry-forward';
import type { ReconciliationRow } from './schemas/reconciliation-row.schema';

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
