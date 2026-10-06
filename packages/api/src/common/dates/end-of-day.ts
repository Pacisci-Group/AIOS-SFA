import { localClock } from './time-zones';

/**
 * The guard both helpers below run on the hour first (PAC-149).
 *
 * The hour is `Agency.endOfDayHour`, a whole hour on the agency's clock after
 * which its people are set Away (PAC-139 §6a; 8 PM until it became a
 * setting). It is a required argument with no default, for the reason
 * `requireTimeZone` gives: specs are transpiled without type-checking, so a
 * stale call still passing `(now, zone, lastAwayDate)` would compare the
 * clock's hour against a date string — `20 < '2026-09-25'` is quietly `false`,
 * which reads as "due" on every tick. Throwing names the call site instead.
 */
export function requireEndOfDayHour(endOfDayHour: unknown): number {
  if (
    typeof endOfDayHour !== 'number' ||
    !Number.isInteger(endOfDayHour) ||
    endOfDayHour < 0 ||
    endOfDayHour > 23
  ) {
    throw new Error(
      'An end-of-day hour is required: pass the agency hour (Agency.endOfDayHour), a whole number 0–23.',
    );
  }
  return endOfDayHour;
}

/**
 * Whether an agency is due its end-of-day sweep at `now`, and for which local
 * date. `null` means "not now".
 *
 * ## The rule is "the hour or later, once per local date" — not "at the hour"
 *
 * The cron ticks every thirty minutes, and a tick is not guaranteed: the
 * worker can be down, deploying, or slow. Matching `hour === endOfDayHour`
 * would turn any of those into a night nobody was set Away, silently.
 * Matching *at or after* the hour and remembering the last local date the
 * sweep ran for makes a missed tick catch up on the next one and a repeated
 * tick a no-op, which is the whole reason
 * `Agency.availabilitySweep.lastAwayDate` exists.
 *
 * The marker is compared as a local calendar date, not an instant, so the
 * question "did we already do tonight?" has the same answer on either side of a
 * DST change — the clock in `timeZone` is what decides, and `localClock` reads
 * it through the runtime's zone data.
 *
 * An hour of `0` makes the sweep due from local midnight, for the date that
 * has just begun — the end of the previous working day, filed under the new
 * one. Consistent, if unlikely to be chosen.
 */
export function endOfDaySweepDate(
  now: Date,
  timeZone: string,
  endOfDayHour: number,
  lastAwayDate: string | null | undefined,
): string | null {
  const hour = requireEndOfDayHour(endOfDayHour);
  const clock = localClock(now, timeZone);
  if (clock.hour < hour) return null;
  if (lastAwayDate === clock.date) return null;
  return clock.date;
}

/**
 * What `Agency.availabilitySweep.lastAwayDate` should become when the agency
 * changes its working day at `now` — moves to `timeZone` (PAC-141), changes
 * its `endOfDayHour` (PAC-149), or both.
 *
 * The marker answers "did tonight's sweep run?" for the *old* schedule, and
 * read against the new one it misleads in both directions:
 *
 * - **Into the past.** An agency moving east to a zone where it is already
 *   past its hour, or moving the hour from 20 to 9 at midday, would be swept
 *   within thirty minutes — in the middle of its workday, for someone who may
 *   only have picked the wrong option.
 * - **Into the future.** One moving west after tonight's sweep ran, or moving
 *   the hour from 20 to 22 at 9 PM, would be skipped tonight, because the old
 *   marker already names today.
 *
 * Re-stamping makes the rule "the next sweep is the next end-of-day hour on
 * the new schedule":
 *
 * - already at or past the hour on the new clock → tonight is done (`today`);
 * - earlier → `null`, so tonight's hour runs as normal — even if the old
 *   schedule's sweep ran an hour ago. A second pass only touches people who
 *   have set themselves Available since, which is what the person who just
 *   moved the hour later asked for.
 *
 * Only called when the zone or the hour actually changes; an unchanged save
 * must not clear a marker the worker is about to catch up on.
 */
export function sweepMarkerAfterScheduleChange(
  now: Date,
  timeZone: string,
  endOfDayHour: number,
): string | null {
  const hour = requireEndOfDayHour(endOfDayHour);
  const clock = localClock(now, timeZone);
  return clock.hour >= hour ? clock.date : null;
}
