import {
  normalizeStoredAddress,
  resolveHouseholdAddress,
} from './household-address';

/**
 * Three writers use three different key sets for the same address. If any one
 * of them stops being handled, "Same as Household Address" silently pre-fills
 * blank fields rather than failing loudly — hence a test per shape.
 */
describe('normalizeStoredAddress', () => {
  it('reads the lead-intake shape', () => {
    expect(
      normalizeStoredAddress({
        street: '420 Main St',
        city: 'Jenks',
        state: 'OK',
        zip: '74037',
      }),
    ).toEqual({
      street: '420 Main St',
      city: 'Jenks',
      state: 'OK',
      zip: '74037',
    });
  });

  it('reads the demo-seed shape (`line1`)', () => {
    expect(
      normalizeStoredAddress({
        line1: '1200 Oak Ave',
        city: 'Tulsa',
        state: 'OK',
        zip: '74101',
      }),
    ).toEqual({
      street: '1200 Oak Ave',
      city: 'Tulsa',
      state: 'OK',
      zip: '74101',
    });
  });

  it('reads the raw SmartSuite shape (`location_*`)', () => {
    expect(
      normalizeStoredAddress({
        location_address: '77 Birch Rd',
        location_address2: 'Apt 4',
        location_city: 'Bixby',
        location_state: 'Oklahoma',
        location_zip: '74008',
      }),
    ).toEqual({
      street: '77 Birch Rd',
      city: 'Bixby',
      state: 'Oklahoma',
      zip: '74008',
    });
  });

  it('trims and prefers the first non-empty candidate key', () => {
    expect(
      normalizeStoredAddress({
        street: '  ',
        line1: '  9 Elm Ct  ',
        location_city: 'Owasso',
        zip: '74055',
      }),
    ).toEqual({ street: '9 Elm Ct', city: 'Owasso', state: '', zip: '74055' });
  });

  it('returns null for empty, partial-state-only, and non-object input', () => {
    expect(normalizeStoredAddress(undefined)).toBeNull();
    expect(normalizeStoredAddress(null)).toBeNull();
    expect(normalizeStoredAddress({})).toBeNull();
    expect(normalizeStoredAddress('420 Main St')).toBeNull();
    expect(normalizeStoredAddress([])).toBeNull();
    // A state on its own is not a usable property address.
    expect(normalizeStoredAddress({ state: 'OK' })).toBeNull();
  });
});

describe('resolveHouseholdAddress', () => {
  const lead = { street: 'Lead St', city: 'A', state: 'OK', zip: '1' };
  const property = { line1: 'Property Ave', city: 'B', state: 'OK', zip: '2' };
  const mailing = { location_address: 'Mail Rd', location_city: 'C' };

  it('prefers the lead address', () => {
    expect(resolveHouseholdAddress(lead, property, mailing)?.street).toBe(
      'Lead St',
    );
  });

  it('falls back to the household property address', () => {
    expect(resolveHouseholdAddress(undefined, property, mailing)?.street).toBe(
      'Property Ave',
    );
  });

  it('falls back to mailing last', () => {
    expect(resolveHouseholdAddress(undefined, {}, mailing)?.street).toBe(
      'Mail Rd',
    );
  });

  it('returns null when nothing usable is on file', () => {
    expect(resolveHouseholdAddress(undefined, undefined, undefined)).toBeNull();
  });
});
