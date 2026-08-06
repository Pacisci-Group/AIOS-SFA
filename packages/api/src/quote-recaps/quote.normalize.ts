import { chicagoParts, toYmd } from '../performance/performance.range';

/**
 * Pure derivations for the Quote Recap write path.
 *
 * `quoteDateYmd` is the `QuoteRecap` counterpart to `Deal.soldDateYmd`: a
 * `YYYYMMDD` integer that lets the Quoted scorecard (PAC-10) use the same
 * indexed integer range comparison the Sold scorecard uses, instead of a second
 * `Date`-bounded code path with its own timezone edge cases.
 */

/**
 * Derive the calendar-day label for a recap, **by provenance**.
 *
 * The two sources store fundamentally different things in `quoteDate`, and one
 * rule cannot serve both:
 *
 * - **App-written recaps** (`quote-recaps.service.ts` sets `new Date()`) carry a
 *   true instant. A recap saved at 19:00 CT on the 5th is 01:00Z on the *6th* —
 *   deriving from UTC parts would file it on tomorrow's scorecard. So these
 *   derive from **Chicago** parts.
 * - **Migrated recaps** carry a SmartSuite date-only value, stored at exactly
 *   UTC midnight. The source system already said which day it was; deriving
 *   from Chicago parts would read 00:00Z as 18:00 or 19:00 the *previous* day
 *   and shift every migrated recap back one. So these derive from **UTC** parts.
 *
 * Exact UTC midnight is the discriminator. It is not a heuristic in the loose
 * sense: `parseFormDate` in `sold.normalize.ts` deliberately pins date-only
 * values to UTC midnight for precisely this reason, and a `new Date()` landing
 * on an exact millisecond-zero UTC midnight would be a 1-in-86.4-million
 * coincidence that also resolves to the same answer roughly two-thirds of the
 * time. The cost of being wrong is one day on one recap.
 */
export function quoteDateYmd(quoteDate: Date): number | undefined {
  if (Number.isNaN(quoteDate.getTime())) return undefined;

  if (isUtcMidnight(quoteDate)) {
    return (
      quoteDate.getUTCFullYear() * 10_000 +
      (quoteDate.getUTCMonth() + 1) * 100 +
      quoteDate.getUTCDate()
    );
  }

  return toYmd(chicagoParts(quoteDate));
}

/** A date-only value, as stored by the migration and by `parseFormDate`. */
function isUtcMidnight(date: Date): boolean {
  return (
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0
  );
}
