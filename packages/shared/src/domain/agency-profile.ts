/**
 * The agency's working day: its time zone and its end-of-day hour
 * (PAC-139 §6a, PAC-141, PAC-149).
 *
 * One zone per agency — `Agency.timezone`, an IANA name such as
 * `America/Chicago`. It is the calendar every date window in the app is cut
 * on (today, MTD, business-day aging), the clock the end-of-day Away sweep
 * follows, and the zone an app-written quote recap's calendar day is derived
 * in. There are no per-user zones: an agency keeps one working day.
 *
 * One end-of-day hour per agency — `Agency.endOfDayHour`, a whole hour on that
 * clock after which every active user is set Away.
 */

/**
 * US Central. Every agency on the platform when the field was added is in
 * Oklahoma, which keeps Central time and has no IANA zone of its own.
 *
 * This is the schema default and what the onboarding wizard pre-selects. It
 * is **not** a fallback for a date helper — those take the agency's zone as a
 * required argument, so that a missed call site fails loudly rather than
 * quietly putting one agency on another's calendar.
 */
export const DEFAULT_AGENCY_TIME_ZONE = 'America/Chicago';

/**
 * 8 PM — the hour David named for the nightly Away sweep (PAC-139 §6a), and
 * what every agency had before it became a setting (PAC-149).
 *
 * Like {@link DEFAULT_AGENCY_TIME_ZONE}, this is the schema default and the
 * fallback for a `.lean()` read of a row that predates the field. It is
 * **not** a default for the end-of-day helpers, which take the agency's hour
 * as a required argument.
 */
export const DEFAULT_AGENCY_END_OF_DAY_HOUR = 20;

/** `GET /agency/profile` — the owner-editable facts about the agency itself. */
export interface AgencyProfileView {
  agencyName: string;
  /** IANA zone name, e.g. `America/Chicago`. */
  timezone: string;
  /** Whole hour, 0–23, on the agency's clock. `20` is 8 PM. */
  endOfDayHour: number;
}

/** `PATCH /agency/profile`. Both optional; at least one is required. */
export interface UpdateAgencyProfileInput {
  timezone?: string;
  endOfDayHour?: number;
}
