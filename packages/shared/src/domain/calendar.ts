/**
 * Calendar-date arithmetic in UTC.
 *
 * Extracted from `service/renewal.ts`, which had owned both of these privately
 * since the renewal anchors were built. A second caller —
 * `domain/policy-replacement.ts`, which has to answer "is this cancellation
 * within one month of the sale?" — made the duplication a real risk rather than
 * a theoretical one: the migration that wrote the renewal anchors warns that the
 * app must keep computing byte-identical dates or every renewal cycle forks, and
 * a second private copy of the month-shift is how that quietly stops being true.
 *
 * These are **dates, not instants**. Every consumer is asking a question about
 * calendar days ("has a month passed?", "when does the term renew?"), and doing
 * that in local time is how an answer lands a day out either side of a DST
 * boundary.
 */

/**
 * Midnight UTC on the day `date` falls in.
 *
 * Comparing at day granularity is what stops a policy renewing *today* from
 * counting as already renewed because the clock passed midnight — and, here,
 * what stops a cancellation logged at 9am from being a different answer than the
 * same cancellation logged at 5pm.
 */
export function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

/**
 * `date` shifted by whole calendar months, clamped to the end of the target
 * month.
 *
 * `Date.setUTCMonth` **overflows** rather than clamping — 31 Jan + 1 month lands
 * on 2 or 3 March, not 28 February. Left alone that walks a month-end policy
 * forward a day or two every term until its renewal date has drifted into the
 * following month; on the chargeback window it would hand a policy sold on the
 * 31st an extra two days of grace.
 */
export function addUtcMonths(date: Date, months: number): Date {
  const shifted = new Date(date.getTime());
  const dayOfMonth = date.getUTCDate();

  // Move to the 1st first, so the month shift itself can never overflow.
  shifted.setUTCDate(1);
  shifted.setUTCMonth(shifted.getUTCMonth() + months);

  // Day 0 of the *next* month is the last day of this one.
  const daysInTargetMonth = new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 0),
  ).getUTCDate();
  shifted.setUTCDate(Math.min(dayOfMonth, daysInTargetMonth));

  return shifted;
}

/** A `Date` from whatever a Mongo read or a JSON body produced, or null. */
export function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
