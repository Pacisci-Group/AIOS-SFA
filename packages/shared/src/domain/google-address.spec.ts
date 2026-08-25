import { DEFAULT_ADDRESS_STATE } from './address';
import {
  GoogleAddressComponent,
  isEmptyAddress,
  mapPlaceComponents,
  mapPostalAddress,
  toStateName,
  withDefaultState,
} from './google-address';

/**
 * This mapper is the only thing standing between Google's payload and four
 * fields a producer will submit without re-reading. Two of the cases below are
 * silent-data-corruption guards rather than correctness checks — see the ZIP
 * and state blocks.
 */

const component = (
  types: string[],
  longText: string,
  shortText = longText,
): GoogleAddressComponent => ({ types, longText, shortText });

/** A plausible Oklahoma City response, in the order Google returns components. */
const OKC_COMPONENTS: GoogleAddressComponent[] = [
  component(['street_number'], '4821'),
  component(['route'], 'North Maple Avenue', 'N Maple Ave'),
  component(['locality', 'political'], 'Oklahoma City'),
  component(['administrative_area_level_1', 'political'], 'Oklahoma', 'OK'),
  component(['country', 'political'], 'United States', 'US'),
  component(['postal_code'], '73013'),
];

describe('toStateName', () => {
  it('expands the USPS code', () => {
    expect(toStateName('OK')).toBe('Oklahoma');
    expect(toStateName('ok')).toBe('Oklahoma');
  });

  it('leaves an already-spelled-out name alone', () => {
    expect(toStateName('Oklahoma')).toBe('Oklahoma');
  });

  it('passes an unrecognized value through rather than blanking it', () => {
    // A non-US or malformed value must reach the producer's eyes so they can
    // fix it — silently emptying a field they filled in is worse than wrong.
    expect(toStateName('Ontario')).toBe('Ontario');
  });

  it('treats blank input as blank', () => {
    expect(toStateName('')).toBe('');
    expect(toStateName(null)).toBe('');
    expect(toStateName(undefined)).toBe('');
  });
});

describe('mapPlaceComponents', () => {
  it('joins street number and route', () => {
    expect(mapPlaceComponents(OKC_COMPONENTS).street).toBe('4821 North Maple Avenue');
  });

  it('reads longText, not shortText', () => {
    // Google's own sample form maps `shortText`. Copying it would write
    // `4821 N Maple Ave` / `OK` and split new records apart from every
    // migrated SmartSuite household, which stores the spelled-out forms.
    const mapped = mapPlaceComponents(OKC_COMPONENTS);
    expect(mapped.street).toBe('4821 North Maple Avenue');
    expect(mapped.state).toBe('Oklahoma');
  });

  it('expands a state Google only spelled short', () => {
    const shortOnly = [
      component(['administrative_area_level_1', 'political'], 'OK', 'OK'),
    ];
    expect(mapPlaceComponents(shortOnly).state).toBe('Oklahoma');
  });

  it('appends a subpremise to the street', () => {
    const withUnit = [...OKC_COMPONENTS, component(['subpremise'], 'Apt 3B')];
    expect(mapPlaceComponents(withUnit).street).toBe('4821 North Maple Avenue, Apt 3B');
  });

  it('falls back to premise when there is no numbered street', () => {
    const rural = [
      component(['premise'], 'Willow Creek Ranch'),
      component(['postal_code'], '73044'),
    ];
    expect(mapPlaceComponents(rural).street).toBe('Willow Creek Ranch');
  });

  it('falls through the city chain when there is no locality', () => {
    // Rural Oklahoma addresses routinely carry no `locality`. Without this
    // chain, City would be blank on exactly the addresses this feature is
    // least able to afford getting wrong.
    const noLocality = [
      component(['street_number'], '17'),
      component(['route'], 'County Road 220'),
      component(['administrative_area_level_3', 'political'], 'Guthrie'),
      component(['administrative_area_level_1', 'political'], 'Oklahoma', 'OK'),
      component(['postal_code'], '73044'),
    ];
    expect(mapPlaceComponents(noLocality).city).toBe('Guthrie');
  });

  it('DROPS postal_code_suffix', () => {
    // Load-bearing. ZIP is half of `buildAddressKey(street, zip)`, so a lead
    // keyed `73013-1234` can never match a migrated household keyed `73013`.
    // Appending +4 would silently disable household dedupe for every address
    // Google happens to know the suffix for.
    const withPlusFour = [...OKC_COMPONENTS, component(['postal_code_suffix'], '1234')];
    expect(mapPlaceComponents(withPlusFour).zip).toBe('73013');
  });

  it('survives a place with no components at all', () => {
    expect(mapPlaceComponents(undefined)).toEqual({
      street: '',
      city: '',
      state: '',
      zip: '',
    });
  });
});

describe('mapPostalAddress', () => {
  it('expands the short administrativeArea', () => {
    // The trap that makes a `longText`-only rule insufficient: Address
    // Validation returns ONLY the two-letter code here.
    const mapped = mapPostalAddress({
      addressLines: ['4821 N Maple Ave'],
      locality: 'Oklahoma City',
      administrativeArea: 'OK',
      postalCode: '73013-1234',
      regionCode: 'US',
    });
    expect(mapped.state).toBe('Oklahoma');
  });

  it('drops the +4 from postalCode', () => {
    expect(
      mapPostalAddress({ postalCode: '73013-1234' }).zip,
    ).toBe('73013');
  });

  it('joins multiple address lines', () => {
    expect(
      mapPostalAddress({ addressLines: ['4821 N Maple Ave', 'Apt 3B'] }).street,
    ).toBe('4821 N Maple Ave, Apt 3B');
  });
});

describe('isEmptyAddress', () => {
  it('is true when there is nothing worth writing into the form', () => {
    expect(isEmptyAddress({ street: '', city: '', state: 'Oklahoma', zip: '' })).toBe(true);
  });

  it('is false as soon as any locating field is present', () => {
    expect(isEmptyAddress({ street: '4821 N Maple Ave', city: '', state: '', zip: '' })).toBe(false);
  });
});

describe('withDefaultState', () => {
  it('fills a blank state with the agency default', () => {
    expect(withDefaultState({ street: 'x', city: 'y', state: '', zip: 'z' }).state).toBe(
      DEFAULT_ADDRESS_STATE,
    );
  });

  it('never overwrites a state Google actually returned', () => {
    expect(withDefaultState({ street: 'x', city: 'y', state: 'Texas', zip: 'z' }).state).toBe(
      'Texas',
    );
  });
});
