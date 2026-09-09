import {
  formatHouseholdRef,
  parseHouseholdRef,
  parseLegacyTicketNumber,
} from './record-reference';

/**
 * The parser is the migration's only bridge between the legacy SmartSuite title
 * and our own format, and it also seeds each agency's counter from the highest
 * number already imported. Getting it wrong is not a display bug: a reference
 * that fails to parse hands the household a *fresh* number from the counter, so
 * an agency would see IDs it has been using for years silently renumbered.
 */
describe('household references', () => {
  describe('formatHouseholdRef', () => {
    it('renders the sequence unpadded', () => {
      expect(formatHouseholdRef(1)).toBe('HH-1');
      expect(formatHouseholdRef(2614)).toBe('HH-2614');
    });

    it('refuses values a working counter cannot produce', () => {
      // Writing `HH-0` / `HH-NaN` into a unique index would outlive the bug
      // that produced it, so this throws rather than coercing.
      expect(() => formatHouseholdRef(0)).toThrow(RangeError);
      expect(() => formatHouseholdRef(-1)).toThrow(RangeError);
      expect(() => formatHouseholdRef(1.5)).toThrow(RangeError);
      expect(() => formatHouseholdRef(Number.NaN)).toThrow(RangeError);
    });
  });

  describe('parseHouseholdRef', () => {
    it('reads the legacy SmartSuite title', () => {
      expect(parseHouseholdRef('#HH2614')).toBe(2614);
    });

    it('strips the zero padding legacy used', () => {
      // `#HH0001` is a real legacy value; it must become 1, not 1000-something.
      expect(parseHouseholdRef('#HH0001')).toBe(1);
    });

    it('round-trips its own format', () => {
      expect(parseHouseholdRef(formatHouseholdRef(2614))).toBe(2614);
    });

    it('accepts the separator and case variants that reach it by hand', () => {
      expect(parseHouseholdRef('HH2614')).toBe(2614);
      expect(parseHouseholdRef('hh-2614')).toBe(2614);
      expect(parseHouseholdRef('  HH-2614  ')).toBe(2614);
    });

    it('returns null for anything that is not a reference', () => {
      for (const value of [
        null,
        undefined,
        '',
        '   ',
        'Record 1',
        'HH-',
        'HH-abc',
        '2614',
        'TKT-2614',
        // A legacy title that never had a number written into it.
        '#HH0000',
      ]) {
        expect(parseHouseholdRef(value)).toBeNull();
      }
    });

    it('rejects a number too large to survive the round trip', () => {
      expect(parseHouseholdRef(`HH-${'9'.repeat(20)}`)).toBeNull();
    });
  });
});

describe('parseLegacyTicketNumber', () => {
  it('reads the legacy SmartSuite title, dropping the hash and the padding', () => {
    expect(parseLegacyTicketNumber('#SFAS-030')).toBe('SFAS-30');
    expect(parseLegacyTicketNumber('#SFAS-002')).toBe('SFAS-2');
    expect(parseLegacyTicketNumber('#SFAS-300')).toBe('SFAS-300');
  });

  it('accepts our own format and the unseparated middle ground, any case', () => {
    expect(parseLegacyTicketNumber('SFAS-30')).toBe('SFAS-30');
    expect(parseLegacyTicketNumber('sfas030')).toBe('SFAS-30');
    expect(parseLegacyTicketNumber('  #Sfas-30  ')).toBe('SFAS-30');
  });

  it('keeps whatever prefix the title carried', () => {
    expect(parseLegacyTicketNumber('#XYZ-12')).toBe('XYZ-12');
  });

  it('is idempotent over its own output', () => {
    const once = parseLegacyTicketNumber('#SFAS-030');
    expect(parseLegacyTicketNumber(once)).toBe(once);
  });

  it('returns null for anything that is not a ticket number', () => {
    expect(parseLegacyTicketNumber(null)).toBeNull();
    expect(parseLegacyTicketNumber('')).toBeNull();
    expect(parseLegacyTicketNumber('Record 1')).toBeNull();
    expect(parseLegacyTicketNumber('#SFAS-000')).toBeNull();
    expect(parseLegacyTicketNumber('Nick Huddleston — Endorsement')).toBeNull();
  });
});
