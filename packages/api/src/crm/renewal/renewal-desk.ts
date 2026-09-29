import { RENEWAL_DESK_PREVIEW_DAYS } from '@sfa/shared';
import type { RenewalDeskRow } from '@sfa/shared';

/**
 * The two rules that make the Proactive Renewal Outreach desk a *forward*
 * looking panel rather than a list of today's work.
 *
 * Pure and separated from `ServiceTicketsService.renewalDesk` because both are
 * exactly the kind of rule that regresses silently: widen the window by a unit
 * mistake and the desk fills with calls a month out; get the ordering wrong and
 * the countdown stops reading as one. Neither shows up as an error — only as a
 * desk that quietly stops being useful.
 *
 * ## The desk is only what has not started (PAC-143)
 *
 * A cycle is on the desk for the {@link RENEWAL_DESK_PREVIEW_DAYS} before its
 * **first** call opens — T-104 to T-90 on the annual track, T-59 to T-45 on
 * auto — and leaves it the moment that call opens. From then on the renewal is
 * work in hand, and work in hand lives in the Agency Priority queue. The desk
 * used to show open calls *and* previews, so every open renewal appeared in
 * both places.
 *
 * "First call" is the ticket's `renewal.sequence === 1` — its position in the
 * track's full plan, not among the tickets that exist. That matters at the
 * cutover, where a stale T-90 review can be suppressed: the cycle then holds
 * only its T-45 call (`sequence: 2`), and although that call has not opened,
 * the renewal period it belongs to already has. It must not be previewed.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The far edge of the preview window: first calls opening after now and at or
 * before this appear on the desk.
 *
 * Everywhere else in the CRM a call is hidden until its `availableAt`
 * (`scheduledStepMatches`). This desk is the deliberate exception — it shows
 * *only* calls that have not opened. See {@link RENEWAL_DESK_PREVIEW_DAYS}.
 */
export function renewalPreviewCutoff(now: Date): Date {
  return new Date(now.getTime() + RENEWAL_DESK_PREVIEW_DAYS * DAY_MS);
}

/**
 * Desk ordering: a countdown. Soonest to open first, then soonest renewal.
 *
 * Every row is a call that has not opened, so there is no actionable or
 * overdue band to rank ahead of it any more.
 */
export function compareRenewalDeskRows(
  a: RenewalDeskRow,
  b: RenewalDeskRow,
): number {
  return (
    a.daysUntilAvailable - b.daysUntilAvailable ||
    a.daysUntilRenewal - b.daysUntilRenewal
  );
}
