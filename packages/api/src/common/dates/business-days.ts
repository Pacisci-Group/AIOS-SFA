import {
  CalendarDate,
  addDays,
  toYmd,
} from '../../performance/performance.range';

/**
 * Business-day arithmetic on bare calendar dates (PAC-139).
 *
 * Exists for the Aging Audits rule — a deal's audit has five **business days**
 * from the sold date, "weekends and US public holidays excluded" — and there
 * was nothing in the repo to count them: the API has no date library, and the
 * legacy `daysOpen` was calendar days.
 *
 * Same discipline as `performance.range.ts`: every function takes and returns
 * a `{year, month, day}` triple and does its arithmetic through a UTC anchor,
 * so there is no timezone offset to get wrong. The one place an instant enters
 * is the caller asking `chicagoParts(now)` for today's date.
 *
 * ## Which holidays
 *
 * The eleven US federal holidays, by rule rather than by table, so no year has
 * to be typed in. When a fixed-date holiday falls on a weekend the federal
 * *observed* day is used (Saturday → the Friday before, Sunday → the Monday
 * after), which is when the office is actually closed. Nothing agency-specific
 * (no Good Friday, no company days) — the agency schema has no calendar, and
 * David named "US public holidays", nothing more.
 */

const SATURDAY = 6;
const SUNDAY = 0;

function dayOfWeek(date: CalendarDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * The `n`th `weekday` (0 = Sunday … 6 = Saturday) of a month; `n < 0` counts
 * from the end, so `-1` is the last one (Memorial Day).
 */
function nthWeekday(
  year: number,
  month: number,
  weekday: number,
  n: number,
): CalendarDate {
  if (n > 0) {
    const first = dayOfWeek({ year, month, day: 1 });
    const day = 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
    return { year, month, day };
  }
  const last = daysInMonth(year, month);
  const lastDow = dayOfWeek({ year, month, day: last });
  const day = last - ((lastDow - weekday + 7) % 7) + (n + 1) * 7;
  return { year, month, day };
}

/** The federal observed day for a fixed-date holiday landing on a weekend. */
function observed(date: CalendarDate): CalendarDate {
  const dow = dayOfWeek(date);
  if (dow === SATURDAY) return addDays(date, -1);
  if (dow === SUNDAY) return addDays(date, 1);
  return date;
}

/**
 * Every US federal holiday **observed within** `year`, as calendar dates.
 *
 * "Within" is the subtle part: New Year's Day of the *following* year can be
 * observed on 31 December of this one (2027-12-31 stands in for Saturday
 * 2028-01-01), and that day belongs to this year's closures.
 */
export function usFederalHolidays(year: number): CalendarDate[] {
  const MON = 1;
  const THU = 4;
  const fixed = (month: number, day: number) => observed({ year, month, day });

  const holidays: CalendarDate[] = [
    fixed(1, 1), // New Year's Day
    nthWeekday(year, 1, MON, 3), // Birthday of Martin Luther King, Jr.
    nthWeekday(year, 2, MON, 3), // Washington's Birthday
    nthWeekday(year, 5, MON, -1), // Memorial Day
    fixed(6, 19), // Juneteenth National Independence Day
    fixed(7, 4), // Independence Day
    nthWeekday(year, 9, MON, 1), // Labor Day
    nthWeekday(year, 10, MON, 2), // Columbus Day
    fixed(11, 11), // Veterans Day
    nthWeekday(year, 11, THU, 4), // Thanksgiving Day
    fixed(12, 25), // Christmas Day
  ];

  const nextNewYear = observed({ year: year + 1, month: 1, day: 1 });
  if (nextNewYear.year === year) holidays.push(nextNewYear);

  // A this-year New Year's observed on last year's 31 December is last year's.
  return holidays.filter((date) => date.year === year);
}

const holidayCache = new Map<number, Set<number>>();

function holidaySet(year: number): Set<number> {
  let set = holidayCache.get(year);
  if (!set) {
    set = new Set(usFederalHolidays(year).map(toYmd));
    holidayCache.set(year, set);
  }
  return set;
}

export function isWeekend(date: CalendarDate): boolean {
  const dow = dayOfWeek(date);
  return dow === SATURDAY || dow === SUNDAY;
}

export function isUsFederalHoliday(date: CalendarDate): boolean {
  return holidaySet(date.year).has(toYmd(date));
}

/** A weekday that is not a federal holiday. */
export function isBusinessDay(date: CalendarDate): boolean {
  return !isWeekend(date) && !isUsFederalHoliday(date);
}

/**
 * Step `n` business days from `date` (negative walks back). Starting on a
 * weekend or holiday is fine: the first step lands on the next business day
 * in that direction and counts as one.
 */
export function addBusinessDays(date: CalendarDate, n: number): CalendarDate {
  const step = n < 0 ? -1 : 1;
  let remaining = Math.abs(n);
  let cursor = date;
  while (remaining > 0) {
    cursor = addDays(cursor, step);
    if (isBusinessDay(cursor)) remaining -= 1;
  }
  return cursor;
}

/**
 * Business days in the half-open window `(from, to]` — how many working days
 * have *elapsed* since `from`, so a deal sold on a Friday and looked at on the
 * following Monday has had exactly one.
 *
 * Zero when `to` is not after `from`. Walks day by day: the windows this
 * serves are a few weeks long, and a formula for weekends still has to walk
 * the holidays.
 */
export function businessDaysBetween(
  from: CalendarDate,
  to: CalendarDate,
): number {
  let count = 0;
  let cursor = from;
  while (toYmd(cursor) < toYmd(to)) {
    cursor = addDays(cursor, 1);
    if (isBusinessDay(cursor)) count += 1;
  }
  return count;
}

/**
 * The oldest calendar date that has **not** yet run out of `slaDays` business
 * days as of `today`, so that a record dated *before* it is aging:
 *
 *     aging ⇔ toYmd(recordDate) < toYmd(agingCutoff(today, slaDays))
 *
 * Computed once per request so the Mongo predicate is a plain
 * `soldDateYmd < cutoff` that rides the existing `soldDateYmd` indexes, with
 * no per-row date maths in the pipeline. Equivalent to
 * `businessDaysBetween(recordDate, today) > slaDays`; the unit spec proves the
 * two agree.
 */
export function agingCutoff(
  today: CalendarDate,
  slaDays: number,
): CalendarDate {
  let cutoff = today;
  let elapsed = 0;
  for (;;) {
    // Moving the cutoff back a day brings `cutoff` itself into the elapsed
    // window `(cutoff − 1, today]`.
    const gained = isBusinessDay(cutoff) ? 1 : 0;
    if (elapsed + gained > slaDays) return cutoff;
    elapsed += gained;
    cutoff = addDays(cutoff, -1);
  }
}
