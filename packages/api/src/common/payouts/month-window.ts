import { PAYOUT_MONTH_PATTERN } from '@sfa/shared';
import {
  currentMonthIn,
  customRange,
  instantWindow,
  type InstantWindow,
  type YmdRange,
} from '../../performance/performance.range';

/**
 * Pay months (PAC-178): `YYYY-MM` on the agency's calendar.
 *
 * A month's sales are the ones whose `soldDate` falls between the first
 * instant of its 1st and the first instant of the next month's 1st **in the
 * agency's zone** (PAC-159) — so a sale at 11:30 pm Central on the 31st is in
 * that month, though UTC already calls it the 1st. The window is two instants
 * computed once, in Node, so the query is a plain indexed range on `soldDate`.
 *
 * In `common/` because the monthly job (worker) and the endpoints (API) must
 * agree on it to the second.
 */

export function isPayoutMonth(value: string): boolean {
  return PAYOUT_MONTH_PATTERN.test(value);
}

function parts(month: string): { year: number; month: number } {
  if (!isPayoutMonth(month)) {
    throw new Error(`Not a pay month: "${month}"`);
  }
  return { year: Number(month.slice(0, 4)), month: Number(month.slice(5, 7)) };
}

function format(year: number, month: number): string {
  // `Date.UTC` normalises month 0 and 13 across the year boundary.
  const anchor = new Date(Date.UTC(year, month - 1, 1));
  return `${anchor.getUTCFullYear()}-${String(anchor.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function nextMonth(month: string): string {
  const { year, month: m } = parts(month);
  return format(year, m + 1);
}

export function previousMonth(month: string): string {
  const { year, month: m } = parts(month);
  return format(year, m - 1);
}

/** The agency's current month — a run for it is partial. */
export { currentMonthIn };

/** The month the 1st-of-month job drafts: the one before the agency's current one. */
export function previousMonthIn(
  timeZone: string,
  now: Date = new Date(),
): string {
  return previousMonth(currentMonthIn(timeZone, now));
}

/** The month's days, the 1st to the last, as a calendar range. */
export function monthRange(month: string): YmdRange {
  const { year, month: m } = parts(month);
  const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return customRange(
    `${month}-01`,
    `${month}-${String(last).padStart(2, '0')}`,
  );
}

/** `{ $gte, $lt }` on a stored instant: the month on the agency's clock. */
export function monthWindow(month: string, timeZone: string): InstantWindow {
  return instantWindow(monthRange(month), timeZone);
}

/** "October 2026". */
export function monthLabel(month: string): string {
  const { year, month: m } = parts(month);
  return new Date(Date.UTC(year, m - 1, 15)).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** `YYYY-MM` strings compare as calendar months. */
export function isMonthAfter(a: string, b: string): boolean {
  return a > b;
}
