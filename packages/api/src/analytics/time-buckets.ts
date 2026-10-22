import type { AnalyticsBucket, AnalyticsInterval } from '@sfa/shared';
import { requireTimeZone } from '../common/dates/time-zones';
import {
  addDays,
  type CalendarDate,
  parseIsoDate,
  toIsoDate,
  type YmdRange,
} from '../performance/performance.range';

/**
 * Time buckets for the Analytics trends (PAC-152, part 2).
 *
 * One key format for every source, so one fill function serves sales and
 * tickets alike: `YYYY-MM-DD` for a day, the **Monday** a week starts on for a
 * week, `YYYY-MM` for a month.
 *
 * Sales, quotes and tickets all store real instants (PAC-159), so every
 * bucket is cut in the agency's zone by Mongo's own `timezone` option — the
 * same calendar `instantWindow` selects the rows on.
 */

const FORMAT: Record<AnalyticsInterval, string> = {
  day: '%Y-%m-%d',
  week: '%Y-%m-%d',
  month: '%Y-%m',
};

/** The bucket key of an instant field, on the agency's calendar. */
export function instantBucketExpr(
  field: string,
  interval: AnalyticsInterval,
  timeZone: string,
) {
  const timezone = requireTimeZone(timeZone);
  const date = `$${field}`;
  return {
    $dateToString: {
      format: FORMAT[interval],
      timezone,
      date:
        interval === 'week'
          ? {
              $dateTrunc: {
                date,
                unit: 'week',
                startOfWeek: 'monday',
                timezone,
              },
            }
          : date,
    },
  };
}

function weekStart(date: CalendarDate): CalendarDate {
  const dow = new Date(
    Date.UTC(date.year, date.month - 1, date.day),
  ).getUTCDay();
  // getUTCDay: 0 = Sunday. Days since the Monday on or before `date`.
  return addDays(date, -((dow + 6) % 7));
}

function monthEnd(date: CalendarDate): CalendarDate {
  const last = new Date(Date.UTC(date.year, date.month, 0)).getUTCDate();
  return { year: date.year, month: date.month, day: last };
}

function nextMonth(date: CalendarDate): CalendarDate {
  return date.month === 12
    ? { year: date.year + 1, month: 1, day: 1 }
    : { year: date.year, month: date.month + 1, day: 1 };
}

const minIso = (a: string, b: string) => (a < b ? a : b);
const maxIso = (a: string, b: string) => (a > b ? a : b);

/**
 * Every bucket the window touches, in order — the zero-filled x axis. `from`
 * and `to` are clamped to the window, so the first week of a window that
 * starts on a Wednesday reads "Wed – Sun", not "Mon – Sun".
 */
export function bucketsBetween(
  range: Pick<YmdRange, 'from' | 'to'>,
  interval: AnalyticsInterval,
): AnalyticsBucket[] {
  const first = parseIsoDate(range.from);
  const buckets: AnalyticsBucket[] = [];

  let cursor =
    interval === 'week'
      ? weekStart(first)
      : interval === 'month'
        ? { ...first, day: 1 }
        : first;

  while (toIsoDate(cursor) <= range.to) {
    const end =
      interval === 'day'
        ? cursor
        : interval === 'week'
          ? addDays(cursor, 6)
          : monthEnd(cursor);
    buckets.push({
      key:
        interval === 'month'
          ? toIsoDate(cursor).slice(0, 7)
          : toIsoDate(cursor),
      from: maxIso(toIsoDate(cursor), range.from),
      to: minIso(toIsoDate(end), range.to),
    });
    cursor =
      interval === 'day'
        ? addDays(cursor, 1)
        : interval === 'week'
          ? addDays(cursor, 7)
          : nextMonth(cursor);
  }
  return buckets;
}

/** `bucketsBetween` with a value per bucket, `empty()` where nothing landed. */
export function fillBuckets<T>(
  range: Pick<YmdRange, 'from' | 'to'>,
  interval: AnalyticsInterval,
  values: ReadonlyMap<string, T>,
  empty: () => T,
): (AnalyticsBucket & { value: T })[] {
  return bucketsBetween(range, interval).map((bucket) => ({
    ...bucket,
    value: values.get(bucket.key) ?? empty(),
  }));
}
