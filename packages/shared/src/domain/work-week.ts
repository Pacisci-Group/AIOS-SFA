/**
 * The weekday and schedule vocabulary of the HR module (PAC-161) — what a
 * Work week policy stores and what `WorkingDaysService` computes with.
 *
 * A day is a calendar fact, stored as `YYYY-MM-DD`, never an instant: a
 * holiday names a day the way `ProducerGoal.month` names a month, and it does
 * not move when the agency changes its zone. The zone enters only at the
 * boundary — "today" on the agency's clock.
 */

/** Sunday = 0 … Saturday = 6, as `Date#getUTCDay`. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const ALL_WEEKDAYS: readonly Weekday[] = [0, 1, 2, 3, 4, 5, 6];

/** Monday to Friday — the week of anyone in no Work week policy. */
export const DEFAULT_WORKWEEK: readonly Weekday[] = [1, 2, 3, 4, 5];

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  0: 'Sunday',
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
};

/**
 * What a dated row does to a day in a working-day snapshot:
 * - `holiday` / `closure` — closed, whatever the week says. Holidays come
 *   from the person's Holiday policy; closures arrive with the agency
 *   calendar page (PAC-169).
 * - `special_working_day` — open although the week says closed (PAC-169).
 */
export const CALENDAR_DAY_KINDS = [
  'holiday',
  'closure',
  'special_working_day',
] as const;
export type CalendarDayKind = (typeof CALENDAR_DAY_KINDS)[number];

/**
 * One scheduled day of a week: `'HH:mm'` on the agency's clock. A weekday
 * missing from a {@link WorkSchedule} (or `null`) is a day off.
 */
export interface WorkScheduleDay {
  start: string;
  end: string;
}
export type WorkSchedule = Partial<Record<Weekday, WorkScheduleDay | null>>;

/** Why a day contributes what it does to a requested-hours figure. */
export type ScheduledDayReason =
  | 'scheduled'
  | 'weekend'
  | 'holiday'
  | 'closure'
  | 'not_scheduled';

export interface ScheduledDay {
  /** `YYYY-MM-DD`. */
  date: string;
  /** Whether the day is open (holidays + week). */
  working: boolean;
  /** Zero on a non-working or unscheduled day. */
  scheduledMinutes: number;
  reason: ScheduledDayReason;
}
