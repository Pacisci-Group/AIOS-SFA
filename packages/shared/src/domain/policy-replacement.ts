import { addUtcMonths, startOfUtcDay, toDate } from './calendar';
import type { PolicyStatus } from './policy-status';

/**
 * One policy replacing another, and what that costs the producer.
 *
 * Two flows write a replacement pair (`Policy.transferredFromPolicyId` /
 * `transferredToPolicyId`), and until now only one of them existed:
 *
 *   - **Company Transfer** (PAC-63) — an intra-book move. The client changes
 *     package or tier; nothing was sold, so the deal is booked
 *     `company_transfer` and the producer scorecard never sees it.
 *   - **Cancel Rewrite** (this file) — the policy is cancelled and rewritten,
 *     usually because the carrier or the client forced a change. The
 *     replacement *is* a sale, and the cancelled one may claw back what was
 *     already credited for it.
 *
 * They share the mechanism and differ in the money, which is why the reason is
 * modelled as its own vocabulary rather than inferred from
 * `Deal.businessType`: the deal records what kind of production the
 * **replacement** is, while this records why the **original** went away. On a
 * rewrite those two answers genuinely differ, and collapsing them is how a
 * chargeback would get attached to the wrong half of the pair.
 */
export const POLICY_REPLACEMENT_REASONS = [
  'company_transfer',
  'cancel_rewrite',
] as const;

export type PolicyReplacementReason =
  (typeof POLICY_REPLACEMENT_REASONS)[number];

export const POLICY_REPLACEMENT_REASON_LABELS: Record<
  PolicyReplacementReason,
  string
> = {
  company_transfer: 'Company Transfer',
  cancel_rewrite: 'Cancel Rewrite',
};

/**
 * What the **retired** policy's status becomes, per reason.
 *
 * Both labels already exist in `POLICY_STATUSES`, added under PAC-126 with a
 * note that they carried no semantics yet and that what they meant for the
 * lifecycle was still an open question. This map is the answer to that question.
 *
 * ⚠ The transfer path previously stamped the retired policy `'Cancelled'`
 * (`UpsertPoliciesStep.retireTransferred`), which was the only honest value
 * available at the time — `'Company Transfer'` did not exist yet. It does now,
 * and a transfer-retired policy reading `'Cancelled'` is indistinguishable from
 * one the client actually cancelled, which is the distinction the service team
 * asked for.
 */
export const RETIRED_POLICY_STATUS: Record<
  PolicyReplacementReason,
  PolicyStatus
> = {
  company_transfer: 'Company Transfer',
  cancel_rewrite: 'Cancel Rewrite',
};

/**
 * How long after the sale a cancellation still claws back the credit.
 *
 * David, 2026-09-11: cancel inside the first month and the premium comes back
 * off the producer's sold figure as well as being charged back; cancel after it
 * and the chargeback stands alone, because by then the policy was genuinely on
 * the books and the sale genuinely happened.
 *
 * A whole **calendar** month, not 30 days — see {@link isWithinClawbackWindow}.
 */
export const REWRITE_CLAWBACK_WINDOW_MONTHS = 1;

/**
 * Is the cancellation inside the clawback window?
 *
 * Measured from the **deal's sold date**, the date the client bought, which is
 * also the date the producer was credited. (The policy's effective date was the
 * alternative and was rejected: ~974 migrated policies have none at all, and a
 * policy sold well before coverage starts would otherwise get a longer window
 * than the producer was ever paid against.)
 *
 * Calendar months rather than 30 days, and compared at day granularity: a deal
 * sold 31 January is inside the window until 28 February, and a cancellation
 * logged at 9am is the same answer as the same cancellation logged at 5pm. The
 * boundary day itself is **inside** the window — a policy sold on the 3rd and
 * cancelled on the 3rd of the next month has not yet completed a month, which is
 * the reading of "before 1 month is complete".
 *
 * Returns `false` when either date is missing or unusable. That is the
 * conservative direction: with no sold date there is nothing to prove the sale
 * was recent, and reversing a producer's credit on a guess is the more damaging
 * of the two errors.
 */
export function isWithinClawbackWindow(
  soldDate: Date | string | null | undefined,
  cancelledAt: Date | string | null | undefined,
): boolean {
  const sold = toDate(soldDate);
  const cancelled = toDate(cancelledAt);
  if (!sold || !cancelled) return false;

  const start = startOfUtcDay(sold);
  const deadline = addUtcMonths(start, REWRITE_CLAWBACK_WINDOW_MONTHS);
  const at = startOfUtcDay(cancelled);

  // A cancellation dated before the sale is nonsense data, not a clawback.
  if (at < start) return false;
  return at <= deadline;
}

/** What a rewrite does to the money, for one cancelled policy. */
export interface RewriteFinancialOutcome {
  /** Always the cancelled policy's premium. Never negative. */
  chargebackAmount: number;
  /**
   * What to add to the original deal's premium — `-premium` inside the window,
   * `0` outside it. Signed so a caller can `$inc` with it and never has to
   * re-derive which branch it was in.
   */
  soldAdjustment: number;
  /** Which branch produced the numbers, for the ledger row and the UI. */
  withinClawbackWindow: boolean;
}

/**
 * **The one authority on what a Cancel Rewrite costs.**
 *
 * Both branches charge the full premium back. They differ only in whether the
 * producer's sold figure is reduced too:
 *
 *   - **Inside the window** — chargeback the premium *and* take it back off the
 *     sold total. The sale did not stick, so the credit should not either.
 *   - **Outside it** — chargeback the premium and leave the sold total alone.
 *     The producer earned that credit; the chargeback is the carrier clawing
 *     back unearned commission, which is a separate fact.
 *
 * The premium serves as the charged-back amount in both branches because the
 * system records no payment or down-payment figure — a policy carries `premium`
 * and nothing else monetary. If a real payment amount is ever captured, this is
 * the single function to change, and the ledger row's `amount` is what moves.
 *
 * A missing or negative premium answers zero rather than throwing: a chargeback
 * of nothing is a truthful record of a policy that carried no premium, whereas
 * failing the rewrite would block the service team on bad historic data.
 */
export function rewriteFinancialOutcome(
  premium: number | null | undefined,
  soldDate: Date | string | null | undefined,
  cancelledAt: Date | string | null | undefined,
): RewriteFinancialOutcome {
  const amount = Math.max(0, roundCents(premium ?? 0));
  const withinClawbackWindow = isWithinClawbackWindow(soldDate, cancelledAt);

  return {
    chargebackAmount: amount,
    soldAdjustment: withinClawbackWindow ? -amount : 0,
    withinClawbackWindow,
  };
}

/**
 * One policy in a replacement chain, oldest first.
 *
 * Flattened deliberately: the chain is linear (`A → B → C`), so a nested
 * structure would only make the UI walk it again. `reason` says how this policy
 * was *left* — null on the last entry, which is the one still in force.
 */
export interface PolicyReplacementChainEntry {
  policyId: string;
  policyNumber: string | null;
  policyType: string | null;
  carrier: string | null;
  premium: number;
  status: string;
  active: boolean;
  effectiveDate: string | null;
  /** How this policy ended, or null if it is the current one. */
  reason: PolicyReplacementReason | null;
  /** What was charged back when it ended, if anything. */
  chargebackAmount: number | null;
  /** Whether that chargeback also reversed the producer's credit. */
  withinClawbackWindow: boolean | null;
  /** The deal this policy was booked on, for a link through to the sale. */
  dealId: string | null;
  /** True for the policy the chain was requested from. */
  isRequested: boolean;
}

/**
 * A policy's full replacement history — every policy that led to it, and every
 * one that came after.
 *
 * Served for **any** policy in the chain and always returns the whole thing, not
 * the half after the one asked about. Someone opening the original policy from
 * two rewrites ago is asking the same question as someone opening the current
 * one: what happened to this coverage?
 */
export interface PolicyReplacementChain {
  entries: PolicyReplacementChainEntry[];
  /** Sum of every chargeback on the chain. */
  totalChargeback: number;
}

/**
 * What `POST /policies/:id/rewrite` answers with.
 *
 * The money is returned rather than left for the producer to discover at month
 * end: a chargeback that first appears on a payslip is the complaint this whole
 * feature is meant to prevent.
 */
export interface PolicyRewriteResult {
  /** The new deal the replacement policies were booked on. */
  dealId: string;
  cancelledPolicyId: string;
  /** Positive: what was charged back. */
  chargebackAmount: number;
  /** `-chargebackAmount` inside the window, `0` outside it. */
  soldAdjustment: number;
  withinClawbackWindow: boolean;
  cancelledAt: string;
  /** What the cancelled policy's status now reads. */
  retiredStatus: PolicyStatus;
}

/**
 * Money to two decimals.
 *
 * Premiums are summed into deal roll-ups and scorecards, and a float sum of
 * three premiums is how `2100.0499999999997` reaches a ledger that is supposed
 * to reconcile against a carrier statement. `performance.normalize.ts` rounds
 * for the same reason.
 */
function roundCents(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
}
