/**
 * IANA timezones, and the local wall clock in one of them.
 *
 * ## Why this is not `performance.range.ts`
 *
 * That file's `AGENCY_TIME_ZONE` is the Chicago calendar every dashboard
 * window is cut on, and it is still a constant on purpose: making it read
 * `Agency.timezone` changes every date window in the app at once, and gets its
 * own ticket. This file is the per-agency half — the zone an agency *stores*
 * (PAC-139 §6a) and the one job that reads it, the end-of-day Away sweep.
 * When the dashboards move over, they move to here.
 */

/**
 * US Central. Every agency on the platform today is in Oklahoma, which keeps
 * Central time and has no IANA zone of its own.
 */
export const DEFAULT_AGENCY_TIME_ZONE = 'America/Chicago';

/**
 * Whether the runtime knows this zone — the exact contract the worker needs,
 * since a name `Intl.DateTimeFormat` rejects would throw inside a cron.
 *
 * A `try`/`catch` rather than `Intl.supportedValuesOf('timeZone')`: that list
 * holds canonical names only, so `US/Central` or `Asia/Calcutta` would be
 * refused although the formatter accepts them and resolves them correctly.
 * Constructing the formatter is what decides, so constructing it is the test.
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
    timeZone,
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
