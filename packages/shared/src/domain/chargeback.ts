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
 * ## Payouts reads it (PAC-176)
 *
 * The month-end calculation this file once deferred to PAC-123 is now Payouts
 * (PAC-176): each month's commission statement takes its chargebacks from this
 * ledger. Rows come from three places, told apart by `source` and `reason`:
 *
 * - **The app** (`source: 'app'`) — a cancel rewrite or a cancellation recorded
 *   here. Full premium back; counted in the month of `occurredAt`.
 * - **The chargeback report** (`source: 'carrier_statement'`, PAC-180) — the
 *   agency's monthly list of approved chargebacks, uploaded on the Payouts page.
 *   The amount is the report's (the carrier's **prorated** premium), and the row
 *   counts in the month the owner imported it for (`statementMonth`), whatever
 *   its date. It never touches the deal's sold figure (`soldAdjustment: 0`).
 * - **A manager's line** on a statement (`reason: 'manual'`, PAC-182), tied to
 *   that statement by `statementId`.
 *
 * The app's rule and the report's will often describe the same cancellation.
 * They are kept from charging twice by the import, which marks a report row as a
 * duplicate when the same policy already has a chargeback in that month — not by
 * this ledger, which records what each source said.
 */

/**
 * Why money was charged back. One per flow that can create a row:
 *
 * - `cancel_rewrite` — the policy was cancelled and rewritten (PAC-126). Dated
 *   on the replacement's sold date, and it names the replacement.
 * - `cancellation` — the policy was cancelled outright with **Record a
 *   chargeback** ticked (PAC-173 PR 6): the household page's Cancel button, or
 *   a Dash row's Chargeback outcome. Dated on **the carrier's cancellation
 *   date**, which the person enters because it decides the one-month window
 *   (David, 27 Oct 2026). No replacement.
 * - `carrier_statement` — a line of the chargeback report (PAC-180). May name
 *   no policy the app knows.
 * - `manual` — added by a manager on one statement (PAC-182).
 */
export const CHARGEBACK_REASONS = [
  'cancel_rewrite',
  'cancellation',
  'carrier_statement',
  'manual',
] as const;

export type ChargebackReason = (typeof CHARGEBACK_REASONS)[number];

export const CHARGEBACK_REASON_LABELS: Record<ChargebackReason, string> = {
  cancel_rewrite: 'Cancel Rewrite',
  cancellation: 'Cancelled policy',
  carrier_statement: 'Carrier report',
  manual: 'Manual',
};

/**
 * Who computed the row: `app` for every row this app works out itself
 * (including a manager's manual line), `carrier_statement` for a row read off
 * the chargeback report. Written from the start, so the two can always be told
 * apart without guessing.
 */
export const CHARGEBACK_SOURCES = ['app', 'carrier_statement'] as const;

export type ChargebackSource = (typeof CHARGEBACK_SOURCES)[number];

/** One chargeback event, as the API serves it. */
export interface ChargebackView {
  id: string;
  /**
   * The policy that went away, and whose premium is the amount. `null` for a
   * chargeback-report line whose policy number the app does not hold.
   */
  policyId: string | null;
  policyNumber: string | null;
  policyType: string | null;
  /** The carrier, when the row says (report rows); else the policy's. */
  carrier: string | null;
  /** The customer as the report names them (report rows only). */
  customerName: string | null;
  /** The pay month a report or manual row counts in, `YYYY-MM`. */
  statementMonth: string | null;
  /** The chargeback-report import that wrote it. */
  importId: string | null;
  /** The statement a manager's manual line belongs to. */
  statementId: string | null;
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
  /**
   * The date the window was judged on: the replacement's sold date for a
   * rewrite, the carrier's cancellation date for a `cancellation`.
   */
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
