import { localClock } from './time-zones';

/**
 * The hour, on the agency's own clock, after which its people are set Away
 * (PAC-139 §6a). David named 8 PM; nothing else reads this.
 */
export const END_OF_DAY_LOCAL_HOUR = 20;

/**
 * Whether an agency is due its end-of-day sweep at `now`, and for which local
 * date. `null` means "not now".
 *
 * ## The rule is "8 PM or later, once per local date" — not "at 8 PM"
 *
 * The cron ticks every thirty minutes, and a tick is not guaranteed: the
 * worker can be down, deploying, or slow. Matching `hour === 20` would turn any
 * of those into a night nobody was set Away, silently. Matching *at or after*
 * 8 PM and remembering the last local date the sweep ran for makes a missed
 * tick catch up on the next one and a repeated tick a no-op, which is the whole
 * reason `Agency.availabilitySweep.lastAwayDate` exists.
 *
 * The marker is compared as a local calendar date, not an instant, so the
 * question "did we already do tonight?" has the same answer on either side of a
 * DST change — the clock in `timeZone` is what decides, and `localClock` reads
 * it through the runtime's zone data.
 */
export function endOfDaySweepDate(
  now: Date,
  timeZone: string,
  lastAwayDate: string | null | undefined,
): string | null {
  const clock = localClock(now, timeZone);
  if (clock.hour < END_OF_DAY_LOCAL_HOUR) return null;
  if (lastAwayDate === clock.date) return null;
  return clock.date;
}

/**
 * What `Agency.availabilitySweep.lastAwayDate` should become when the agency
 * moves to `timeZone` at `now` (PAC-141).
 *
 * The marker is a local date on the *old* clock, and read against the new one
 * it misleads in both directions: an agency moving east to a zone where it is
 * already past 8 PM would be swept within thirty minutes, in the middle of its
 * workday; one moving west after tonight's sweep ran would be skipped tonight,
 * because the old marker already names today. Re-stamping makes the rule "the
 * next sweep is the next 8 PM on the new clock":
 *
 * - already 8 PM or later in the new zone → tonight is done (`today`);
 * - earlier → `null`, so tonight's 8 PM in the new zone runs as normal — even
 *   if the old zone's sweep ran an hour ago, since a second pass only touches
 *   people who have set themselves Available since, which at that hour is
 *   nobody.
 *
 * Only called when the zone actually changes; an unchanged save must not
 * clear a marker the worker is about to catch up on.
 */
export function sweepMarkerAfterZoneChange(
  now: Date,
  timeZone: string,
): string | null {
  const clock = localClock(now, timeZone);
  return clock.hour >= END_OF_DAY_LOCAL_HOUR ? clock.date : null;
}
