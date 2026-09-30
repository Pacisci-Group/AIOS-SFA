/**
 * The chargeback ledger.
 *
 * A chargeback is commission the agency has to give back because a policy did
 * not stay on the books. Until now nothing in this app modelled one: the
 * month-end calculation lives in PAC-123 (backlog, explicitly "doesn't have to
 * be right now", and noted as still needing Carl's current logic), and the
 * numbers are computed today in ApexReports against BigQuery.
 *
 * This is deliberately **not** an attempt to pre-empt that epic. It is the
 * narrowest thing that makes Cancel Rewrite honest: a rewrite claws money back,
 * and a claw-back that is only ever a number subtracted from a running total is
 * unauditable — nobody can answer "what was this $940 for?" a month later. So
 * the event is recorded as a row, and the totals are derived from the rows.
 *
 * ## What this is not
 *
 * ApexReports computes chargebacks **per diem** (round to cents before
 * multiplying; 181 days for Auto, 365 otherwise) against a carrier termination
 * file. That model prorates by how long the policy actually ran. The rule here
 * is the agency's own, far simpler one — full premium back, and the producer's
 * sold credit reversed only inside the first month — and it applies to a
 * cancellation *we* record rather than one a carrier file reports.
 *
 * **The two will have to be reconciled** when PAC-123 lands and the carrier feed
 * arrives. `source` exists so that reconciliation has something to key on rather
 * than having to guess which rows this app wrote. Do not widen this file into a
 * general commission model before then; it will be the wrong shape.
 */

/** Why money was charged back. One per flow that can create a row. */
export const CHARGEBACK_REASONS = ['cancel_rewrite'] as const;

export type ChargebackReason = (typeof CHARGEBACK_REASONS)[number];

export const CHARGEBACK_REASON_LABELS: Record<ChargebackReason, string> = {
  cancel_rewrite: 'Cancel Rewrite',
};

/**
 * Who computed the row.
 *
 * Only `app` exists today. The value is written anyway, because the alternative
 * is a ledger that cannot tell its own rows from an imported carrier statement's
 * once PAC-123 starts writing `carrier_statement` rows beside them — and by then
 * backfilling provenance is guesswork.
 */
export const CHARGEBACK_SOURCES = ['app'] as const;

export type ChargebackSource = (typeof CHARGEBACK_SOURCES)[number];

/** One chargeback event, as the API serves it. */
export interface ChargebackView {
  id: string;
  /** The policy that went away, and whose premium is the amount. */
  policyId: string;
  policyNumber: string | null;
  policyType: string | null;
  /** The deal the producer was originally credited on. */
  dealId: string | null;
  /** The replacement written by the rewrite, when there is one. */
  replacementPolicyId: string | null;
  householdId: string | null;
  /** Who carries it — the producer credited on the original deal. */
  producerId: string | null;
  producerName: string;
  reason: ChargebackReason;
  source: ChargebackSource;
  /** Always positive: the amount clawed back, never a signed adjustment. */
  amount: number;
  /**
   * What was also taken off the producer's sold figure — `-amount` inside the
   * one-month window, `0` outside it.
   *
   * Stored beside `amount` rather than re-derived, because the window is
   * evaluated against the sold date *at the moment of cancellation* and a later
   * correction to either date must not silently rewrite history.
   */
  soldAdjustment: number;
  withinClawbackWindow: boolean;
  /** When the cancellation was recorded — the date the window was judged on. */
  occurredAt: string;
  /** The sold date the window was measured from, for an auditor. */
  soldDate: string | null;
  createdAt: string;
  recordedByName: string;
}

/** Roll-up for a producer over a period, as the scorecard reads it. */
export interface ChargebackSummary {
  /** Sum of `amount`. Positive. */
  total: number;
  count: number;
  /** Sum of `soldAdjustment`. Negative or zero. */
  soldAdjustment: number;
}
