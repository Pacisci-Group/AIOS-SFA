import type { PolicyReplacementReason } from './policy-replacement';

/**
 * Why a lead exists, when it exists only to replace a policy.
 *
 * A Cancel Rewrite and a Company Transfer both write a replacement policy, and
 * both now go through the **ordinary Sold pipeline** — lead → sold — rather than
 * through an endpoint of their own. That is a deliberate reversal: PAC-63 and
 * PAC-126 each gave their flow a bespoke anchor (a CRM ticket, then a policy),
 * and the result was two more ways to write a policy, each with its own presign,
 * its own guards and its own drift. A policy needs the same information to exist
 * however it came about, and the Sold form is where that information is
 * collected.
 *
 * But the Sold form is anchored on a **lead**, and a replacement has none — so
 * one is created for it, and this records what it was created *for*.
 *
 * ## Why it is stored rather than inferred
 *
 * The same reason {@link PolicyReplacementReason} is its own vocabulary and not
 * read off `Deal.businessType`: the deal records what kind of production the
 * **replacement** is, while this records why the **original** is going away. On
 * a rewrite those two answers genuinely differ — the replacement is new
 * business, the original was cancelled — and collapsing them is how a chargeback
 * gets attached to the wrong half of the pair.
 *
 * ## Why it is on the lead and not held in the URL
 *
 * Because the rep can leave. The chain is two forms long, and a rep who creates
 * the lead and then closes the tab has left a real lead behind with no sale on
 * it. Next time they ask for the same action on the same policy, the flow has to
 * find that lead and resume at the Sold form rather than opening a second one
 * beside it — which is what {@link isResumable} answers. URL state cannot
 * survive a closed tab; a field on the record can.
 *
 * ## It is enforced, not advisory
 *
 * `POST /sold-deals` reads this and applies it: the business type, the
 * replacement reason, the `fromPolicyId` on the first policy row and (for a
 * rewrite) the chargeback all come from here, inside the same transaction that
 * books the deal.
 *
 * That matters more than it looks. Without it, someone could open a replacement
 * lead from the Leads page, press *Mark as Sold*, and book an ordinary sale that
 * never retires the policy and never charges anything back — a replacement
 * silently half-done. Because the intent is read on every submit for that lead,
 * any sale on it *becomes* the replacement, which is the safe direction to fail.
 */
export interface LeadReplacementIntent {
  /** The policy being replaced. */
  policyId: string;
  /** Why the original is going away — and which money rules apply. */
  reason: PolicyReplacementReason;
  /**
   * When the replacement was actually booked, or null while the chain is still
   * open.
   *
   * Set in the same transaction as the deal. A consumed intent is history: it
   * explains a lead that would otherwise look like an ordinary sale, and it
   * stops the flow resuming into a lead whose work is already done.
   */
  consumedAt: string | null;
  /** The deal that consumed it, for the trail back to the replacement. */
  consumedByDealId: string | null;
}

/**
 * Is this intent still waiting for its sale?
 *
 * The one question both entry points ask. An unconsumed intent means a lead was
 * created for this replacement and abandoned before the Sold form — so resume
 * there rather than creating a second lead for the same policy.
 */
export function isResumable(
  intent: Pick<LeadReplacementIntent, 'consumedAt'> | null | undefined,
): boolean {
  return Boolean(intent) && !intent?.consumedAt;
}

/**
 * What the entry point needs to know before it routes anywhere.
 *
 * Served by `GET /leads/for-replacement?policyId&reason`. Three answers, and the caller
 * routes on which one it got:
 *
 *   - `leadId` set — resume at the Sold form.
 *   - `leadId` null and `blockedReason` null — create the lead first.
 *   - `blockedReason` set — do neither, and say why.
 */
export interface ReplacementLeadLookup {
  /** An open lead already created for this replacement, or null. */
  leadId: string | null;
  /** The household the replacement will be written against. */
  householdId: string | null;
  /**
   * Why this policy cannot be replaced at all — inactive, already replaced, no
   * household. Null when it can.
   *
   * Returned rather than thrown so one request answers both "where do I go" and
   * "can I go anywhere", and the button can explain itself without a second
   * round trip.
   */
  blockedReason: string | null;
}
