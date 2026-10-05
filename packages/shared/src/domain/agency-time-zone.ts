/**
 * The agency's time zone (PAC-139 §6a, PAC-141).
 *
 * One zone per agency — `Agency.timezone`, an IANA name such as
 * `America/Chicago`. It is the calendar every date window in the app is cut
 * on (today, MTD, business-day aging), the clock the 8 PM end-of-day Away
 * sweep follows, and the zone an app-written quote recap's calendar day is
 * derived in. There are no per-user zones: an agency keeps one working day.
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

/** `GET /agency/profile` — the owner-editable facts about the agency itself. */
export interface AgencyProfileView {
  agencyName: string;
  /** IANA zone name, e.g. `America/Chicago`. */
  timezone: string;
}

/** `PATCH /agency/profile`. */
export interface UpdateAgencyProfileInput {
  timezone: string;
}
