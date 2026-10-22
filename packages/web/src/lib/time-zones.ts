import { DEFAULT_AGENCY_TIME_ZONE } from "@sfa/shared";

/**
 * The time-zone picker's list and labels (PAC-141).
 *
 * The list is the browser's own `Intl.supportedValuesOf('timeZone')` — the
 * canonical IANA names this runtime can resolve — rather than a table typed
 * in here that would go stale the next time a zone is renamed. The API checks
 * what it receives against *its* runtime and against MongoDB, so a browser
 * offering a name the server does not know gets a 400 naming the field, not a
 * stored zone that breaks a dashboard.
 *
 * US zones come first because every agency on the platform is in the US; the
 * rest follow grouped by IANA area, alphabetically.
 */

/** The zone names that cover the US states and territories, west to east… no, by familiarity. */
const US_ZONES: readonly string[] = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
];

const US_GROUP = "United States";

/** IANA areas, in the order the groups are listed after the US. */
const AREA_ORDER: readonly string[] = [
  "America",
  "Europe",
  "Asia",
  "Africa",
  "Australia",
  "Pacific",
  "Atlantic",
  "Indian",
  "Antarctica",
  "Arctic",
];

/**
 * Search aliases for zones whose browser-canonical id is the *old* name.
 *
 * Chromium's `supportedValuesOf` follows ICU, which still canonicalises to
 * `Asia/Calcutta`, `Europe/Kiev` and friends; someone typing the current name
 * would otherwise find nothing. Keyed by the id the browser lists; the value
 * is only ever a search term, never stored.
 */
const SEARCH_ALIASES: Record<string, string> = {
  "Asia/Calcutta": "Kolkata",
  "Asia/Katmandu": "Kathmandu",
  "Asia/Rangoon": "Yangon",
  "Asia/Saigon": "Ho Chi Minh",
  "Europe/Kiev": "Kyiv",
  "America/Buenos_Aires": "Argentina",
  "Pacific/Ponape": "Pohnpei",
  "Pacific/Truk": "Chuuk",
  "Asia/Kolkata": "Calcutta",
  "Asia/Kathmandu": "Katmandu",
  "Asia/Yangon": "Rangoon",
  "Asia/Ho_Chi_Minh": "Saigon",
  "Europe/Kyiv": "Kiev",
};

export interface TimeZoneOption {
  /** The IANA name, which is what is stored. */
  value: string;
  /** `America/Chicago (Central Time, UTC−5)`. */
  label: string;
  /** Extra search terms: the city with spaces, the generic name, the offset. */
  keywords: string[];
  group: string;
}

function namePart(id: string, style: "longGeneric" | "shortOffset"): string | undefined {
  return new Intl.DateTimeFormat("en-US", { timeZone: id, timeZoneName: style })
    .formatToParts(new Date())
    .find((part) => part.type === "timeZoneName")?.value;
}

/** `GMT-5` → `UTC−5`, `GMT` → `UTC`, `GMT+5:30` → `UTC+5:30`. */
function utcOffset(id: string): string | undefined {
  const raw = namePart(id, "shortOffset");
  if (!raw) return undefined;
  return raw.replace(/^GMT/, "UTC").replace("-", "−");
}

/**
 * `America/Chicago (Central Time, UTC−5)`.
 *
 * The offset is the one in force *today*, so a zone that observes DST reads
 * differently in January and July — that is the point, it is what the clock
 * on the wall says. Falls back to the bare name for anything the browser's
 * `Intl` will not format (an older engine without `longGeneric`, or a stored
 * name the browser does not know).
 */
export function timeZoneLabel(id: string): string {
  try {
    const generic = namePart(id, "longGeneric");
    const offset = utcOffset(id);
    const detail = [generic, offset].filter(Boolean).join(", ");
    return detail ? `${id} (${detail})` : id;
  } catch {
    return id;
  }
}

function groupFor(id: string): string {
  if (US_ZONES.includes(id)) return US_GROUP;
  const area = id.split("/")[0];
  return AREA_ORDER.includes(area) ? area : "Other";
}

function option(id: string): TimeZoneOption {
  const city = id.split("/").slice(1).join(" ").replace(/_/g, " ");
  let generic: string | undefined;
  let offset: string | undefined;
  try {
    generic = namePart(id, "longGeneric");
    offset = utcOffset(id);
  } catch {
    // Unformattable here; the label falls back to the bare name too.
  }
  return {
    value: id,
    label: timeZoneLabel(id),
    keywords: [city, generic, offset, SEARCH_ALIASES[id]].filter(
      (k): k is string => !!k,
    ),
    group: groupFor(id),
  };
}

function supportedZones(): string[] {
  const intl = Intl as unknown as {
    supportedValuesOf?: (key: "timeZone") => string[];
  };
  try {
    return intl.supportedValuesOf?.("timeZone") ?? [DEFAULT_AGENCY_TIME_ZONE];
  } catch {
    return [DEFAULT_AGENCY_TIME_ZONE];
  }
}

let cached: TimeZoneOption[] | undefined;

/**
 * Every zone the picker offers, US first, then by area. Computed once per
 * page — formatting ~420 names through `Intl` twice each is cheap but not
 * free, and the list does not change while the page is open.
 *
 * `stored` is the value already on the record. A browser whose `Intl` lacks
 * it (an alias such as `US/Central`, or a zone newer than the engine) would
 * otherwise show the field as unset and offer no way to keep it; it is
 * appended under "Other" so it renders and survives a save.
 */
export function timeZoneOptions(stored?: string | null): TimeZoneOption[] {
  if (!cached) {
    const ids = new Set(supportedZones());
    const rest = [...ids]
      .filter((id) => !US_ZONES.includes(id))
      .sort((a, b) => {
        const byArea =
          AREA_ORDER.indexOf(groupFor(a)) - AREA_ORDER.indexOf(groupFor(b));
        return byArea !== 0 ? byArea : a.localeCompare(b);
      });
    cached = [...US_ZONES.filter((id) => ids.has(id)), ...rest].map(option);
  }
  if (stored && !cached.some((o) => o.value === stored)) {
    return [...cached, { ...option(stored), group: "Other" }];
  }
  return cached;
}
