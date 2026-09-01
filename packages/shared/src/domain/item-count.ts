/**
 * What counts as a believable item count (PAC-80).
 *
 * The write path has always bounded this — `create-sold-deal.dto.ts` and
 * `create-quote-recap.dto.ts` both cap `itemCount` at 99 per policy, and cap a
 * submission at 10 and 12 policies respectively. Nothing bounded the *read* of
 * legacy data, so the SmartSuite import copied whatever the source held.
 *
 * It held junk. One migrated deal carried `itemCount: 875244687` — the policy
 * number of one of its own policies, typed into "Total Items" years ago — and
 * because `PerformanceService` sums the field with no guard, that single row
 * rendered the Producer Dashboard's Sold card as "875,245,459 Items" and
 * "Avg Items / HH 19,891,942.25".
 *
 * The bounds here are not new: they are the agency's own, lifted out of those
 * DTOs so validation and import cannot drift apart.
 */

/**
 * The most items one policy can carry. The sold and quote-recap forms have
 * enforced this since they were written.
 */
export const MAX_POLICY_ITEM_COUNT = 99;

/**
 * The most policies one record can carry — the looser of the two form caps
 * (quote recap 12, sold deal 10), so this never rejects something a form would
 * have accepted.
 */
export const MAX_POLICIES_PER_RECORD = 12;

/**
 * The largest item count a record holding `policyCount` policies could honestly
 * have.
 *
 * **Structural, not a flat ceiling**, and that distinction is load-bearing: the
 * second-worst migrated row is a *two-policy bundle* claiming 662 items, which
 * sails under any global `99 × 12 = 1188` limit but is impossible for the record
 * it sits on.
 *
 * An unknown or non-positive `policyCount` falls back to one policy — the
 * conservative reading, and the right one for a row whose structure we cannot
 * confirm.
 */
export function maxPlausibleItemCount(policyCount?: number | null): number {
  const policies =
    policyCount && policyCount > 0
      ? Math.min(Math.floor(policyCount), MAX_POLICIES_PER_RECORD)
      : 1;
  return policies * MAX_POLICY_ITEM_COUNT;
}

/**
 * Could a record with `policyCount` policies really hold `value` items?
 *
 * Negative and non-integer counts are implausible too — an item is a countable
 * thing, and a fractional or negative one is always a source defect.
 */
export function isPlausibleItemCount(
  value: number,
  policyCount?: number | null,
): boolean {
  if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    return false;
  }
  return value <= maxPlausibleItemCount(policyCount);
}

/**
 * Could one record really hold `value` policies?
 *
 * Bounded by {@link MAX_POLICIES_PER_RECORD} rather than by
 * {@link maxPlausibleItemCount} — a policy count is the *denominator* an item
 * count is checked against, so letting a nonsense one through would widen that
 * ceiling instead of narrowing it.
 *
 * `0` is plausible: a deal whose policies never imported has no count to state.
 */
export function isPlausiblePolicyCount(value: number): boolean {
  if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    return false;
  }
  return value <= MAX_POLICIES_PER_RECORD;
}
