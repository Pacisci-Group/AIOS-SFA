/**
 * Calendar-day windows on the agency's own clock (PAC-9, PAC-141).
 *
 * Every range-driven read on the dashboards compares against a `YYYYMMDD`
 * integer — `Deal.soldDateYmd` and `QuoteRecap.quoteDateYmd` — so this module's
 * only job is turning a range key into a half-open `[startYmd, endYmd)` pair.
 *
 * **No instants are involved.** All arithmetic runs on the bare
 * `{year, month, day}` triple via a UTC anchor, which is what makes it
 * DST-immune: there is no 05:00Z-vs-06:00Z offset to get wrong, because no
 * offset is ever applied. The timezone is consulted exactly once, to ask "what
 * is today's date *here*?" — and "here" is `Agency.timezone`, passed in by the
 * caller as a **required** argument. It used to be a module constant
 * (`AGENCY_TIME_ZONE = 'America/Chicago'`); the constant is gone rather than
 * demoted to a default, because a default is how it would have survived.
 *
 * ## Stored day labels do not move with the zone
 *
 * `Deal.soldDateYmd`, `QuoteRecap.quoteDateYmd` and `ProducerGoal.month` are
 * written once, on the agency's calendar *at the time of writing*. Changing an
 * agency's zone later does not rewrite them — history keeps the day it was
 * filed on, and only windows resolved from now on move. Rows the SmartSuite
 * migration imported carry the day SmartSuite stated, whatever the zone.
 *
 * Ported from `SFA/app/api/leaderboard/route.ts` (`getChicagoParts` /
 * `getMtdChicagoYyyymmddRange`), which is the cleanest of the three date
 * implementations in the legacy app. The bucket *meanings* come from
 * `SFA/lib/performance/getPerformanceBuckets.ts` — dead code that never ran,
 * and whose UTC arithmetic is deliberately **not** ported.
 */

import type { OwnerDashboardRangeKey } from '@sfa/shared';
import { requireTimeZone } from '../common/dates/time-zones';

export const RANGE_KEYS = [
  'today',
  'week',
  'mtd',
  'lastMonth',
  'custom',
] as const;

export type RangeKey = (typeof RANGE_KEYS)[number];

/**
 * Every key {@link resolveRange} understands: the Producer Dashboard's
 * {@link RANGE_KEYS} plus the Owner dashboard's longer presets (PAC-135).
 *
 * The two lists stay separate on purpose. Each endpoint's DTO accepts only its
 * own chips — widening `RANGE_KEYS` would make `GET /performance` quietly accept
 * `lastYear`, a window its `$addToSet` was never sized for.
 */
export type AnyRangeKey = RangeKey | OwnerDashboardRangeKey;

/**
 * Upper bound on a custom window, in inclusive days. Load-bearing, not
 * cosmetic: the performance pipeline accumulates distinct households with
 * `$addToSet`, and this is what bounds that set.
 */
export const MAX_CUSTOM_SPAN_DAYS = 366;

/** A calendar date with no timezone attached. `month` is 1-12. */
export interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

export interface YmdRange {
  /** Inclusive lower bound, `YYYYMMDD`. */
  startYmd: number;
  /** **Exclusive** upper bound, `YYYYMMDD`. */
  endYmd: number;
  /** Inclusive `YYYY-MM-DD` bounds, for echoing the resolved window back. */
  from: string;
  to: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * One formatter per zone, built on first use. `Intl.DateTimeFormat` is
 * expensive to construct and cheap to call, and {@link zonedDayStart} calls it
 * a few dozen times per answer. Bounded by the number of distinct zones the
 * process ever sees.
 */
const dateFormatters = new Map<string, Intl.DateTimeFormat>();

function dateFormatter(timeZone: string): Intl.DateTimeFormat {
  const zone = requireTimeZone(timeZone);
  let formatter = dateFormatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    dateFormatters.set(zone, formatter);
  }
  return formatter;
}

/** What calendar date is it in `timeZone` at this instant? */
export function zonedDate(at: Date, timeZone: string): CalendarDate {
  const parts = dateFormatter(timeZone).formatToParts(at);

  const get = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');

  return { year: get('year'), month: get('month'), day: get('day') };
}

export function toYmd(date: CalendarDate): number {
  return date.year * 10_000 + date.month * 100 + date.day;
}

export function toIsoDate(date: CalendarDate): string {
  const month = String(date.month).padStart(2, '0');
  const day = String(date.day).padStart(2, '0');
  return `${date.year}-${month}-${day}`;
}

/**
 * Calendar arithmetic through a UTC anchor. `Date.UTC` normalizes overflow, so
 * `addDays({2026, 1, 31}, 1)` gives February 1 and `addDays(…, -1)` walks back
 * across month and year boundaries for free.
 */
export function addDays(date: CalendarDate, delta: number): CalendarDate {
  const anchor = new Date(Date.UTC(date.year, date.month - 1, date.day));
  anchor.setUTCDate(anchor.getUTCDate() + delta);
  return {
    year: anchor.getUTCFullYear(),
    month: anchor.getUTCMonth() + 1,
    day: anchor.getUTCDate(),
  };
}

/** `true` for a real calendar date — rejects `2026-02-31` and friends. */
export function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = parseIsoDate(value);
  // A round-trip catches overflow: Date.UTC turns Feb 31 into Mar 3.
  return toIsoDate(parsed) === value;
}

/** Assumes a well-formed `YYYY-MM-DD`; validate with {@link isValidIsoDate}. */
export function parseIsoDate(value: string): CalendarDate {
  const anchor = new Date(`${value}T00:00:00.000Z`);
  return {
    year: anchor.getUTCFullYear(),
    month: anchor.getUTCMonth() + 1,
    day: anchor.getUTCDate(),
  };
}

/** Inclusive day count: a single day spans 1, a full leap year spans 366. */
export function spanDays(from: string, to: string): number {
  const start = parseIsoDate(from);
  const end = parseIsoDate(to);
  const startMs = Date.UTC(start.year, start.month - 1, start.day);
  const endMs = Date.UTC(end.year, end.month - 1, end.day);
  return Math.floor((endMs - startMs) / 86_400_000) + 1;
}

/** The current goal month in `timeZone`, `YYYY-MM`. */
export function currentMonthIn(
  timeZone: string,
  now: Date = new Date(),
): string {
  const today = zonedDate(now, timeZone);
  return `${today.year}-${String(today.month).padStart(2, '0')}`;
}

/**
 * The last `count` goal months in `timeZone`, newest first, including this one.
 *
 * The migration writes a producer goal per month across this window (PAC-80).
 * SmartSuite stores a single standing "Monthly Goal" with no month dimension,
 * so writing it into only the run-month left every other month goal-less — the
 * leaderboard's `?month=` is answerable for one month and blank for the rest,
 * and the current month's goals expire silently at the rollover.
 */
export function recentMonthsIn(
  count: number,
  timeZone: string,
  now: Date = new Date(),
): string[] {
  const today = zonedDate(now, timeZone);
  const months: string[] = [];
  for (let back = 0; back < count; back++) {
    // Step back through the 1st of each month; `Date.UTC` normalizes the
    // year boundary, the same trick `addDays` relies on.
    const anchor = new Date(Date.UTC(today.year, today.month - 1 - back, 1));
    const month = String(anchor.getUTCMonth() + 1).padStart(2, '0');
    months.push(`${anchor.getUTCFullYear()}-${month}`);
  }
  return months;
}

/**
 * Resolve a range key into the half-open window every dashboard read uses.
 * `T` is today on the agency's calendar — {@link zonedDate} of `now` in
 * `timeZone`.
 *
 * | key | window (agency calendar days) |
 * |---|---|
 * | `today` | `[T, T+1)` |
 * | `week` | `[T-6, T+1)` — rolling trailing 7 days **including today**, not a calendar week |
 * | `mtd` | `[1st of T's month, T+1)` |
 * | `lastMonth` | `[1st of previous month, 1st of T's month)` |
 * | `last3Months` | the three **complete** calendar months before T's month |
 * | `ytd` | `[Jan 1 of T's year, T+1)` |
 * | `lastYear` | the whole previous calendar year |
 * | `custom` | `[from, to+1)` — the API's `to` is inclusive |
 *
 * `mtd` deliberately stops at today rather than at month end, which diverges
 * from legacy's `getMtdChicagoYyyymmddRange`. A producer can type a future
 * `soldDate` on the Sold form, and "month to date" that counts next week's
 * sales is not month to date.
 *
 * `timeZone` comes second, ahead of the optional arguments, so that a call
 * written against the old `(key, custom, now)` shape is a type error rather
 * than a window cut on the wrong calendar. `now` is injectable so the windows
 * can be unit-tested against fixed instants (the `daysSince` convention in
 * `common/domain/deal-derive`).
 */
export function resolveRange(
  key: AnyRangeKey,
  timeZone: string,
  custom: { from?: string; to?: string } = {},
  now: Date = new Date(),
): YmdRange {
  // Checked even for `custom`, which never reads it: a stale call site is a
  // bug on every key, and this is the one branch that would otherwise hide it.
  requireTimeZone(timeZone);

  if (key === 'custom') {
    if (!custom.from || !custom.to) {
      throw new Error('A custom range needs both from and to.');
    }
    return customRange(custom.from, custom.to);
  }

  const today = zonedDate(now, timeZone);

  switch (key) {
    case 'today':
      return build(today, today);
    case 'week':
      return build(addDays(today, -6), today);
    case 'mtd':
      return build({ ...today, day: 1 }, today);
    case 'lastMonth':
      return wholeMonths(today, -1, 1);
    case 'last3Months':
      return wholeMonths(today, -3, 3);
    case 'ytd':
      return build({ year: today.year, month: 1, day: 1 }, today);
    case 'lastYear':
      return wholeYear(today.year - 1);
  }
}

/**
 * The window for two inclusive `YYYY-MM-DD` bounds. No zone is involved: the
 * caller already named the days. This is what `custom` resolves to, and what a
 * caller that has a fixed calendar month in hand (the leaderboard) uses rather
 * than asking {@link resolveRange} for a zone it would ignore.
 */
export function customRange(from: string, to: string): YmdRange {
  return build(parseIsoDate(from), parseIsoDate(to));
}

/**
 * The window a range is **compared against** — the Owner dashboard's trend
 * badges and "vs …" line (PAC-135).
 *
 * | key | compared with |
 * |---|---|
 * | `mtd` | the same elapsed days of the previous month: Sep 1–21 → Aug 1–21 |
 * | `lastMonth` | the month before it |
 * | `last3Months` | the three months before those |
 * | `ytd` | Jan 1 → the same day, one year earlier |
 * | `lastYear` | the year before it |
 * | anything else | the immediately preceding span of equal length |
 *
 * ## Why presets are not "the preceding span of equal length"
 *
 * That rule is right for a custom window and wrong for every preset. For
 * `mtd` on Sep 21 it yields Aug 11–31, which nobody means by "vs last month";
 * comparing against *all* of August instead shows red until the month ends; and
 * "equal length" is not even true of calendar months — February against
 * January. David's wording was "the same time period of the previous month",
 * which is what this does: shift by the calendar unit, keep the elapsed part.
 *
 * A day that does not exist in the earlier month clamps to its last day —
 * Mar 31 compares with Feb 1–28, and a leap-day `ytd` with Feb 28.
 */
export function resolveComparison(
  key: AnyRangeKey,
  timeZone: string,
  custom: { from?: string; to?: string } = {},
  now: Date = new Date(),
): YmdRange {
  const today = zonedDate(now, timeZone);

  switch (key) {
    case 'mtd': {
      const first = addMonths({ ...today, day: 1 }, -1);
      return build(first, clampDay(first, today.day));
    }
    case 'lastMonth':
      return wholeMonths(today, -2, 1);
    case 'last3Months':
      return wholeMonths(today, -6, 3);
    case 'ytd': {
      const year = today.year - 1;
      return build(
        { year, month: 1, day: 1 },
        clampDay({ year, month: today.month, day: 1 }, today.day),
      );
    }
    case 'lastYear':
      return wholeYear(today.year - 2);
    default: {
      // `today`, `week` and `custom`: the span itself is the unit.
      const current = resolveRange(key, timeZone, custom, now);
      const from = parseIsoDate(current.from);
      const days = spanDays(current.from, current.to);
      return build(addDays(from, -days), addDays(from, -1));
    }
  }
}

/** The 1st of the month `delta` months from `date`'s. `Date.UTC` normalizes years. */
function addMonths(date: CalendarDate, delta: number): CalendarDate {
  const anchor = new Date(Date.UTC(date.year, date.month - 1 + delta, 1));
  return {
    year: anchor.getUTCFullYear(),
    month: anchor.getUTCMonth() + 1,
    day: 1,
  };
}

/** `day` within `month`'s own length — the 31st of a 30-day month is the 30th. */
function clampDay(month: CalendarDate, day: number): CalendarDate {
  // Day 0 of the next month is the last day of this one.
  const last = new Date(Date.UTC(month.year, month.month, 0)).getUTCDate();
  return { year: month.year, month: month.month, day: Math.min(day, last) };
}

/** `count` complete calendar months, starting `offset` months from `today`'s. */
function wholeMonths(
  today: CalendarDate,
  offset: number,
  count: number,
): YmdRange {
  const first = addMonths({ ...today, day: 1 }, offset);
  const lastMonth = addMonths(first, count - 1);
  return build(first, clampDay(lastMonth, 31));
}

function wholeYear(year: number): YmdRange {
  return build({ year, month: 1, day: 1 }, { year, month: 12, day: 31 });
}

/** `to` is inclusive on the way in; `endYmd` is exclusive on the way out. */
function build(from: CalendarDate, to: CalendarDate): YmdRange {
  return {
    startYmd: toYmd(from),
    endYmd: toYmd(addDays(to, 1)),
    from: toIsoDate(from),
    to: toIsoDate(to),
  };
}

/** The `{year, month, day}` behind a `YYYYMMDD` integer. */
export function fromYmd(ymd: number): CalendarDate {
  return {
    year: Math.floor(ymd / 10_000),
    month: Math.floor(ymd / 100) % 100,
    day: ymd % 100,
  };
}

/** No zone is further than this from UTC: Pacific/Kiritimati is UTC+14. */
const MAX_AHEAD_OF_UTC_MS = 15 * 3_600_000;
/** …and Etc/GMT+12 / Baker Island is UTC−12. */
const MAX_BEHIND_UTC_MS = 13 * 3_600_000;

/**
 * The UTC instant at which `date` begins in `timeZone` — for windowing a
 * collection that stores real instants (`serviceTickets.openedAt`) rather than
 * a `YYYYMMDD` integer.
 *
 * A binary search for the first instant whose {@link zonedDate} is on or after
 * `date`, bracketed by the widest offsets any zone has. The local calendar
 * date never runs backwards as the instant advances, so the predicate is
 * monotone and the search is exact to the millisecond — no offset is assumed
 * anywhere, which is what makes it right for half-hour zones (Asia/Kolkata
 * starts its day at 18:30Z), quarter-hour ones (Asia/Kathmandu), zones past
 * UTC+12, and a DST change that falls on midnight itself (Africa/Cairo springs
 * forward from 00:00 to 01:00, so the day's first instant *is* 01:00 local).
 *
 * The previous implementation walked back an hour at a time from noon UTC. It
 * was right for Chicago, which is all it was ever asked about, and wrong by
 * thirty minutes for Kolkata and by a whole day for Kiritimati.
 */
export function zonedDayStart(date: CalendarDate, timeZone: string): Date {
  const ymd = toYmd(date);
  const midnightUtc = Date.UTC(date.year, date.month - 1, date.day);
  // Invariant: `lo` is still on the day before, `hi` is on `date` or later.
  let lo = midnightUtc - MAX_AHEAD_OF_UTC_MS;
  let hi = midnightUtc + MAX_BEHIND_UTC_MS;
  while (hi - lo > 1) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (toYmd(zonedDate(new Date(mid), timeZone)) >= ymd) {
      hi = mid;
    } else {
      lo = mid;
    }
  }
  return new Date(hi);
}
