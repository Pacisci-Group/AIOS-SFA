import {
  HOLIDAY_SUGGESTION_TYPES,
  type HolidayRegionOption,
  type HolidaySuggestionGroup,
  type HolidaySuggestionType,
} from '@sfa/shared';
import Holidays from 'date-holidays';

/**
 * The `date-holidays` wrapper (PAC-161): holiday *suggestions* for a country
 * and region, computed on the API and never in the browser.
 *
 * ## What comes out
 *
 * One entry per **date** the package knows a holiday for, as the agency's
 * calendar would store it: a `YYYY-MM-DD`, a name, the package's own type
 * (`public` / `bank` / `school` / `optional` / `observance`), whether it is a
 * substitute day (the Friday for a Saturday Fourth of July), the group it is
 * offered in and whether it is ticked by default. A multi-day rule
 * contributes its **start** day only.
 *
 * ## Federal vs other is a merge of two instances, by date
 *
 * The region-less instance's `public` rows are the federal set. A state
 * instance does **not** contain them verbatim: it renames some ("Presidents'
 * Day" for Washington's Birthday in Texas and Oklahoma), drops others (14
 * states have no Columbus Day row) and adds its own `public` days — sometimes
 * on a federal date (Texas 2027 puts "Christmas Eve" on 12-24, the same day as
 * "Christmas Day (substitute day)"). So the lists are merged by date: a
 * federal date keeps the federal row and its label, every other date keeps
 * the first row seen for it, regional first. The calendar holds one row per
 * date and the batch DTO 400s a duplicate, so one row per date is the
 * invariant here too — v1 deduped on `date:name` and the default import for a
 * Texas agency in 2027 failed on exactly that.
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
  group: HolidaySuggestionGroup;
  preChecked: boolean;
}

/** The fields of a `date-holidays` row the grouping reads. */
export interface PackageHolidayRow {
  /** `'YYYY-MM-DD HH:mm:ss'`, or a `Date` in older rule paths. */
  date: string | Date;
  name: string;
  type?: string;
  substitute?: boolean;
  /** The rule text; a substitute row carries the same one as its original. */
  rule?: string;
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

function isWeekend(date: string): boolean {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

function dayOf(row: PackageHolidayRow): string {
  return row.date instanceof Date
    ? row.date.toISOString().slice(0, 10)
    : String(row.date).slice(0, 10);
}

type Grouped = Omit<RawHolidaySuggestion, 'preChecked'> & { rule: string };

/**
 * Merge the national and regional lists into one row per date (pure; the
 * docblock above says why). Exported for the unit spec; callers use
 * {@link suggestHolidays}.
 *
 * Pre-check: every `federal` row, except the **weekend original of a
 * substitute pair** — a non-substitute row that falls on a Saturday or Sunday
 * and whose rule also produced a `substitute` row in the same year (the
 * package stamps both with the same rule text). Both rows stay in the list:
 * an agency that closes on the Saturday too can tick it. The weekend test is
 * load-bearing: 2027 holds both New Year's Day (Fri 01-01) and the substitute
 * for New Year's Day *2028* (Fri 12-31) under one rule, and the Friday
 * original must stay ticked.
 */
export function groupHolidaySuggestions(
  national: readonly PackageHolidayRow[],
  regional: readonly PackageHolidayRow[],
): RawHolidaySuggestion[] {
  const byDate = new Map<string, Grouped>();
  for (const row of national) {
    if (row.type !== 'public') continue;
    const date = dayOf(row);
    if (byDate.has(date)) continue;
    byDate.set(date, {
      date,
      name: row.name,
      type: 'public',
      substitute: row.substitute === true,
      group: 'federal',
      rule: row.rule ?? '',
    });
  }
  // Regional first, so a state's `public` extra outranks a national
  // observance on the same day; a federal date is already taken.
  for (const row of [...regional, ...national]) {
    const date = dayOf(row);
    if (byDate.has(date)) continue;
    byDate.set(date, {
      date,
      name: row.name,
      type: asType(row.type),
      substitute: row.substitute === true,
      group: 'other',
      rule: row.rule ?? '',
    });
  }

  const substituteRules = new Set<string>();
  for (const row of byDate.values()) {
    if (row.group === 'federal' && row.substitute && row.rule) {
      substituteRules.add(row.rule);
    }
  }

  return [...byDate.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(({ rule, ...row }) => ({
      ...row,
      preChecked:
        row.group === 'federal' &&
        !(
          !row.substitute &&
          isWeekend(row.date) &&
          substituteRules.has(rule)
        ),
    }));
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
  const national = instanceFor(country, null).getHolidays(input.year);
  const regional = region
    ? instanceFor(country, region).getHolidays(input.year)
    : [];
  return groupHolidaySuggestions(national, regional);
}
