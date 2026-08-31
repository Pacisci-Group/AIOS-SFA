import {
  MAX_POLICIES_PER_RECORD,
  MAX_POLICY_ITEM_COUNT,
  isPlausibleItemCount,
  isPlausiblePolicyCount,
  maxPlausibleItemCount,
} from './item-count';

describe('item-count plausibility (PAC-80)', () => {
  describe('the values that actually broke the dashboard', () => {
    it('rejects a policy number typed into "Total Items"', () => {
      // The migrated deal "Stevenson Household - #1658". Its own two policies
      // are numbered 875244685 / 875244684; someone typed one into the items
      // field years ago, and `PerformanceService` summed it, rendering the Sold
      // card as "875,245,459 Items" / "Avg Items / HH 19,891,942.25".
      expect(isPlausibleItemCount(875244687, 2)).toBe(false);
    });

    it('rejects 662 items on a two-policy bundle', () => {
      /*
       * The case a flat ceiling misses, and the reason the bound is structural:
       * 662 is comfortably under `99 × 12 = 1188`, so a global limit would let
       * it through. It is still impossible for a record holding two policies.
       */
      expect(662).toBeLessThan(MAX_POLICY_ITEM_COUNT * MAX_POLICIES_PER_RECORD);
      expect(isPlausibleItemCount(662, 2)).toBe(false);
    });

    it('rejects a premium typed into a quote recap’s items field', () => {
      // Recap "#382": `itemCount: 3228` beside `premium: 3228.98`.
      expect(isPlausibleItemCount(3228, 3)).toBe(false);
    });
  });

  describe('the values that must keep working', () => {
    it.each([
      [1, 1],
      [2, 1],
      [3, 2],
      [5, 3],
      [20, 4],
    ])('accepts %i items across %i policies', (items, policies) => {
      expect(isPlausibleItemCount(items, policies)).toBe(true);
    });

    it('accepts a full 99 items on a single policy', () => {
      // The write path's own ceiling — the import must not be stricter than the
      // form, or it would reject data the app would happily have created.
      expect(isPlausibleItemCount(MAX_POLICY_ITEM_COUNT, 1)).toBe(true);
    });

    it('accepts zero', () => {
      // A deal whose policies never imported states no items. Absence is not
      // implausibility.
      expect(isPlausibleItemCount(0, 0)).toBe(true);
    });
  });

  describe('maxPlausibleItemCount', () => {
    it('scales with the policy count', () => {
      expect(maxPlausibleItemCount(1)).toBe(99);
      expect(maxPlausibleItemCount(3)).toBe(297);
    });

    it('assumes one policy when the count is unknown or nonsense', () => {
      // The conservative reading for a row whose structure we cannot confirm.
      for (const input of [undefined, null, 0, -4]) {
        expect(maxPlausibleItemCount(input)).toBe(MAX_POLICY_ITEM_COUNT);
      }
    });

    it('never widens beyond the per-record policy cap', () => {
      // Otherwise a corrupt policy count would raise the ceiling it is supposed
      // to define, letting the very values under test back through.
      expect(maxPlausibleItemCount(875244687)).toBe(
        MAX_POLICIES_PER_RECORD * MAX_POLICY_ITEM_COUNT,
      );
    });
  });

  describe('malformed numbers', () => {
    it.each([[-1], [1.5], [NaN], [Infinity]])('rejects %p', (value) => {
      expect(isPlausibleItemCount(value, 2)).toBe(false);
      expect(isPlausiblePolicyCount(value)).toBe(false);
    });
  });

  describe('isPlausiblePolicyCount', () => {
    it('is bounded by the record cap, not by the item ceiling', () => {
      // A policy count is the denominator an item count is checked against, so
      // it must be bounded by 12, never by 12 × 99.
      expect(isPlausiblePolicyCount(MAX_POLICIES_PER_RECORD)).toBe(true);
      expect(isPlausiblePolicyCount(MAX_POLICIES_PER_RECORD + 1)).toBe(false);
      expect(isPlausiblePolicyCount(875244687)).toBe(false);
    });

    it('accepts zero', () => {
      expect(isPlausiblePolicyCount(0)).toBe(true);
    });
  });

  it('agrees with the write path’s own limits', () => {
    /*
     * These constants were lifted out of `create-sold-deal.dto.ts` and
     * `create-quote-recap.dto.ts`, which have always enforced them. Pinned here
     * so the import and the forms cannot drift apart — the drift is what let the
     * legacy junk in.
     */
    expect(MAX_POLICY_ITEM_COUNT).toBe(99);
    expect(MAX_POLICIES_PER_RECORD).toBe(12);
  });
});
