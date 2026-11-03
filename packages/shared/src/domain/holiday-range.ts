import type { Weekday } from './hr-calendar';

/**
 * A custom holiday range (PAC-161 v2): "Winter closure, Dec 24 – Jan 2".
 *
 * The calendar stores one row per day, so a range is expanded on the client
 * into `AddCalendarDayInput[]` before it is sent — the API sees only days.
 * Days outside the agency workweek are **skipped**: a holiday on a Sunday
 * adds nothing to the working-day arithmetic and only clutters the grid.
 * All-day only; a time window on a closure is a model change PAC-165's hours
 * arithmetic would have to honour, and is not built here.
 *
 * Pure date arithmetic on `YYYY-MM-DD` strings through UTC anchors, so the
 * browser's zone can never shift a day. Lives in `@sfa/shared` because the
 * web package has no unit test runner and the rule deserves one.
 */

/** The longest range one custom holiday may span, inclusive of both ends. */
export const MAX_HOLIDAY_RANGE_DAYS = 60;

export const HOLIDAY_NAME_MAX_LENGTH = 120;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function parseIsoDay(value: string): number | null {
  if (!ISO_DAY.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d);
  const probe = new Date(ms);
  // Reject 2026-02-30 and friends, which `Date.UTC` silently rolls over.
  if (
    probe.getUTCFullYear() !== y ||
    probe.getUTCMonth() !== m - 1 ||
    probe.getUTCDate() !== d
  ) {
    return null;
  }
  return ms;
}

function formatIsoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Why a range cannot be used, as the sentence to show; `null` when it can.
 */
export function holidayRangeError(start: string, end: string): string | null {
  const from = parseIsoDay(start);
  const to = parseIsoDay(end);
  if (from === null) return 'Choose a start date.';
  if (to === null) return 'Choose an end date.';
  if (to < from) return 'The end date is before the start date.';
  const days = Math.round((to - from) / DAY_MS) + 1;
  if (days > MAX_HOLIDAY_RANGE_DAYS) {
    return `A holiday can span at most ${MAX_HOLIDAY_RANGE_DAYS} days.`;
  }
  return null;
}

/**
 * Every day from `start` to `end` inclusive that falls on a workweek day, as
 * sorted `YYYY-MM-DD` strings. An invalid range (see
 * {@link holidayRangeError}) expands to nothing.
 */
export function expandHolidayRange(
  start: string,
  end: string,
  workweek: readonly Weekday[],
): string[] {
  if (holidayRangeError(start, end) !== null) return [];
  const from = parseIsoDay(start)!;
  const to = parseIsoDay(end)!;
  const open = new Set<number>(workweek);
  const out: string[] = [];
  for (let ms = from; ms <= to; ms += DAY_MS) {
    if (open.has(new Date(ms).getUTCDay())) out.push(formatIsoDay(ms));
  }
  return out;
}
