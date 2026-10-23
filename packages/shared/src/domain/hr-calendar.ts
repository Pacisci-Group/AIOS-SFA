/**
 * The agency calendar (PAC-161) — the wire contract between `/hr/calendar/*`
 * and the web, and the vocabulary `WorkingDaysService` computes with.
 *
 * ## A calendar day is a calendar fact, stored as `YYYY-MM-DD`
 *
 * Not an instant. PAC-159's rule (store the instant, bucket on the agency's
 * calendar at read time) is for when something *happened* — a sale, a quote,
 * a lead. A holiday names a day the way `ProducerGoal.month` names a month:
 * it does not move when the agency changes its zone. The zone enters only at
 * the boundary — "today", "which agency day does this instant fall on"
 * (`businessDay`), and the Q4 job's "is it October yet" (`localClock`).
 *
 * ## Nothing inserts a holiday row without a person ticking it
 *
 * Provisioning and the `hr_module` migration create the calendar with its
 * workweek and country/region only. Rows come from the onboarding Calendar
 * step, the settings "Import holidays for YEAR" dialog, or confirming a Q4
 * proposal — `date-holidays` marks Columbus Day and Washington's Birthday
 * `public`, and most private employers are open, so an unreviewed set would
 * over-count closures and every requested-hours figure after it.
 */

/** Sunday = 0 … Saturday = 6, as `Date#getUTCDay`. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const ALL_WEEKDAYS: readonly Weekday[] = [0, 1, 2, 3, 4, 5, 6];

/** Monday to Friday. */
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
 * What a row on the calendar *does* to the day:
 * - `holiday` / `closure` — the office is closed; not a working day whatever
 *   the workweek says. Two kinds because they are different facts to a reader
 *   ("Thanksgiving" vs "flooded, closed Tuesday"), and an export wants both.
 * - `special_working_day` — open although the workweek (or a weekend) says
 *   closed. The one kind that *adds* a working day.
 */
export const CALENDAR_DAY_KINDS = [
  'holiday',
  'closure',
  'special_working_day',
] as const;
export type CalendarDayKind = (typeof CALENDAR_DAY_KINDS)[number];

/** Where a row came from. `manual` is the only one that requires a reason. */
export const CALENDAR_DAY_SOURCES = [
  'onboarding',
  'import',
  'manual',
  'proposal',
] as const;
export type CalendarDaySource = (typeof CALENDAR_DAY_SOURCES)[number];

/** The `date-holidays` vocabulary, verbatim. Only `public` is pre-checked. */
export const HOLIDAY_SUGGESTION_TYPES = [
  'public',
  'bank',
  'school',
  'optional',
  'observance',
] as const;
export type HolidaySuggestionType = (typeof HOLIDAY_SUGGESTION_TYPES)[number];

/** The country the platform's agencies are in until one says otherwise. */
export const DEFAULT_CALENDAR_COUNTRY = 'US';

export interface CalendarActorView {
  id: string;
  name: string;
}

export interface AgencyCalendarDayView {
  id: string;
  /** `YYYY-MM-DD`. */
  date: string;
  kind: CalendarDayKind;
  label: string;
  source: CalendarDaySource;
  /** Required on `manual` rows; `null` otherwise. */
  reason: string | null;
  /** ISO-8601. */
  createdAt: string;
  /** `null` for a row written without a request context (a seed). */
  createdBy: CalendarActorView | null;
}

export interface HolidaySuggestion {
  /** `YYYY-MM-DD`. */
  date: string;
  name: string;
  type: HolidaySuggestionType;
  /** A substitute day (Friday for a Saturday holiday) — the actual closure. */
  substitute: boolean;
  /** `public` holidays are; the rest are offered unchecked. */
  preChecked: boolean;
  /** An active row already holds this date. */
  alreadyInCalendar: boolean;
}

export type HolidayProposalStatus = 'pending' | 'confirmed' | 'dismissed';

export interface HolidayProposalItemView {
  date: string;
  name: string;
  type: HolidaySuggestionType;
  substitute: boolean;
}

/** Next year's holidays, proposed by the Q4 job for one-click confirmation. */
export interface HolidayProposalView {
  year: number;
  status: HolidayProposalStatus;
  /** ISO-8601. */
  proposedAt: string;
  items: HolidayProposalItemView[];
}

export interface AgencyCalendarView {
  workweek: Weekday[];
  /** ISO 3166-1 alpha-2, or `null` until set. */
  country: string | null;
  /** A `date-holidays` state/province code (`OK`, `ON`), or `null`. */
  region: string | null;
  /** `Agency.timezone` — the calendar every "today" below is read on. */
  timeZone: string;
  /** The year asked for. */
  year: number;
  /** Active rows in `year`, sorted by date. */
  days: AgencyCalendarDayView[];
  /** `'YYYY-MM'` → working days in that month of `year`. */
  workingDaysByMonth: Record<string, number>;
  pendingProposal: HolidayProposalView | null;
}

export interface UpdateAgencyCalendarInput {
  workweek?: Weekday[];
  country?: string | null;
  region?: string | null;
}

export interface AddCalendarDayInput {
  date: string;
  kind: CalendarDayKind;
  label: string;
  /** Required when the batch's `source` is `manual`. */
  reason?: string;
}

export interface AddCalendarDaysInput {
  source: Extract<CalendarDaySource, 'onboarding' | 'import' | 'manual'>;
  days: AddCalendarDayInput[];
}

export interface AddCalendarDaysResponse {
  days: AgencyCalendarDayView[];
}

export interface RemoveCalendarDayInput {
  reason: string;
}

export interface ConfirmHolidayProposalInput {
  /** The subset of the proposal's dates to write. May be empty. */
  dates: string[];
}

export interface HolidaySuggestionsResponse {
  country: string;
  region: string | null;
  year: number;
  suggestions: HolidaySuggestion[];
}

export interface HolidayRegionOption {
  code: string;
  name: string;
}

export interface HolidayRegionsResponse {
  countries: HolidayRegionOption[];
  /** Regions of the requested country; empty when none was asked for or it has none. */
  regions: HolidayRegionOption[];
}

/**
 * An employee's weekly schedule, as PAC-162 will store it on the profile.
 * Defined here because `scheduledDaysBetween` computes with it now.
 *
 * `'HH:mm'` on the agency's clock. A missing or `null` weekday is a day the
 * employee is not scheduled, whatever the agency workweek says.
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
  /** Whether the agency is open that day (calendar + workweek). */
  working: boolean;
  /** Zero on a non-working or unscheduled day. */
  scheduledMinutes: number;
  reason: ScheduledDayReason;
}
