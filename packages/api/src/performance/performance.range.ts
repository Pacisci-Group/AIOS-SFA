/**
 * Chicago calendar-day windows for the Producer Dashboard (PAC-9).
 *
 * Every range-driven read on the dashboard compares against a `YYYYMMDD`
 * integer — `Deal.soldDateYmd` and `QuoteRecap.quoteDateYmd` — so this module's
 * only job is turning a range key into a half-open `[startYmd, endYmd)` pair.
 *
 * **No instants are involved.** All arithmetic runs on the bare
 * `{year, month, day}` triple via a UTC anchor, which is what makes it
 * DST-immune: there is no 05:00Z-vs-06:00Z offset to get wrong, because no
 * offset is ever applied. The timezone is consulted exactly once, to ask "what
 * is today's date in Chicago?".
 *
 * Ported from `SFA/app/api/leaderboard/route.ts` (`getChicagoParts` /
 * `getMtdChicagoYyyymmddRange`), which is the cleanest of the three date
 * implementations in the legacy app. The bucket *meanings* come from
 * `SFA/lib/performance/getPerformanceBuckets.ts` — dead code that never ran,
 * and whose UTC arithmetic is deliberately **not** ported.
 */

export const AGENCY_TIME_ZONE = 'America/Chicago';

export const RANGE_KEYS = [
  'today',
  'week',
  'mtd',
  'lastMonth',
  'custom',
] as const;

export type RangeKey = (typeof RANGE_KEYS)[number];

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

/** What calendar date is it in Chicago at this instant? */
export function chicagoParts(at: Date): CalendarDate {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: AGENCY_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);

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

/** The current goal month in Chicago, `YYYY-MM`. */
export function currentChicagoMonth(now: Date = new Date()): string {
  const today = chicagoParts(now);
  return `${today.year}-${String(today.month).padStart(2, '0')}`;
}

/**
 * The last `count` goal months in Chicago, newest first, including this one.
 *
 * The migration writes a producer goal per month across this window (PAC-80).
 * SmartSuite stores a single standing "Monthly Goal" with no month dimension,
 * so writing it into only the run-month left every other month goal-less — the
 * leaderboard's `?month=` is answerable for one month and blank for the rest,
 * and the current month's goals expire silently at the rollover.
 */
export function recentChicagoMonths(
  count: number,
  now: Date = new Date(),
): string[] {
  const today = chicagoParts(now);
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
 *
 * | key | window (Chicago calendar days) |
 * |---|---|
 * | `today` | `[T, T+1)` |
 * | `week` | `[T-6, T+1)` — rolling trailing 7 days **including today**, not a calendar week |
 * | `mtd` | `[1st of T's month, T+1)` |
 * | `lastMonth` | `[1st of previous month, 1st of T's month)` |
 * | `custom` | `[from, to+1)` — the API's `to` is inclusive |
 *
 * `mtd` deliberately stops at today rather than at month end, which diverges
 * from legacy's `getMtdChicagoYyyymmddRange`. A producer can type a future
 * `soldDate` on the Sold form, and "month to date" that counts next week's
 * sales is not month to date.
 *
 * `now` is injectable so the windows can be unit-tested against fixed instants
 * (the `daysSince` convention in `common/domain/deal-derive`).
 */
export function resolveRange(
  key: RangeKey,
  custom: { from?: string; to?: string } = {},
  now: Date = new Date(),
): YmdRange {
  const today = chicagoParts(now);

  if (key === 'custom') {
    if (!custom.from || !custom.to) {
      throw new Error('A custom range needs both from and to.');
    }
    return build(parseIsoDate(custom.from), parseIsoDate(custom.to));
  }

  switch (key) {
    case 'today':
      return build(today, today);
    case 'week':
      return build(addDays(today, -6), today);
    case 'mtd':
      return build({ ...today, day: 1 }, today);
    case 'lastMonth': {
      const firstOfThisMonth: CalendarDate = { ...today, day: 1 };
      const lastOfPrevMonth = addDays(firstOfThisMonth, -1);
      return build({ ...lastOfPrevMonth, day: 1 }, lastOfPrevMonth);
    }
  }
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
