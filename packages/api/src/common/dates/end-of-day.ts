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
