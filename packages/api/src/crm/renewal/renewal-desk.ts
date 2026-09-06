import { RENEWAL_DESK_PREVIEW_DAYS } from '@sfa/shared';
import type { RenewalDeskRow } from '@sfa/shared';

/**
 * The two rules that make the Proactive Renewal Outreach desk a *forward*
 * looking panel rather than a list of today's work.
 *
 * Pure and separated from `ServiceTicketsService.renewalDesk` because both are
 * exactly the kind of rule that regresses silently: widen the window by a unit
 * mistake and the desk fills with calls a month out; get the ordering wrong and
 * a call nobody can make yet sits above one that is overdue. Neither shows up
 * as an error — only as a desk that quietly stops being useful.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The far edge of the preview window: calls opening at or before this appear on
 * the desk, greyed and not yet startable.
 *
 * Everywhere else in the CRM a call is hidden until its `availableAt`
 * (`scheduledStepMatches`). This is the one deliberate exception — see
 * {@link RENEWAL_DESK_PREVIEW_DAYS}.
 */
export function renewalPreviewCutoff(now: Date): Date {
  return new Date(now.getTime() + RENEWAL_DESK_PREVIEW_DAYS * DAY_MS);
}

/** A row the desk is previewing: its call has not opened, so it cannot be made. */
export function isScheduledDeskRow(
  row: Pick<RenewalDeskRow, 'daysUntilAvailable'>,
): boolean {
  return row.daysUntilAvailable !== null;
}

/**
 * Desk ordering, most urgent first:
 *
 * 1. **Calls that can be made now**, ahead of every previewed one. A call a rep
 *    cannot start must never outrank one they can — without this a T-45
 *    preview jumps above an open T-90 review, because its renewal is nearer.
 * 2. **Overdue first** among those.
 * 3. Then soonest renewal.
 * 4. Previewed calls last, by how soon they open, so the run reads as a
 *    countdown.
 */
export function compareRenewalDeskRows(
  a: RenewalDeskRow,
  b: RenewalDeskRow,
): number {
  return (
    Number(b.isActionable) - Number(a.isActionable) ||
    Number(b.isOverdue) - Number(a.isOverdue) ||
    (a.daysUntilAvailable ?? 0) - (b.daysUntilAvailable ?? 0) ||
    a.daysUntilRenewal - b.daysUntilRenewal
  );
}
