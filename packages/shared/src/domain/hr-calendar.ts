/**
 * The HR calendar (PAC-169): what `GET /hr/calendar` returns for a range of
 * days, and the pure date maths behind it.
 *
 * Every entry is **whole days**, `firstDay` to `lastDay` inclusive — the
 * shape every HR fact already has. FullCalendar's all-day `end` is
 * exclusive; {@link toExclusiveEnd} and {@link fromExclusiveEnd} are the
 * only two places that difference is allowed to exist.
 *
 * Who receives what is the API's to decide (`hr-calendar-access.ts`); the
 * union below is shaped so a withheld fact is *absent*, not nulled-by-habit:
 * a colleague's leave arrives with `detail: null`, a birthday never carries
 * a year.
 */
import type { AgencyEventEffect } from './agency-event';
import { anniversaryMonthDay } from './time-off-accrual';
import { addIsoDays } from './us-holidays';

type IsoDate = string;

/** The widest range one read may ask for — a six-week month grid is 42. */
export const HR_CALENDAR_MAX_RANGE_DAYS = 92;

export const HR_CALENDAR_ENTRY_KINDS = [
  'holiday',
  'event',
  'leave',
  'birthday',
  'anniversary',
] as const;
export type HrCalendarEntryKind = (typeof HR_CALENDAR_ENTRY_KINDS)[number];

export interface HrCalendarPersonRef {
  id: string;
  name: string;
}

interface EntryBase {
  /** Unique within one response; stable across reads. */
  id: string;
  firstDay: IsoDate;
  lastDay: IsoDate;
}

export interface HrCalendarHolidayEntry extends EntryBase {
  kind: 'holiday';
  name: string;
  /** Set when the holiday itself falls on another day (a weekend). */
  observedFor: IsoDate | null;
  /** The viewer's own Holiday policy closes these days. */
  mine: boolean;
  /** The Holiday policies that close them, by name. */
  policies: string[];
}

export interface HrCalendarEventEntry extends EntryBase {
  kind: 'event';
  eventId: string;
  name: string;
  description: string | null;
  startTime: string | null;
  endTime: string | null;
  effect: AgencyEventEffect;
  audienceLabel: string;
  /** False only for an HR admin looking at an event they are not in. */
  appliesToMe: boolean;
}

/** An event a request's charged days run into. */
export interface LeaveEventConflict {
  eventId: string;
  name: string;
  effect: Exclude<AgencyEventEffect, 'none'>;
  /** The days the request takes hours on that the event blocks or closes. */
  dates: IsoDate[];
}

export interface HrCalendarLeaveDetail {
  requestId: string;
  reference: string | null;
  policyName: string | null;
  totalHours: number;
  conflicts: LeaveEventConflict[];
}

export interface HrCalendarLeaveEntry extends EntryBase {
  kind: 'leave';
  person: HrCalendarPersonRef;
  mine: boolean;
  /** `pending` = Submitted or Changes Requested. */
  status: 'approved' | 'pending';
  /** Some day of it is less than the full scheduled day. */
  partial: boolean;
  /**
   * Present for the employee and for a reviewer whose scope covers the
   * request — the people who may open it. Anyone else sees that the person
   * is out and nothing about why.
   */
  detail: HrCalendarLeaveDetail | null;
}

export interface HrCalendarBirthdayEntry extends EntryBase {
  kind: 'birthday';
  person: HrCalendarPersonRef;
}

export interface HrCalendarAnniversaryEntry extends EntryBase {
  kind: 'anniversary';
  person: HrCalendarPersonRef;
  /** Full years of service on the day; one or more. */
  years: number;
}

export type HrCalendarEntry =
  | HrCalendarHolidayEntry
  | HrCalendarEventEntry
  | HrCalendarLeaveEntry
  | HrCalendarBirthdayEntry
  | HrCalendarAnniversaryEntry;

export interface HrCalendarViewer {
  /** Holds the team-calendar permission with a scope that reaches someone. */
  seesTeam: boolean;
  /** Also a reviewer: other people's pending requests are included. */
  seesPending: boolean;
  /** May add, change and remove events. */
  managesEvents: boolean;
}

/** `GET /hr/calendar`. */
export interface HrCalendarResponse {
  from: IsoDate;
  to: IsoDate;
  viewer: HrCalendarViewer;
  entries: HrCalendarEntry[];
}

/** `GET /hr/calendar/filters` — both empty for someone who sees no team. */
export interface HrCalendarFilters {
  branches: { id: string; name: string }[];
  people: { id: string; name: string; branchId: string | null }[];
}

// ── Date maths ───────────────────────────────────────────────────────────

/** FullCalendar's exclusive all-day `end` for an inclusive last day. */
export function toExclusiveEnd(lastDay: IsoDate): IsoDate {
  return addIsoDays(lastDay, 1);
}

/** The inclusive last day of a FullCalendar selection's exclusive `end`. */
export function fromExclusiveEnd(end: string): IsoDate {
  return addIsoDays(end.slice(0, 10), -1);
}

/**
 * Each time the month and day of `date` falls inside `[from, to]`, with the
 * number of years since `date`. A 29 February date is observed on 28
 * February in a year without one — the hire-anniversary convention. The year
 * of `date` itself is included (`years: 0`); callers that only want returns
 * filter on it.
 */
export function yearlyOccurrences(
  date: IsoDate,
  from: IsoDate,
  to: IsoDate,
): { date: IsoDate; years: number }[] {
  const origin = Number(date.slice(0, 4));
  const out: { date: IsoDate; years: number }[] = [];
  for (let year = Number(from.slice(0, 4)); year <= Number(to.slice(0, 4)); year += 1) {
    if (year < origin) continue;
    const day = `${String(year).padStart(4, '0')}-${anniversaryMonthDay(date, year)}`;
    if (day >= from && day <= to) out.push({ date: day, years: year - origin });
  }
  return out;
}

/** One Holiday policy's closure on one day, before the layers are merged. */
export interface HolidayRow {
  date: IsoDate;
  name: string;
  observedFor: IsoDate | null;
  policyName: string;
  /** The viewer is in this policy. */
  mine: boolean;
}

/**
 * The holiday layer from every policy in view: one entry per name and run
 * of days. Two policies closing the same day under the same name are one
 * entry naming both; a custom "Winter closure" of five consecutive days is
 * one five-day entry, not five. Sorted by first day, then name.
 */
export function mergeHolidays(rows: readonly HolidayRow[]): HrCalendarHolidayEntry[] {
  const byDay = new Map<
    string,
    { date: IsoDate; name: string; observedFor: IsoDate | null; mine: boolean; policies: Set<string> }
  >();
  for (const row of rows) {
    const key = `${row.date}|${row.name}`;
    const held = byDay.get(key);
    if (held) {
      held.mine = held.mine || row.mine;
      held.policies.add(row.policyName);
      held.observedFor = held.observedFor ?? row.observedFor;
    } else {
      byDay.set(key, {
        date: row.date,
        name: row.name,
        observedFor: row.observedFor,
        mine: row.mine,
        policies: new Set([row.policyName]),
      });
    }
  }
  const days = [...byDay.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.date.localeCompare(b.date),
  );

  const entries: HrCalendarHolidayEntry[] = [];
  let open: (HrCalendarHolidayEntry & { held: Set<string> }) | null = null;
  const close = () => {
    if (!open) return;
    const { held, ...entry } = open;
    entries.push({ ...entry, policies: [...held].sort() });
    open = null;
  };
  for (const day of days) {
    // An observed day ("Independence Day (observed)") stands alone: it is one
    // day by definition and its `observedFor` belongs to that day only.
    const continues =
      open !== null &&
      open.name === day.name &&
      open.observedFor === null &&
      day.observedFor === null &&
      addIsoDays(open.lastDay, 1) === day.date;
    if (continues && open) {
      open.lastDay = day.date;
      open.mine = open.mine || day.mine;
      for (const policy of day.policies) open.held.add(policy);
      continue;
    }
    close();
    open = {
      id: `holiday:${day.date}:${day.name}`,
      kind: 'holiday',
      firstDay: day.date,
      lastDay: day.date,
      name: day.name,
      observedFor: day.observedFor,
      mine: day.mine,
      policies: [],
      held: new Set(day.policies),
    };
  }
  close();
  return entries.sort(
    (a, b) => a.firstDay.localeCompare(b.firstDay) || a.name.localeCompare(b.name),
  );
}

/**
 * The events a request's **charged** days run into: a blackout over a day
 * it takes hours on, or a day off declared after the request was sent (its
 * hours were frozen when it still was a working day). A weekend inside both
 * ranges is no conflict — the comparison is on dates that carry hours, the
 * rule the overlap check uses.
 *
 * `events` must already be the ones that apply to the request's person.
 */
export function leaveEventConflicts(
  days: readonly { date: IsoDate; hours: number }[],
  events: readonly {
    id: string;
    name: string;
    effect: AgencyEventEffect;
    firstDay: IsoDate;
    lastDay: IsoDate;
  }[],
): LeaveEventConflict[] {
  const charged = days.filter((day) => day.hours > 0).map((day) => day.date);
  const out: LeaveEventConflict[] = [];
  for (const event of events) {
    if (event.effect === 'none') continue;
    const dates = charged.filter((date) => date >= event.firstDay && date <= event.lastDay);
    if (dates.length === 0) continue;
    out.push({ eventId: event.id, name: event.name, effect: event.effect, dates });
  }
  return out.sort((a, b) => a.dates[0].localeCompare(b.dates[0]) || a.name.localeCompare(b.name));
}
