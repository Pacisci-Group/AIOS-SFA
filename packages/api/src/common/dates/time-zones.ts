/**
 * IANA timezones, and the local wall clock in one of them.
 *
 * The zone an agency keeps its working day in is `Agency.timezone` (PAC-139
 * §6a). It is read in two places: once per request into
 * `AccessContext.timeZone`, from where every dashboard date helper in
 * `performance/performance.range.ts` takes it as a required argument
 * (PAC-141), and by the worker's end-of-day Away sweep, which reads the
 * agency row directly. There is deliberately no module-level "the agency
 * zone" constant any more — a helper that could default to Central is a
 * helper that will, silently, for the first agency that is not.
 */

import { DEFAULT_AGENCY_TIME_ZONE } from '@sfa/shared';

export { DEFAULT_AGENCY_TIME_ZONE };

/**
 * Whether the runtime knows this zone — the exact contract the worker needs,
 * since a name `Intl.DateTimeFormat` rejects would throw inside a cron.
 *
 * A `try`/`catch` rather than `Intl.supportedValuesOf('timeZone')`: that list
 * holds canonical names only, so `US/Central` or `Asia/Calcutta` would be
 * refused although the formatter accepts them and resolves them correctly.
 * Constructing the formatter is what decides, so constructing it is the test.
 *
 * Note this is the *runtime's* opinion. MongoDB keeps its own zone table for
 * `$dateToString`, and the two can disagree at the edges (case, raw offsets,
 * very new zones) — `assertMongoKnowsTimeZone` in `mongo-time-zone.ts` is
 * the other half of the check, run wherever a zone is written.
 */
export function isIanaTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim() === '') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * The guard every zone-taking date helper runs first.
 *
 * Specs are transpiled without type-checking, so a stale call that forgot the
 * new argument would not fail to compile there — it would hand `undefined` to
 * `Intl`, which quietly means "the host's zone", or to a Mongo expression,
 * which serialises it as `null` and drops every row from the window. Throwing
 * turns both into a stack trace naming the call site.
 */
export function requireTimeZone(timeZone: unknown): string {
  if (typeof timeZone !== 'string' || timeZone.trim() === '') {
    throw new Error(
      'A time zone is required: pass the agency zone (AccessContext.timeZone / Agency.timezone).',
    );
  }
  return timeZone;
}

/** The wall clock at one instant in one zone. `date` is `YYYY-MM-DD`. */
export interface LocalClock {
  date: string;
  /** 0–23. */
  hour: number;
  /** 0–59. */
  minute: number;
}

/**
 * What the clock on the wall says in `timeZone` at `at`.
 *
 * `hourCycle: 'h23'` rather than `hour12: false`: the latter is allowed to
 * render midnight as `24` in some ICU builds, and `Number('24')` would make
 * the last hour of one day read as an hour past the end of the next.
 */
export function localClock(at: Date, timeZone: string): LocalClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: requireTimeZone(timeZone),
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(at);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '00';

  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour')),
    minute: Number(get('minute')),
  };
}
