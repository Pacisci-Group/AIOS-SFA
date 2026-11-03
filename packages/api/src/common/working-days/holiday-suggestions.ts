import {
  HOLIDAY_SUGGESTION_TYPES,
  type HolidayRegionOption,
  type HolidaySuggestionType,
} from '@sfa/shared';
import Holidays from 'date-holidays';

/**
 * The `date-holidays` wrapper (PAC-161): holiday *suggestions* for a country
 * and region, computed on the API and never in the browser.
 *
 * ## What comes out
 *
 * One entry per holiday the package knows for the year, as the agency's
 * calendar would store it: a `YYYY-MM-DD`, a name, the package's own type
 * (`public` / `bank` / `school` / `optional` / `observance`) and whether it is
 * a substitute day (the Friday for a Saturday Fourth of July). Only `public`
 * ones are pre-checked; the rest are offered unchecked. A multi-day rule
 * contributes its **start** day only.
 *
 * ## `date`, never `start`
 *
 * The package's `date` is the holiday's own calendar day as a
 * `'YYYY-MM-DD HH:mm:ss'` string; `start` / `end` are instants in the
 * country's zone. A holiday is a calendar fact (see `hr-calendar.ts`), so the
 * string is what we keep, sliced — never `new Date(date)`, which would
 * re-read the local string in the server's zone and file New Year's Day on
 * December 31st.
 *
 * ## Validation is ours
 *
 * `new Holidays('US', 'ZZ')` does not throw — it quietly computes the
 * national set — and an unknown country yields an empty list. So country and
 * region are checked against `getCountries()` / `getStates()` first, and a
 * bad one is a typed error the controller maps to a 400.
 */

export class UnknownHolidayRegionError extends Error {
  constructor(
    readonly country: string,
    readonly region: string | null,
  ) {
    super(
      region
        ? `Unknown region "${region}" for country "${country}".`
        : `Unknown country "${country}".`,
    );
    this.name = 'UnknownHolidayRegionError';
  }
}

export interface RawHolidaySuggestion {
  /** `YYYY-MM-DD`. */
  date: string;
  name: string;
  type: HolidaySuggestionType;
  substitute: boolean;
}

/** The package parses the whole rule set per instance; one per place. */
const instances = new Map<string, Holidays>();

function instanceFor(country: string, region: string | null): Holidays {
  const key = `${country}:${region ?? ''}`;
  let instance = instances.get(key);
  if (!instance) {
    const opts = { types: [...HOLIDAY_SUGGESTION_TYPES] };
    instance = region
      ? new Holidays(country, region, opts)
      : new Holidays(country, opts);
    instances.set(key, instance);
  }
  return instance;
}

/** A catalog-only instance, for the lookups below. */
const catalog = new Holidays();

/** The package types these loosely; a code → name map is what they are. */
type NameMap = Record<string, string>;

function countries(): NameMap {
  return catalog.getCountries() ?? {};
}

function regions(country: string): NameMap {
  return catalog.getStates(country) ?? {};
}

function toOptions(map: NameMap): HolidayRegionOption[] {
  return Object.entries(map)
    .map(([code, name]) => ({ code, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function listCountries(): HolidayRegionOption[] {
  return toOptions(countries());
}

export function listRegions(country: string): HolidayRegionOption[] {
  return toOptions(regions(country));
}

// `Object.keys` rather than `hasOwnProperty.call`: with `strictBindCallApply`
// off, `.call` returns `any` and the lint boundary refuses to return it.
export function isKnownCountry(country: string): boolean {
  return Object.keys(countries()).includes(country);
}

export function isKnownRegion(country: string, region: string): boolean {
  return Object.keys(regions(country)).includes(region);
}

export function countryName(country: string): string | null {
  const name: unknown = countries()[country];
  return typeof name === 'string' ? name : null;
}

export function regionName(country: string, region: string): string | null {
  const name: unknown = regions(country)[region];
  return typeof name === 'string' ? name : null;
}

/**
 * The region code a free-text state name or code maps to, or `null`.
 *
 * `Branch.address.state` is whatever the operator typed — "Oklahoma", "OK",
 * "ok" — and this is how provisioning and the migration pre-fill the
 * calendar's region from it.
 */
export function regionFromStateName(
  country: string,
  text: string | null | undefined,
): string | null {
  if (!text) return null;
  const needle = text.trim().toLowerCase();
  if (!needle) return null;
  for (const option of listRegions(country)) {
    if (
      option.code.toLowerCase() === needle ||
      option.name.toLowerCase() === needle
    ) {
      return option.code;
    }
  }
  return null;
}

function asType(value: unknown): HolidaySuggestionType {
  return (HOLIDAY_SUGGESTION_TYPES as readonly string[]).includes(String(value))
    ? (value as HolidaySuggestionType)
    : 'observance';
}

export function suggestHolidays(input: {
  country: string;
  region: string | null;
  year: number;
}): RawHolidaySuggestion[] {
  const country = input.country.toUpperCase();
  const region = input.region ? input.region.toUpperCase() : null;
  if (!isKnownCountry(country)) {
    throw new UnknownHolidayRegionError(country, null);
  }
  if (region && !isKnownRegion(country, region)) {
    throw new UnknownHolidayRegionError(country, region);
  }

  const seen = new Set<string>();
  const out: RawHolidaySuggestion[] = [];
  for (const holiday of instanceFor(country, region).getHolidays(input.year)) {
    const date = String(holiday.date).slice(0, 10);
    // The package can emit the same date twice (a regional and a national
    // rule); the calendar holds one row per date, so keep the first.
    const key = `${date}:${holiday.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      date,
      name: holiday.name,
      type: asType(holiday.type),
      substitute: holiday.substitute === true,
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
