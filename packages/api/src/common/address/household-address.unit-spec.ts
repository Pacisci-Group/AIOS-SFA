import {
  normalizeStoredAddress,
  resolveHouseholdAddress,
} from './household-address';

/**
 * One key set now, not three.
 *
 * PAC-101 made `Household.propertyAddress` a typed sub-schema and migrated
 * every stored document onto `street/street2/city/state/zip`, so the `line1`
 * and `location_*` aliases are gone.
 *
 * The alias cases below are **inverted rather than deleted**: a test asserting
 * that the old SmartSuite shape now yields `null` is worth more than a missing
 * one. It is what would fail if someone re-added the aliases to paper over an
 * un-migrated database instead of running the migration.
 */
describe('normalizeStoredAddress', () => {
  it('reads the one stored shape', () => {
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

  it('no longer reads the demo-seed shape (`line1`)', () => {
    // The seed writes `street` since PAC-101; a `line1` document could only
    // exist in a database the migration has not reached.
    expect(
      normalizeStoredAddress({ line1: '1200 Oak Ave', city: 'Tulsa' }),
    ).toEqual({ street: '', city: 'Tulsa', state: '', zip: '' });
  });

  it('no longer reads the raw SmartSuite shape (`location_*`)', () => {
    // Nothing usable at all, so this is `null` rather than a blank address.
    expect(
      normalizeStoredAddress({
        location_address: '77 Birch Rd',
        location_address2: 'Apt 4',
        location_city: 'Bixby',
        location_state: 'Oklahoma',
        location_zip: '74008',
      }),
    ).toBeNull();
  });

  it('carries `street2` through without folding it into `street`', () => {
    // `addressKey` is `"<street>|<zip>"`, so a unit line folded into `street`
    // would split two households in one building onto different keys.
    expect(
      normalizeStoredAddress({
        street: '77 Birch Rd',
        street2: 'Apt 4',
        city: 'Bixby',
        zip: '74008',
      }),
    ).toEqual({
      street: '77 Birch Rd',
      city: 'Bixby',
      state: '',
      zip: '74008',
    });
  });

  it('trims', () => {
    expect(
      normalizeStoredAddress({
        street: '  9 Elm Ct  ',
        city: 'Owasso',
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

/**
 * Precedence, not key shape — that is the whole of what this function decides,
 * and it is why it survives PAC-101 unchanged. The fixtures use the one stored
 * shape now.
 */
describe('resolveHouseholdAddress', () => {
  const lead = { street: 'Lead St', city: 'A', state: 'OK', zip: '1' };
  const property = { street: 'Property Ave', city: 'B', state: 'OK', zip: '2' };
  const mailing = { street: 'Mail Rd', city: 'C' };

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
