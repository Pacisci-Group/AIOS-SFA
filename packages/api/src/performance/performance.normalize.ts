import type { PerformanceMetric } from '@sfa/shared';
import { roundCents } from '../common/domain/money';

/**
 * Pure derivations for the scorecards (PAC-10 / PAC-11).
 *
 * No Mongoose, no I/O — everything here is a function of one aggregation row,
 * so the rules the producer's numbers depend on can be unit-tested directly.
 */

/** One `$group` row from the scorecard pipeline. */
export interface PerformanceAggregate {
  premium: number;
  itemCount: number;
  recordCount: number;
  householdCount: number;
}

/** All-zero card. Premium and items are genuinely 0; averages are unknowable. */
export const EMPTY_METRIC: PerformanceMetric = {
  premium: 0,
  itemCount: 0,
  recordCount: 0,
  householdCount: 0,
  avgPremiumPerHousehold: null,
  avgItemsPerHousehold: null,
};

/**
 * `null` at a zero denominator — never `0`, and never `NaN`.
 *
 * `0 / 0` is `NaN`, which serializes to `null` in JSON anyway but only after
 * surviving as `NaN` through every intermediate calculation; and a literal `0`
 * would claim the producer averages nothing per household, which is a
 * different and false statement from "there is nothing to average".
 */
export function avgPerHousehold(
  total: number,
  households: number,
): number | null {
  if (households <= 0) return null;
  return roundCents(total / households);
}

/**
 * Turn an aggregation row into a card.
 *
 * `row` is optional because of the classic `$group` trap: a `$match` that
 * selects no documents makes `{ $group: { _id: null } }` emit **zero
 * documents**, not one row of zeroes. Every caller must handle `undefined`, so
 * it is handled here once.
 */
export function toMetric(row?: PerformanceAggregate): PerformanceMetric {
  if (!row) return { ...EMPTY_METRIC };

  const premium = roundCents(row.premium ?? 0);
  const itemCount = row.itemCount ?? 0;
  const householdCount = row.householdCount ?? 0;

  return {
    premium,
    itemCount,
    recordCount: row.recordCount ?? 0,
    householdCount,
    avgPremiumPerHousehold: avgPerHousehold(premium, householdCount),
    avgItemsPerHousehold: avgPerHousehold(itemCount, householdCount),
  };
}
