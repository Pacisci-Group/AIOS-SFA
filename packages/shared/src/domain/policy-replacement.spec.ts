import {
  POLICY_REPLACEMENT_REASONS,
  RETIRED_POLICY_STATUS,
  REWRITE_CLAWBACK_WINDOW_MONTHS,
  isWithinClawbackWindow,
  rewriteFinancialOutcome,
} from './policy-replacement';
import { POLICY_STATUSES } from './policy-status';

/**
 * The clawback window decides whether a producer's sold figure is reduced, so
 * an off-by-one here moves somebody's pay. These pin the boundary explicitly.
 */
describe('isWithinClawbackWindow', () => {
  it('counts the sale day itself as inside', () => {
    expect(isWithinClawbackWindow('2026-03-10', '2026-03-10')).toBe(true);
  });

  it('counts the last day of the month as inside', () => {
    // "Before 1 month is complete" — on the 10th of the next month a month has
    // not yet elapsed, so the credit still comes back.
    expect(isWithinClawbackWindow('2026-03-10', '2026-04-10')).toBe(true);
  });

  it('falls outside the day after', () => {
    expect(isWithinClawbackWindow('2026-03-10', '2026-04-11')).toBe(false);
  });

  it('clamps a month-end sale rather than overflowing into March', () => {
    // 31 Jan + 1 month is 28 Feb, not 2 or 3 March. Raw `setUTCMonth` overflow
    // would hand this policy two extra days of clawback.
    expect(isWithinClawbackWindow('2026-01-31', '2026-02-28')).toBe(true);
    expect(isWithinClawbackWindow('2026-01-31', '2026-03-01')).toBe(false);
  });

  it('ignores time of day on both ends', () => {
    // Same calendar days, opposite ends of the clock: one answer, or the same
    // cancellation lands differently depending on when a CSR got to it.
    expect(
      isWithinClawbackWindow(
        '2026-03-10T23:59:00.000Z',
        '2026-04-10T00:01:00.000Z',
      ),
    ).toBe(true);
  });

  it('is false when either date is missing or unusable', () => {
    // Conservative on purpose: with no sold date there is nothing proving the
    // sale was recent, and reversing credit on a guess is the worse error.
    for (const [sold, cancelled] of [
      [null, '2026-04-10'],
      ['2026-03-10', null],
      [undefined, undefined],
      ['not a date', '2026-04-10'],
    ] as const) {
      expect(isWithinClawbackWindow(sold, cancelled)).toBe(false);
    }
  });

  it('is false when the cancellation predates the sale', () => {
    expect(isWithinClawbackWindow('2026-03-10', '2026-03-09')).toBe(false);
  });

  it('is one calendar month, not thirty days', () => {
    expect(REWRITE_CLAWBACK_WINDOW_MONTHS).toBe(1);
    // February is 28 days, so a 30-day rule would put this outside.
    expect(isWithinClawbackWindow('2026-02-01', '2026-03-01')).toBe(true);
  });
});

describe('rewriteFinancialOutcome', () => {
  it('charges back the premium and reverses the sold credit inside the window', () => {
    expect(rewriteFinancialOutcome(940, '2026-03-10', '2026-03-20')).toEqual({
      chargebackAmount: 940,
      soldAdjustment: -940,
      withinClawbackWindow: true,
    });
  });

  it('charges back the premium but leaves the sold credit outside it', () => {
    // The producer earned that credit — the policy was genuinely on the books.
    expect(rewriteFinancialOutcome(940, '2026-03-10', '2026-06-20')).toEqual({
      chargebackAmount: 940,
      soldAdjustment: 0,
      withinClawbackWindow: false,
    });
  });

  it('charges back the same amount either way', () => {
    // The branches differ only in the sold adjustment. Stated as a test because
    // it is the whole of the rule and reads as a surprise otherwise.
    const inside = rewriteFinancialOutcome(1200, '2026-03-10', '2026-03-15');
    const outside = rewriteFinancialOutcome(1200, '2026-03-10', '2026-09-15');
    expect(inside.chargebackAmount).toBe(outside.chargebackAmount);
    expect(inside.soldAdjustment).not.toBe(outside.soldAdjustment);
  });

  it('rounds to cents', () => {
    // A float-summed premium must not reach a ledger meant to reconcile against
    // a carrier statement.
    expect(
      rewriteFinancialOutcome(2100.0499999999997, '2026-03-10', '2026-03-15')
        .chargebackAmount,
    ).toBe(2100.05);
  });

  it('answers zero for a missing or negative premium rather than throwing', () => {
    // Migrated policies carry all sorts of things; blocking the service team on
    // one is worse than recording a chargeback of nothing.
    for (const premium of [null, undefined, 0, -50, Number.NaN]) {
      expect(
        rewriteFinancialOutcome(premium, '2026-03-10', '2026-03-15'),
      ).toMatchObject({ chargebackAmount: 0, soldAdjustment: -0 });
    }
  });

  it('does not reverse credit when the sold date is unknown', () => {
    expect(rewriteFinancialOutcome(940, null, '2026-03-15')).toEqual({
      chargebackAmount: 940,
      soldAdjustment: 0,
      withinClawbackWindow: false,
    });
  });
});

describe('retired policy status', () => {
  it('maps every reason to a real policy status', () => {
    const statuses = new Set<string>(POLICY_STATUSES);
    for (const reason of POLICY_REPLACEMENT_REASONS) {
      expect(statuses.has(RETIRED_POLICY_STATUS[reason])).toBe(true);
    }
  });

  it('distinguishes a transfer from a rewrite on the retired policy', () => {
    // Both used to stamp `Cancelled`, which made a package change
    // indistinguishable from a client actually cancelling.
    expect(RETIRED_POLICY_STATUS.company_transfer).toBe('Company Transfer');
    expect(RETIRED_POLICY_STATUS.cancel_rewrite).toBe('Cancel Rewrite');
  });
});
