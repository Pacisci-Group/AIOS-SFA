/**
 * Policy-number duplicate check (PAC-40) — `GET /policies/check`.
 *
 * Card 3 of the Sold wizard calls this as the producer leaves the policy-number
 * field. It exists to stop the same policy being written twice when a sale is
 * re-entered or a renewal is mistaken for new business.
 *
 * There is no legacy equivalent; the contract is designed here.
 */

export interface PolicyCheckMatch {
  id: string;
  policyNumber: string;
  policyType: string;
  carrier: string;
  /** ISO-8601, or `null` when the stored policy has no effective date. */
  effectiveDate: string | null;
  /**
   * Whether the match is inside the caller's data scope.
   *
   * When `false` the identifying fields below are withheld — see
   * {@link PolicyCheckResponse} for why the match is reported at all.
   */
  isOwn: boolean;
  /** Withheld (`null`) when `isOwn` is false. */
  clientName: string | null;
  /** Withheld (`null`) when `isOwn` is false. */
  householdId: string | null;
  /** Withheld (`null`) when `isOwn` is false. */
  dealId: string | null;
}

export interface PolicyCheckResponse {
  /** Echoed verbatim, so a stale response can be discarded by the caller. */
  query: string;
  /**
   * The normalized match key, or `null` when the input was too short to be
   * meaningful. `null` always comes with an empty `matches` — it means "no
   * opinion", not "no duplicate".
   */
  normalized: string | null;
  /**
   * Capped; a producer only needs to recognise the policy, not page through.
   *
   * Out-of-scope matches are included but masked. Omitting them entirely would
   * defeat the endpoint: the duplicate a producer most needs warning about is
   * the one they cannot see, because they are about to create a second record
   * for a policy a colleague already wrote. Carrier, type and effective date
   * are what make "is this the same policy or did I mistype?" answerable, so
   * they are shown; the client's identity is not.
   */
  matches: PolicyCheckMatch[];
}
