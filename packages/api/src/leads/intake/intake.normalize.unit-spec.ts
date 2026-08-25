import {
  buildAddressKey,
  buildSubmissionToken,
  normalizeEmail,
  normalizeName,
  normalizePhone,
  parseDateOfBirth,
  phonesMatch,
  toDateKey,
} from './intake.normalize';

describe('intake normalisation', () => {
  describe('normalizeEmail', () => {
    it('lowercases and trims', () => {
      expect(normalizeEmail('  Pat.Producer@Example.COM ')).toBe(
        'pat.producer@example.com',
      );
    });

    it('returns null for empty or whitespace-only input', () => {
      expect(normalizeEmail('   ')).toBeNull();
      expect(normalizeEmail(undefined)).toBeNull();
      expect(normalizeEmail(null)).toBeNull();
    });
  });

  describe('normalizePhone', () => {
    it('strips the punctuation people actually type', () => {
      expect(normalizePhone('(555) 123-4567')).toBe('5551234567');
      expect(normalizePhone('555.123.4567')).toBe('5551234567');
      expect(normalizePhone('+1 555 123 4567')).toBe('15551234567');
    });

    it('returns null when nothing is left', () => {
      expect(normalizePhone('---')).toBeNull();
      expect(normalizePhone(null)).toBeNull();
    });
  });

  describe('phonesMatch', () => {
    it('treats a US country code as optional', () => {
      expect(phonesMatch('5551234567', '15551234567')).toBe(true);
      expect(phonesMatch('15551234567', '5551234567')).toBe(true);
    });

    it('does not match different numbers or nulls', () => {
      expect(phonesMatch('5551234567', '5559999999')).toBe(false);
      expect(phonesMatch(null, '5551234567')).toBe(false);
    });
  });

  describe('normalizeName', () => {
    it('trims and collapses internal whitespace', () => {
      expect(normalizeName('  Mary   Jane  ')).toBe('Mary Jane');
      expect(normalizeName(undefined)).toBe('');
    });
  });

  describe('parseDateOfBirth', () => {
    // The regression this guards: `new Date('1990-02-05T00:00:00')` is LOCAL
    // time, so west of Greenwich the stored date silently becomes 1990-02-04 and
    // contact matching stops finding the person.
    it('parses to UTC midnight with no timezone drift', () => {
      const parsed = parseDateOfBirth('1990-02-05');
      expect(parsed).not.toBeNull();
      expect(parsed?.toISOString()).toBe('1990-02-05T00:00:00.000Z');
      expect(parsed?.getUTCDate()).toBe(5);
    });

    it('round-trips through toDateKey', () => {
      expect(toDateKey(parseDateOfBirth('2001-12-31'))).toBe('2001-12-31');
    });

    it('rejects malformed input', () => {
      expect(parseDateOfBirth('05/02/1990')).toBeNull();
      expect(parseDateOfBirth('1990-2-5')).toBeNull();
      expect(parseDateOfBirth('')).toBeNull();
      expect(parseDateOfBirth(undefined)).toBeNull();
    });

    it('rejects impossible dates instead of rolling them over', () => {
      // Date.UTC(2025, 1, 30) would silently become March 2nd.
      expect(parseDateOfBirth('2025-02-30')).toBeNull();
      expect(parseDateOfBirth('2025-13-01')).toBeNull();
    });
  });

  describe('toDateKey', () => {
    it('reduces a stored timestamp to its UTC calendar day', () => {
      expect(toDateKey(new Date('1990-02-05T23:59:59.000Z'))).toBe(
        '1990-02-05',
      );
    });

    it('returns null for absent or invalid values', () => {
      expect(toDateKey(null)).toBeNull();
      expect(toDateKey('not a date')).toBeNull();
    });
  });

  describe('buildAddressKey', () => {
    it('lowercases and trims BOTH parts', () => {
      // Legacy trimmed the zip but did not lowercase it, so `90210 ` and
      // `90210` produced two different keys for one address.
      expect(buildAddressKey('  123 Main St ', ' 90210 ')).toBe(
        '123 main st|90210',
      );
      expect(buildAddressKey('123 Main St', '90210-A')).toBe(
        '123 main st|90210-a',
      );
    });

    it('returns null unless both street and zip are present', () => {
      expect(buildAddressKey('123 Main St', null)).toBeNull();
      expect(buildAddressKey(null, '90210')).toBeNull();
      expect(buildAddressKey('   ', '90210')).toBeNull();
    });
  });

  describe('buildSubmissionToken', () => {
    it('namespaces by channel', () => {
      expect(buildSubmissionToken('internal', 'abc-123')).toBe('WEB|ABC-123');
      expect(buildSubmissionToken('share_link', 'abc-123', 'link1')).toBe(
        'SHARE|link1|ABC-123',
      );
    });

    it('keeps two channels from colliding on the same client uuid', () => {
      const uuid = 'de305d54-75b4-431b-adb2-eb6b9e546014';
      expect(buildSubmissionToken('internal', uuid)).not.toBe(
        buildSubmissionToken('share_link', uuid, 'link1'),
      );
    });

    it('keeps two different links from colliding', () => {
      const uuid = 'de305d54-75b4-431b-adb2-eb6b9e546014';
      expect(buildSubmissionToken('share_link', uuid, 'link1')).not.toBe(
        buildSubmissionToken('share_link', uuid, 'link2'),
      );
    });

    it('returns null when no token was supplied', () => {
      expect(buildSubmissionToken('internal', undefined)).toBeNull();
      expect(buildSubmissionToken('internal', '  ')).toBeNull();
    });
  });
});
