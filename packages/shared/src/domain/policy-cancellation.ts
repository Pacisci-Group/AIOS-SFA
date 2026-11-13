/**
 * Cancelling a policy outright — the household page's **Cancel** button.
 *
 * The third way a policy leaves the books, beside the two replacements in
 * `policy-replacement.ts`. Those retire a policy *into* another one (Cancel
 * Rewrite, Company Transfer) and run through New Lead → Sold; this one ends it
 * with nothing behind it, so it is a single write on the policy and needs no
 * second form.
 *
 * Until this existed, a cancellation was the Edit dialog's status select set to
 * `'Cancelled'` — which recorded *that* the client left and never *why*. The
 * reason is what the service team was asked for, so `'Cancelled'` is now a
 * flow-only status (`FLOW_ONLY_POLICY_STATUSES`): the only way in is
 * `POST /households/:id/policies/:policyId/cancel`, and every cancellation it
 * writes carries a reason.
 *
 * ## With a chargeback (PAC-173 PR 6)
 *
 * Ticking **Record a chargeback** adds one thing: a `cancellation` row in the
 * chargeback ledger (`chargeback.ts`), dated on **the carrier's cancellation
 * date**, which the person enters — it decides whether the cancellation falls
 * inside the one-month clawback window (`rewriteFinancialOutcome`). Without the
 * box nothing changes: no date is asked for, `cancelledAt` is when it was
 * recorded, and nothing is charged back. A Dash row's Chargeback outcome cancels
 * through the same dialog with the box ticked and locked.
 */
export const POLICY_CANCELLATION_REASONS = [
  'sold',
  'changed_carrier',
  'other',
] as const;

export type PolicyCancellationReason =
  (typeof POLICY_CANCELLATION_REASONS)[number];

export const POLICY_CANCELLATION_REASON_LABELS: Record<
  PolicyCancellationReason,
  string
> = {
  sold: 'Sold',
  changed_carrier: 'Changed carrier',
  other: 'Other',
};

/** Longest free-text reason accepted with `'other'`. */
export const POLICY_CANCELLATION_NOTE_MAX = 500;

/**
 * `POST /households/:id/policies/:policyId/cancel`.
 *
 * `note` is the free-text reason, **required for `'other'` and dropped for the
 * rest**: a named reason already says what happened, and a note beside it would
 * be a second answer the list views have nowhere to show.
 */
export interface CancelPolicyInput {
  reason: PolicyCancellationReason;
  note?: string | null;
  /**
   * Record a chargeback with the cancellation: `cancelledOn` is the carrier's
   * cancellation date, `YYYY-MM-DD` — not in the future, not before the sale.
   * Omitted or `null` for a plain cancel.
   */
  chargeback?: { cancelledOn: string } | null;
}

/** How a cancelled policy says why, on the wire. */
export interface PolicyCancellationView {
  reason: PolicyCancellationReason;
  /** The free-text reason; set only when `reason` is `'other'`. */
  note: string | null;
  /** ISO instant the cancellation was recorded. */
  cancelledAt: string;
  /**
   * The carrier's cancellation date, `YYYY-MM-DD` — set only when a chargeback
   * was recorded with it, since that is the only time it is asked for.
   */
  cancelledOn: string | null;
  /** The chargeback ledger row it raised, or `null` for a plain cancel. */
  chargebackId: string | null;
}

/**
 * The reason as one line — `"Sold"`, or the note itself for `'other'`.
 *
 * Falls back to the label when an `'other'` somehow has no note, rather than
 * rendering an empty string where a reason is promised.
 */
export function policyCancellationSummary(
  cancellation: Pick<PolicyCancellationView, 'reason' | 'note'>,
): string {
  if (cancellation.reason === 'other' && cancellation.note?.trim()) {
    return cancellation.note.trim();
  }
  return POLICY_CANCELLATION_REASON_LABELS[cancellation.reason];
}
