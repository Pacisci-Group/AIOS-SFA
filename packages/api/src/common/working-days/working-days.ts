import type {
  CalendarDayKind,
  ScheduledDay,
  ScheduledDayReason,
  Weekday,
  WorkSchedule,
} from '@sfa/shared';
import {
  type CalendarDate,
  addDays,
  parseIsoDate,
  toIsoDate,
  toYmd,
} from '../../performance/performance.range';

/**
 * Working-day arithmetic on an agency's own calendar (PAC-161) — the one
 * place anything in the HR module counts days.
 *
 * Pure: no Mongo, no zone. Everything takes and returns a `CalendarDate`
 * triple and does its arithmetic through UTC anchors, the discipline
 * `performance.range.ts` and `business-days.ts` already follow, so a DST
 * change cannot shift a count. The one place an instant enters is the caller
 * asking `zonedDate(now, timeZone)` for today on the agency's calendar.
 *
 * ## Precedence
 *
 * A `special_working_day` row wins over everything (the office is open on a
 * Saturday); a `holiday` or `closure` row loses to nothing (closed is closed,
 * whatever the workweek says). With no row, the workweek decides.
 *
 * ## Not `business-days.ts`
 *
 * That module hard-codes US federal holidays for the Manager view's audit
 * aging (PAC-139) and takes no calendar. Moving it onto this one is a
 * follow-up with a product question attached (should aging change for an
 * agency that observes fewer holidays?); until then the two coexist and this
 * one is what HR uses.
 */

export interface CalendarSnapshot {
  workweek: ReadonlySet<Weekday>;
  /** `YYYY-MM-DD` → kind, active rows only. */
  days: ReadonlyMap<string, CalendarDayKind>;
}

export function snapshotFrom(
  workweek: readonly Weekday[],
  days: readonly { date: string; kind: CalendarDayKind }[],
): CalendarSnapshot {
  return {
    workweek: new Set(workweek),
    days: new Map(days.map((row) => [row.date, row.kind])),
  };
}

function weekdayOf(date: CalendarDate): Weekday {
  return new Date(
    Date.UTC(date.year, date.month - 1, date.day),
  ).getUTCDay() as Weekday;
}

/**
 * Why the day is or is not a working day. `scheduled` here means "open by the
 * workweek, no row" — the caller overlays the employee schedule on top.
 */
export function dayReason(
  calendar: CalendarSnapshot,
  date: CalendarDate,
): Exclude<ScheduledDayReason, 'not_scheduled'> {
  const kind = calendar.days.get(toIsoDate(date));
  if (kind === 'holiday') return 'holiday';
  if (kind === 'closure') return 'closure';
  if (kind === 'special_working_day') return 'scheduled';
  return calendar.workweek.has(weekdayOf(date)) ? 'scheduled' : 'weekend';
}

export function isWorkingDay(
  calendar: CalendarSnapshot,
  date: CalendarDate,
): boolean {
  return dayReason(calendar, date) === 'scheduled';
}

function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function workingDaysInMonth(
  calendar: CalendarSnapshot,
  year: number,
  month: number,
): number {
  let count = 0;
  const last = daysInMonth(year, month);
  for (let day = 1; day <= last; day += 1) {
    if (isWorkingDay(calendar, { year, month, day })) count += 1;
  }
  return count;
}

/**
 * Working days in the **inclusive** range `[from, to]`; zero when `to`
 * precedes `from`. Inclusive because every caller is asking about a span of
 * leave ("how many working days from the 3rd to the 7th?") — unlike
 * `business-days.ts`'s half-open "days elapsed since", which is a different
 * question and is documented as such there.
 */
export function workingDaysBetween(
  calendar: CalendarSnapshot,
  from: CalendarDate,
  to: CalendarDate,
): number {
  let count = 0;
  let cursor = from;
  const end = toYmd(to);
  while (toYmd(cursor) <= end) {
    if (isWorkingDay(calendar, cursor)) count += 1;
    cursor = addDays(cursor, 1);
  }
  return count;
}

/**
 * Step `n` working days from `date` (negative walks back). Starting on a
 * non-working day is fine: the first step lands on the next working day in
 * that direction and counts as one. The reminder jobs' "N business days
 * after submit" is this.
 */
export function addBusinessDays(
  calendar: CalendarSnapshot,
  date: CalendarDate,
  n: number,
): CalendarDate {
  const step = n < 0 ? -1 : 1;
  let remaining = Math.abs(n);
  let cursor = date;
  while (remaining > 0) {
    cursor = addDays(cursor, step);
    if (isWorkingDay(calendar, cursor)) remaining -= 1;
  }
  return cursor;
}

/** `'HH:mm'` → minutes since midnight; `null` for anything malformed. */
export function parseClock(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Minutes in a scheduled day; zero for a malformed or inverted pair. */
export function scheduledMinutes(day: { start: string; end: string }): number {
  const start = parseClock(day.start);
  const end = parseClock(day.end);
  if (start === null || end === null || end <= start) return 0;
  return end - start;
}

/**
 * One entry per calendar day in the inclusive range, overlaying the
 * employee's weekly schedule on the agency calendar: the per-day breakdown a
 * time-off request freezes (PAC-165 computes requested hours from it).
 *
 * A day contributes minutes only when the agency is open **and** the
 * employee is scheduled; the reason says which of the two said no.
 */
export function scheduledDaysBetween(
  calendar: CalendarSnapshot,
  schedule: WorkSchedule,
  from: CalendarDate,
  to: CalendarDate,
): ScheduledDay[] {
  const out: ScheduledDay[] = [];
  let cursor = from;
  const end = toYmd(to);
  while (toYmd(cursor) <= end) {
    const reason = dayReason(calendar, cursor);
    const working = reason === 'scheduled';
    const shift = working ? (schedule[weekdayOf(cursor)] ?? null) : null;
    const minutes = shift ? scheduledMinutes(shift) : 0;
    out.push({
      date: toIsoDate(cursor),
      working,
      scheduledMinutes: minutes,
      reason: working && !shift ? 'not_scheduled' : reason,
    });
    cursor = addDays(cursor, 1);
  }
  return out;
}

/** `'YYYY-MM-DD'` → `CalendarDate`, for callers holding the stored form. */
export function calendarDate(iso: string): CalendarDate {
  return parseIsoDate(iso);
}
