/**
 * Agency events (PAC-169): the dates an agency puts on its own calendar — a
 * company meetup, a Christmas party, an office closure.
 *
 * An event is **one or more whole days**. Its optional start and end time is
 * what people read on the calendar ("6:00 PM – 9:00 PM") and nothing else:
 * the two effects below always apply to the whole day, which is what keeps
 * the time off hours arithmetic a per-day fact (decided 2026-11-06).
 *
 * - `none` — on the calendar only.
 * - `blackout` — nobody in the audience may ask for time off on those days.
 *   A manager recording time off for someone is warned and may go ahead.
 * - `day_off` — the office is closed for the audience: a time off request
 *   charges nothing for the day.
 *
 * One effect, not two flags: a day off has no hours to take, so a blackout
 * on it would block nothing.
 *
 * The **audience** is the whole agency, some branches, or some people. Both
 * the effect and who sees the event on the calendar follow it.
 */
import { addIsoDays, HOLIDAY_NAME_MAX_LENGTH, parseIsoDay } from './us-holidays';

type IsoDate = string;

export const AGENCY_EVENT_EFFECTS = ['none', 'blackout', 'day_off'] as const;
export type AgencyEventEffect = (typeof AGENCY_EVENT_EFFECTS)[number];

export const AGENCY_EVENT_EFFECT_LABELS: Record<AgencyEventEffect, string> = {
  none: 'On the calendar only',
  blackout: 'No time off',
  day_off: 'Day off',
};

export const AGENCY_EVENT_AUDIENCE_KINDS = ['agency', 'branches', 'people'] as const;
export type AgencyEventAudienceKind = (typeof AGENCY_EVENT_AUDIENCE_KINDS)[number];

export const AGENCY_EVENT_NAME_MAX_LENGTH = HOLIDAY_NAME_MAX_LENGTH;
export const AGENCY_EVENT_DESCRIPTION_MAX_LENGTH = 1000;
/** The longest event, in calendar days — the custom-holiday limit. */
export const AGENCY_EVENT_MAX_DAYS = 31;
/** Branches or people one event may name. */
export const AGENCY_EVENT_AUDIENCE_MAX = 200;

export interface AgencyEventAudience {
  kind: AgencyEventAudienceKind;
  /** Set for `branches`; empty otherwise. */
  branchIds: string[];
  /** Set for `people`; empty otherwise. */
  userIds: string[];
}

export interface AgencyEventInput {
  name: string;
  description: string | null;
  /** `YYYY-MM-DD`, inclusive. */
  firstDay: IsoDate;
  /** `YYYY-MM-DD`, inclusive; equal to `firstDay` for one day. */
  lastDay: IsoDate;
  /** `HH:mm`, shown only. */
  startTime: string | null;
  /** `HH:mm`, shown only; needs a start time. */
  endTime: string | null;
  effect: AgencyEventEffect;
  audience: AgencyEventAudience;
}

export interface AgencyEventView extends AgencyEventInput {
  id: string;
  /** "Everyone", "Main Office", "3 people" — never the ids. */
  audienceLabel: string;
}

/** `HH:mm` on a 24-hour clock. */
export function isClockTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/** Every day of an event, first to last. */
export function agencyEventDates(event: Pick<AgencyEventInput, 'firstDay' | 'lastDay'>): IsoDate[] {
  const out: IsoDate[] = [];
  for (let day = event.firstDay; day <= event.lastDay; day = addIsoDays(day, 1)) {
    out.push(day);
  }
  return out;
}

/** Why an event cannot be saved, or `null`. */
export function agencyEventError(input: AgencyEventInput): string | null {
  const name = input.name.trim();
  if (!name) return 'Give the event a name.';
  if (name.length > AGENCY_EVENT_NAME_MAX_LENGTH) {
    return `Keep the name under ${AGENCY_EVENT_NAME_MAX_LENGTH} characters.`;
  }
  if ((input.description ?? '').length > AGENCY_EVENT_DESCRIPTION_MAX_LENGTH) {
    return `Keep the description under ${AGENCY_EVENT_DESCRIPTION_MAX_LENGTH} characters.`;
  }
  const first = parseIsoDay(input.firstDay);
  const last = parseIsoDay(input.lastDay);
  if (!first) return 'Choose a start date.';
  if (!last) return 'Choose a valid end date.';
  if (last < first) return 'The end date is before the start date.';
  const days = Math.round((last.getTime() - first.getTime()) / 86_400_000) + 1;
  if (days > AGENCY_EVENT_MAX_DAYS) {
    return `An event can run at most ${AGENCY_EVENT_MAX_DAYS} days.`;
  }
  if (input.startTime !== null && !isClockTime(input.startTime)) {
    return 'Enter the start time as hours and minutes.';
  }
  if (input.endTime !== null && !isClockTime(input.endTime)) {
    return 'Enter the end time as hours and minutes.';
  }
  if (input.endTime !== null && input.startTime === null) {
    return 'Add a start time, or clear the end time.';
  }
  if (
    input.startTime !== null &&
    input.endTime !== null &&
    input.firstDay === input.lastDay &&
    input.endTime <= input.startTime
  ) {
    return 'The end time is not after the start time.';
  }
  const { kind, branchIds, userIds } = input.audience;
  if (kind === 'branches' && branchIds.length === 0) return 'Choose at least one branch.';
  if (kind === 'people' && userIds.length === 0) return 'Choose at least one person.';
  if (branchIds.length > AGENCY_EVENT_AUDIENCE_MAX || userIds.length > AGENCY_EVENT_AUDIENCE_MAX) {
    return `An event can name at most ${AGENCY_EVENT_AUDIENCE_MAX} branches or people.`;
  }
  return null;
}

/**
 * Whether an event is for this person. A branch audience is judged on the
 * person's **home branch today** — an owner with no branch counts as the
 * agency's default one, the rule time off requests stamp by.
 */
export function eventAppliesTo(
  audience: AgencyEventAudience,
  person: { userId: string; homeBranchId: string | null },
): boolean {
  if (audience.kind === 'agency') return true;
  if (audience.kind === 'branches') {
    return person.homeBranchId !== null && audience.branchIds.includes(person.homeBranchId);
  }
  return audience.userIds.includes(person.userId);
}

// ── What saving an event runs into ───────────────────────────────────────

/**
 * A live time off request (Submitted, Changes Requested or Approved) that
 * takes hours on a day the event blocks or closes. Nothing changes it: the
 * admin sees the list and decides (decided 2026-11-06).
 */
export interface AgencyEventImpactRow {
  /** Set only when the caller may open the request. */
  requestId: string | null;
  reference: string | null;
  person: { id: string; name: string };
  status: 'pending' | 'approved';
  firstDay: IsoDate;
  lastDay: IsoDate;
  /** The event's days the request takes hours on. */
  dates: IsoDate[];
  hours: number;
}

export interface AgencyEventImpact {
  requests: AgencyEventImpactRow[];
  /** Affected requests outside what the caller may see of people's leave. */
  hiddenCount: number;
}

/** What the event form picks an audience from. */
export interface AgencyEventAudienceOptions {
  branches: { id: string; name: string }[];
  people: { id: string; name: string; branchId: string | null }[];
}
