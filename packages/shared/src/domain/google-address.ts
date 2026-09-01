/**
 * Google Maps Platform → {@link StructuredAddress} mapping (PAC-60).
 *
 * Lives in `shared` rather than on either side because the mapping runs
 * **server-side**: the whole point of proxying Places through our own API is
 * that the browser never receives Google's JSON, so the API is what hands the
 * form a `StructuredAddress`. The wire types the web app *does* see are
 * declared here too, next to the mapper that produces them — the same reason
 * `StructuredAddress` and `DEFAULT_ADDRESS_STATE` already share a file.
 *
 * Nothing here performs I/O. `packages/api/src/address/google-address.client.ts`
 * owns the HTTP calls and the API key.
 */

import { DEFAULT_ADDRESS_STATE, StructuredAddress } from './address';

/* ------------------------------------------------------------------ *
 * Google wire shapes (only the fields we ask for)
 * ------------------------------------------------------------------ */

/**
 * One entry of `Place.addressComponents`, as returned by Place Details (New)
 * under the `addressComponents` field mask.
 *
 * `longText` is the spelled-out form (`Oklahoma`, `North Maple Avenue`);
 * `shortText` is the abbreviation (`OK`, `N Maple Ave`).
 */
export interface GoogleAddressComponent {
  longText?: string | null;
  shortText?: string | null;
  types?: string[] | null;
}

/**
 * `PostalAddress`, as returned by the Address Validation API under
 * `address.postalAddress`. Declared now because the validation half of PAC-60
 * is a scheduled follow-up and {@link toStateName} exists to serve both shapes.
 */
export interface GooglePostalAddress {
  regionCode?: string | null;
  postalCode?: string | null;
  administrativeArea?: string | null;
  locality?: string | null;
  addressLines?: string[] | null;
}

/* ------------------------------------------------------------------ *
 * Our wire shapes (what the browser actually receives)
 * ------------------------------------------------------------------ */

/** One row in the autocomplete dropdown. */
export interface AddressSuggestion {
  /** Opaque Google place id — round-tripped to `/address/resolve`, never stored. */
  placeId: string;
  /** Bold-matched leading text, e.g. `4821 Maple Grove Dr`. */
  primaryText: string;
  /** Trailing context, e.g. `Austin, TX, USA`. */
  secondaryText: string;
}

/**
 * Every address response carries `available`, and the client is expected to act
 * on it rather than on the HTTP status.
 *
 * A missing API key, a revoked key or a Google outage all resolve to
 * `available: false` with a `200`. That is deliberate — see the
 * "fails open" note on `AddressService`. This endpoint exists to save typing;
 * when it cannot, the form must behave exactly as it did before PAC-60.
 */
export interface AddressAutocompleteResponse {
  available: boolean;
  suggestions: AddressSuggestion[];
}

export interface AddressResolveResponse {
  available: boolean;
  /** `null` when Google returned a place with no usable address components. */
  address: StructuredAddress | null;
}

/* ------------------------------------------------------------------ *
 * State names
 * ------------------------------------------------------------------ */

/**
 * USPS code → spelled-out name, for the 50 states plus DC.
 *
 * This table is what holds PAC-60's `Oklahoma`-not-`OK` acceptance criterion,
 * and it is needed because the two Google products disagree with each other:
 * Place Details exposes both forms (`longText` / `shortText`), while Address
 * Validation's `postalAddress.administrativeArea` is **only** the two-letter
 * code. Mapping `longText` alone would therefore hold the invariant on the
 * autocomplete path and quietly break it on the validation path.
 *
 * Google's own sample code maps `shortText`. Copying it verbatim would split
 * our data down the middle against `DEFAULT_ADDRESS_STATE` and every migrated
 * SmartSuite household.
 */
export const US_STATE_NAMES: Readonly<Record<string, string>> = {
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  DC: 'District of Columbia',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
};

/**
 * `OK` → `Oklahoma`. `Oklahoma` → `Oklahoma`. Anything unrecognized is
 * **passed through unchanged**, not blanked: a non-US or malformed value should
 * reach the producer's eyes so they can correct it, rather than vanishing from
 * a field they already filled in.
 */
export function toStateName(value?: string | null): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) return '';
  return US_STATE_NAMES[trimmed.toUpperCase()] ?? trimmed;
}

/* ------------------------------------------------------------------ *
 * Place Details → StructuredAddress
 * ------------------------------------------------------------------ */

function componentText(
  components: readonly GoogleAddressComponent[],
  type: string,
): string {
  const match = components.find((c) => c.types?.includes(type));
  return match?.longText?.trim() ?? '';
}

function firstComponentText(
  components: readonly GoogleAddressComponent[],
  types: readonly string[],
): string {
  for (const type of types) {
    const text = componentText(components, type);
    if (text) return text;
  }
  return '';
}

/**
 * City, in descending order of how well the component names the town a person
 * would write on an envelope.
 *
 * The tail of this chain is not padding. Rural Oklahoma addresses — the ones
 * this feature most needs to get right — routinely carry no `locality` at all,
 * and without `administrative_area_level_3` autofill would leave City blank on
 * exactly those addresses while filling every suburban one.
 */
const CITY_TYPES = [
  'locality',
  'postal_town',
  'sublocality_level_1',
  'administrative_area_level_3',
  'neighborhood',
] as const;

/**
 * Map `Place.addressComponents` onto the four fields our forms actually hold.
 *
 * Reads **`longText` throughout** (see {@link US_STATE_NAMES}), and drops
 * `postal_code_suffix` on purpose — see {@link mapPlaceComponents}'s ZIP note.
 */
export function mapPlaceComponents(
  components: readonly GoogleAddressComponent[] | null | undefined,
): StructuredAddress {
  const parts = components ?? [];

  const streetNumber = componentText(parts, 'street_number');
  const route = componentText(parts, 'route');
  // A named building (`premise`) is the fallback for addresses that have no
  // numbered street — common on rural routes and new builds.
  const base = [streetNumber, route].filter(Boolean).join(' ') || componentText(parts, 'premise');
  // Apartment / unit / suite. Appended rather than dropped: two households at
  // the same street number are a different household each.
  const subpremise = componentText(parts, 'subpremise');

  return {
    street: subpremise && base ? `${base}, ${subpremise}` : base || subpremise,
    city: firstComponentText(parts, CITY_TYPES),
    state: toStateName(componentText(parts, 'administrative_area_level_1')),
    /*
     * Five digits only — `postal_code_suffix` is deliberately NOT appended.
     *
     * ZIP is half of `buildAddressKey(street, zip)`, the household dedupe key.
     * A new lead keyed `73013-1234` can never match a migrated household keyed
     * `73013`, so appending +4 would silently stop dedupe working for every
     * address Google happens to know the suffix for. Asserted in the spec so
     * nobody "improves" it later.
     */
    zip: componentText(parts, 'postal_code'),
  };
}

/**
 * Map Address Validation's `address.postalAddress` onto the same four fields.
 *
 * Declared alongside the Places mapper because the state trap only makes sense
 * when both are visible: `administrativeArea` here is the **short** form, so it
 * must go through {@link toStateName} exactly as the Places path does.
 * Consumed once the validation half of PAC-60 lands.
 */
export function mapPostalAddress(
  postal: GooglePostalAddress | null | undefined,
): StructuredAddress {
  return {
    street: (postal?.addressLines ?? []).map((l) => l.trim()).filter(Boolean).join(', '),
    city: postal?.locality?.trim() ?? '',
    state: toStateName(postal?.administrativeArea),
    // Same five-digit rule as above; Validation returns ZIP+4 as `73013-1234`.
    zip: (postal?.postalCode ?? '').trim().split('-')[0] ?? '',
  };
}

/**
 * True when Google gave us nothing worth writing into the form.
 *
 * The caller uses this to leave what the user typed alone rather than wiping
 * four fields with four empty strings.
 */
export function isEmptyAddress(address: StructuredAddress): boolean {
  return !address.street && !address.city && !address.zip;
}

/**
 * Fill a blank `state` with the agency default so an autofilled address never
 * comes back *less* complete than the form was seeded.
 *
 * Applied by the API rather than the form so both address surfaces and any
 * future caller agree, and kept separate from {@link mapPlaceComponents} so the
 * mapper stays a pure reading of what Google actually said.
 */
export function withDefaultState(address: StructuredAddress): StructuredAddress {
  return address.state ? address : { ...address, state: DEFAULT_ADDRESS_STATE };
}
