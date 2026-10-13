/**
 * Business dates: when a sale, a quote or a lead *happened* (PAC-159).
 *
 * `Deal.soldDate`, `QuoteRecap.quoteDate` and `Lead.createdDate` are UTC
 * instants, like every `Date` Mongo stores. They record the business moment as
 * precisely as the user knows it: a form that defaults to "now" and is left
 * alone stores the real instant, while a **day-only** entry — a back-dated
 * sale or quote, a lead typed in late, every row the SmartSuite migration
 * imported — stores **midnight of that day in the agency's zone**, as UTC. A
 * Chicago sale on 2026-10-06 is `2026-10-06T05:00:00Z`.
 *
 * Never UTC midnight. `parseFormDate` (`sold-deals/intake/sold.normalize.ts`)
 * pins a form date to `T00:00:00Z`, which is right for the calendar-only
 * facts it still serves (a policy's effective date, a cancellation date) and
 * wrong for a business moment: read in a US zone, `00:00Z` is the previous
 * evening, so the row files on the previous day. The old `soldDateYmd` /
 * `quoteDateYmd` integers and the "exactly UTC midnight means a date-only
 * value" discriminator existed to paper over that; both are gone, and this
 * helper is what replaced them.
 *
 * Every reader converts the instant to the agency's calendar day at read
 * time (`businessDay`, `instantWindow`), so an agency that changes its zone
 * re-buckets its history consistently rather than freezing it.
 */

import {
  type CalendarDate,
  parseIsoDate,
  toIsoDate,
  zonedDate,
  zonedDayStart,
} from '../../performance/performance.range';

/**
 * The instant a `YYYY-MM-DD` business date is stored as: that day's first
 * instant in `timeZone`. Assumes a validated date (`isValidIsoDate` / the `ymd`
 * zod rule).
 */
export function businessDateInstant(isoDate: string, timeZone: string): Date {
  return zonedDayStart(parseIsoDate(isoDate.slice(0, 10)), timeZone);
}

/**
 * The agency-calendar day a stored business instant falls on, `YYYY-MM-DD`,
 * or `null` for an absent value. The display form of every business date and
 * the value the edit log freezes.
 */
export function businessDay(
  value: Date | null | undefined,
  timeZone: string,
): string | null {
  if (!value || Number.isNaN(value.getTime())) return null;
  return toIsoDate(zonedDate(value, timeZone));
}

/** {@link businessDay} as a `{year, month, day}` triple. */
export function businessCalendarDate(
  value: Date,
  timeZone: string,
): CalendarDate {
  return zonedDate(value, timeZone);
}

/**
 * Whole agency-calendar days from `from` to `to` (`to − from`): 0 on the
 * same day, negative when `to` precedes `from`. The "days to close" between
 * a quote and its sale.
 */
export function businessDaysDiff(
  from: Date,
  to: Date,
  timeZone: string,
): number {
  const a = zonedDate(from, timeZone);
  const b = zonedDate(to, timeZone);
  return Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) -
      Date.UTC(a.year, a.month - 1, a.day)) /
      86_400_000,
  );
}
