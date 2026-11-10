/**
 * The holidays a Holiday policy can pick from, and the dates they fall on
 * (PAC-161 v3).
 *
 * ## Recurring by rule, not dated rows
 *
 * A Holiday policy stores *which* holidays it observes ("Thanksgiving"), never
 * a list of dates. Every year's dates are computed here, so a policy written
 * once is right in 2031 with nobody confirming anything — the Gusto model,
 * and the reason the v2 per-year rows, the import dialog and the Q4 "confirm
 * next year" job are gone. Pure and dependency-free so the web shows dates as
 * someone ticks a box, and the API's working-day arithmetic computes the same
 * ones.
 *
 * ## Observed days
 *
 * A fixed-date **federal** holiday on a weekend is observed the federal way:
 * Saturday → the Friday before, Sunday → the Monday after. That day is the
 * closure. New Year's Day on a Saturday is therefore observed on 31 December
 * of the year before, and belongs to that year's list. The common extras
 * (Christmas Eve, New Year's Eve) are not shifted — on a weekend they close
 * nothing.
 *
 * When two holidays land on one date (Christmas Eve and Christmas observed,
 * both Fri 24 Dec 2027) the date is listed once, under the federal name.
 *
 * US only: every agency on the platform is a US agency. `business-days.ts` in
 * the API carries its own copy of the eleven federal rules for audit aging
 * (PAC-139); moving it onto this module is a follow-up.
 */

/** A `YYYY-MM-DD` calendar date. */
type IsoDate = string;

export const HOLIDAY_GROUPS = ['federal', 'common'] as const;
export type HolidayGroup = (typeof HOLIDAY_GROUPS)[number];

export const HOLIDAY_KEYS = [
  'new_years_day',
  'mlk_day',
  'presidents_day',
  'memorial_day',
  'juneteenth',
  'independence_day',
  'labor_day',
  'columbus_day',
  'veterans_day',
  'thanksgiving',
  'christmas_day',
  'good_friday',
  'day_after_thanksgiving',
  'christmas_eve',
  'new_years_eve',
] as const;
export type HolidayKey = (typeof HOLIDAY_KEYS)[number];

export interface HolidayDefinition {
  key: HolidayKey;
  name: string;
  group: HolidayGroup;
  /** When it falls, in words: "Third Monday in January". */
  when: string;
}

type Rule =
  | { kind: 'fixed'; month: number; day: number; observed: boolean }
  | { kind: 'nth'; month: number; weekday: number; n: number; offset?: number }
  | { kind: 'easter'; offset: number };

const MON = 1;
const THU = 4;

const RULES: Record<HolidayKey, Rule> = {
  new_years_day: { kind: 'fixed', month: 1, day: 1, observed: true },
  mlk_day: { kind: 'nth', month: 1, weekday: MON, n: 3 },
  presidents_day: { kind: 'nth', month: 2, weekday: MON, n: 3 },
  memorial_day: { kind: 'nth', month: 5, weekday: MON, n: -1 },
  juneteenth: { kind: 'fixed', month: 6, day: 19, observed: true },
  independence_day: { kind: 'fixed', month: 7, day: 4, observed: true },
  labor_day: { kind: 'nth', month: 9, weekday: MON, n: 1 },
  columbus_day: { kind: 'nth', month: 10, weekday: MON, n: 2 },
  veterans_day: { kind: 'fixed', month: 11, day: 11, observed: true },
  thanksgiving: { kind: 'nth', month: 11, weekday: THU, n: 4 },
  christmas_day: { kind: 'fixed', month: 12, day: 25, observed: true },
  good_friday: { kind: 'easter', offset: -2 },
  day_after_thanksgiving: {
    kind: 'nth',
    month: 11,
    weekday: THU,
    n: 4,
    offset: 1,
  },
  christmas_eve: { kind: 'fixed', month: 12, day: 24, observed: false },
  new_years_eve: { kind: 'fixed', month: 12, day: 31, observed: false },
};

/** In display order: the eleven federal holidays by date, then the extras. */
export const HOLIDAY_CATALOG: readonly HolidayDefinition[] = [
  { key: 'new_years_day', name: "New Year's Day", group: 'federal', when: 'January 1' },
  { key: 'mlk_day', name: 'Martin Luther King Jr. Day', group: 'federal', when: 'Third Monday in January' },
  { key: 'presidents_day', name: "Presidents' Day", group: 'federal', when: 'Third Monday in February' },
  { key: 'memorial_day', name: 'Memorial Day', group: 'federal', when: 'Last Monday in May' },
  { key: 'juneteenth', name: 'Juneteenth', group: 'federal', when: 'June 19' },
  { key: 'independence_day', name: 'Independence Day', group: 'federal', when: 'July 4' },
  { key: 'labor_day', name: 'Labor Day', group: 'federal', when: 'First Monday in September' },
  { key: 'columbus_day', name: 'Columbus Day', group: 'federal', when: 'Second Monday in October' },
  { key: 'veterans_day', name: 'Veterans Day', group: 'federal', when: 'November 11' },
  { key: 'thanksgiving', name: 'Thanksgiving Day', group: 'federal', when: 'Fourth Thursday in November' },
  { key: 'christmas_day', name: 'Christmas Day', group: 'federal', when: 'December 25' },
  { key: 'good_friday', name: 'Good Friday', group: 'common', when: 'The Friday before Easter' },
  { key: 'day_after_thanksgiving', name: 'Day after Thanksgiving', group: 'common', when: 'The Friday after Thanksgiving' },
  { key: 'christmas_eve', name: 'Christmas Eve', group: 'common', when: 'December 24' },
  { key: 'new_years_eve', name: "New Year's Eve", group: 'common', when: 'December 31' },
];

const DEFINITION_BY_KEY = new Map(HOLIDAY_CATALOG.map((h) => [h.key, h]));

export function holidayDefinition(key: HolidayKey): HolidayDefinition {
  // Total over the closed key set; the catalog and RULES are checked by spec.
  return DEFINITION_BY_KEY.get(key) as HolidayDefinition;
}

export const FEDERAL_HOLIDAY_KEYS: readonly HolidayKey[] = HOLIDAY_CATALOG.filter(
  (h) => h.group === 'federal',
).map((h) => h.key);

// ── Date helpers (UTC anchors; no zone ever enters) ──────────────────────

function utc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

function iso(date: Date): IsoDate {
  return date.toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` → a UTC-midnight `Date`; `null` for anything malformed. */
export function parseIsoDay(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = utc(y, m, d);
  return date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? date : null;
}

export function addIsoDays(value: IsoDate, n: number): IsoDate {
  const date = parseIsoDay(value) as Date;
  date.setUTCDate(date.getUTCDate() + n);
  return iso(date);
}

/** Sunday = 0 … Saturday = 6. */
export function isoWeekday(value: IsoDate): number {
  return (parseIsoDay(value) as Date).getUTCDay();
}

function nthWeekday(year: number, month: number, weekday: number, n: number): Date {
  if (n > 0) {
    const first = utc(year, month, 1).getUTCDay();
    return utc(year, month, 1 + ((weekday - first + 7) % 7) + (n - 1) * 7);
  }
  const last = utc(year, month + 1, 0);
  const back = (last.getUTCDay() - weekday + 7) % 7;
  return utc(year, month, last.getUTCDate() - back + (n + 1) * 7);
}

/** Gregorian Easter Sunday (the anonymous / Meeus algorithm). */
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return utc(year, month, day);
}

export interface HolidayOccurrence {
  /** The day the office closes, `YYYY-MM-DD`. */
  date: IsoDate;
  name: string;
  /** Set when the holiday itself falls on another day (a weekend). */
  observedFor: IsoDate | null;
  /** The catalog holiday, or `null` for a custom one. */
  key: HolidayKey | null;
  /** The custom holiday's id, or `null` for a catalog one. */
  customId: string | null;
}

/**
 * The given year's instance of a catalog holiday. Its `date` may lie in the
 * year before (New Year's Day 2028 is observed Fri 2027-12-31).
 */
export function holidayInstance(key: HolidayKey, year: number): HolidayOccurrence {
  const rule = RULES[key];
  let actual: Date;
  if (rule.kind === 'fixed') actual = utc(year, rule.month, rule.day);
  else if (rule.kind === 'nth') {
    actual = nthWeekday(year, rule.month, rule.weekday, rule.n);
    if (rule.offset) actual = utc(year, rule.month, actual.getUTCDate() + rule.offset);
  } else {
    const easter = easterSunday(year);
    actual = utc(year, easter.getUTCMonth() + 1, easter.getUTCDate() + rule.offset);
  }
  const actualIso = iso(actual);
  let date = actualIso;
  if (rule.kind === 'fixed' && rule.observed) {
    const dow = actual.getUTCDay();
    if (dow === 6) date = addIsoDays(actualIso, -1);
    if (dow === 0) date = addIsoDays(actualIso, 1);
  }
  return {
    date,
    name: holidayDefinition(key).name,
    observedFor: date === actualIso ? null : actualIso,
    key,
    customId: null,
  };
}

// ── Custom holidays ─────────────────────────────────────────────────────

export const HOLIDAY_NAME_MAX_LENGTH = 120;
/** The longest custom range, in calendar days (a two-week winter closure fits). */
export const CUSTOM_HOLIDAY_MAX_DAYS = 31;
export const CUSTOM_HOLIDAYS_MAX = 50;

/**
 * A holiday the agency names itself: one day or an all-day range. Every day
 * in the range is listed, weekends too — whether a day was a working day is
 * the person's Work week policy's question, not the holiday's.
 */
export interface CustomHoliday {
  /** Stable within the policy, so a row can be edited or removed. */
  id: string;
  name: string;
  /** `YYYY-MM-DD`, inclusive. */
  start: IsoDate;
  /** `YYYY-MM-DD`, inclusive; equal to `start` for one day. */
  end: IsoDate;
  /** Every year on the same month and day(s), or only the year it names. */
  repeatsYearly: boolean;
}

/** Why a custom holiday cannot be saved, or `null`. */
export function customHolidayError(
  holiday: Pick<CustomHoliday, 'name' | 'start' | 'end'>,
): string | null {
  const name = holiday.name.trim();
  if (!name) return 'Give the holiday a name.';
  if (name.length > HOLIDAY_NAME_MAX_LENGTH) {
    return `Keep the name under ${HOLIDAY_NAME_MAX_LENGTH} characters.`;
  }
  const start = parseIsoDay(holiday.start);
  const end = parseIsoDay(holiday.end);
  if (!start) return 'Choose a start date.';
  if (!end) return 'Choose a valid end date.';
  if (end < start) return 'The end date is before the start date.';
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  if (days > CUSTOM_HOLIDAY_MAX_DAYS) {
    return `A holiday can run at most ${CUSTOM_HOLIDAY_MAX_DAYS} days.`;
  }
  return null;
}

/** Every day of `[start, end]`, inclusive. */
function daysOf(start: IsoDate, end: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  for (let day = start; day <= end; day = addIsoDays(day, 1)) out.push(day);
  return out;
}

/** `value` moved to `year`, keeping month and day (29 Feb → 28 Feb). */
function inYear(value: IsoDate, year: number): IsoDate {
  const [, m, d] = value.split('-').map(Number);
  const last = utc(year, m + 1, 0).getUTCDate();
  return iso(utc(year, m, Math.min(d, last)));
}

function customDays(holiday: CustomHoliday, year: number): IsoDate[] {
  if (!holiday.repeatsYearly) {
    return daysOf(holiday.start, holiday.end).filter((day) =>
      day.startsWith(`${year}-`),
    );
  }
  // The instance starting this year, and last year's when the range crosses
  // New Year (a Dec 24 – Jan 2 closure puts Jan 1–2 in this year's list).
  // Never before the year it was first set for.
  const span = daysOf(holiday.start, holiday.end).length - 1;
  const firstYear = Number(holiday.start.slice(0, 4));
  const out: IsoDate[] = [];
  for (const startYear of [year - 1, year]) {
    if (startYear < firstYear) continue;
    const start = inYear(holiday.start, startYear);
    for (const day of daysOf(start, addIsoDays(start, span))) {
      if (day.startsWith(`${year}-`)) out.push(day);
    }
  }
  return out;
}

// ── A policy's year ─────────────────────────────────────────────────────

export interface HolidaySelection {
  holidays: readonly HolidayKey[];
  customHolidays: readonly CustomHoliday[];
}

/**
 * Every day a Holiday policy closes in `year`, one row per date, sorted.
 * Catalog holidays first by precedence (federal over common), then custom
 * ones, so a custom day on Christmas reads as Christmas.
 */
export function holidaysInYear(
  selection: HolidaySelection,
  year: number,
): HolidayOccurrence[] {
  const byDate = new Map<IsoDate, HolidayOccurrence>();
  const chosen = new Set(selection.holidays);
  // Catalog order is federal first, so the federal name wins a shared date.
  for (const { key } of HOLIDAY_CATALOG) {
    if (!chosen.has(key)) continue;
    // Next year's instance can be observed this year (New Year's Day).
    for (const instanceYear of [year, year + 1]) {
      const occurrence = holidayInstance(key, instanceYear);
      if (occurrence.date.startsWith(`${year}-`) && !byDate.has(occurrence.date)) {
        byDate.set(occurrence.date, occurrence);
      }
    }
  }
  for (const holiday of selection.customHolidays) {
    for (const date of customDays(holiday, year)) {
      if (byDate.has(date)) continue;
      byDate.set(date, {
        date,
        name: holiday.name,
        observedFor: null,
        key: null,
        customId: holiday.id,
      });
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** {@link holidaysInYear} over an inclusive range that may span years. */
export function holidaysBetween(
  selection: HolidaySelection,
  from: IsoDate,
  to: IsoDate,
): HolidayOccurrence[] {
  const out: HolidayOccurrence[] = [];
  for (let year = Number(from.slice(0, 4)); year <= Number(to.slice(0, 4)); year += 1) {
    for (const row of holidaysInYear(selection, year)) {
      if (row.date >= from && row.date <= to) out.push(row);
    }
  }
  return out;
}

/** The first closure on or after `today` for a catalog holiday. */
export function nextHolidayInstance(key: HolidayKey, today: IsoDate): HolidayOccurrence {
  const year = Number(today.slice(0, 4));
  // This year's instance may be observed last December; try three in order.
  for (const candidate of [year, year + 1, year + 2]) {
    const occurrence = holidayInstance(key, candidate);
    if (occurrence.date >= today) return occurrence;
  }
  return holidayInstance(key, year + 2);
}
