import { quoteDateYmd } from './quote.normalize';

const CHICAGO = 'America/Chicago';
const KOLKATA = 'Asia/Kolkata';

describe('quoteDateYmd', () => {
  describe('migrated recaps (date-only, stored at UTC midnight)', () => {
    it('preserves the date the source system stated', () => {
      // Deriving from Chicago parts would read this as 18:00 on Jan 14 and
      // shift every migrated recap back a day.
      expect(quoteDateYmd(new Date('2026-01-15T00:00:00.000Z'), CHICAGO)).toBe(
        20260115,
      );
    });

    it('preserves a date on the first of a month', () => {
      expect(quoteDateYmd(new Date('2026-03-01T00:00:00.000Z'), CHICAGO)).toBe(
        20260301,
      );
    });

    it('preserves a date on January 1st', () => {
      expect(quoteDateYmd(new Date('2026-01-01T00:00:00.000Z'), CHICAGO)).toBe(
        20260101,
      );
    });

    it('preserves the stated date whatever zone the agency keeps', () => {
      // UTC midnight is 05:30 the same day in Kolkata and 18:00 the previous
      // day in Chicago; the provenance rule makes both read Jan 15.
      const migrated = new Date('2026-01-15T00:00:00.000Z');
      expect(quoteDateYmd(migrated, KOLKATA)).toBe(20260115);
      expect(quoteDateYmd(migrated, CHICAGO)).toBe(20260115);
    });
  });

  describe('app-written recaps (a true instant from new Date())', () => {
    it('files an evening quote on the agency day, not the UTC one', () => {
      // 19:00 CT on Aug 5 is 00:00Z on Aug 6. UTC derivation would put this
      // on tomorrow's scorecard.
      expect(quoteDateYmd(new Date('2026-08-06T00:00:00.001Z'), CHICAGO)).toBe(
        20260805,
      );
    });

    it('files a late-evening winter quote on the agency day', () => {
      // 23:30 CST on Jan 14 is 05:30Z on Jan 15.
      expect(quoteDateYmd(new Date('2026-01-15T05:30:00.000Z'), CHICAGO)).toBe(
        20260114,
      );
    });

    it('agrees with UTC for a midday quote', () => {
      expect(quoteDateYmd(new Date('2026-08-06T17:00:00.000Z'), CHICAGO)).toBe(
        20260806,
      );
    });

    it('handles a quote taken moments before agency midnight', () => {
      // 23:59 CDT on Aug 6 is 04:59Z on Aug 7.
      expect(quoteDateYmd(new Date('2026-08-07T04:59:00.000Z'), CHICAGO)).toBe(
        20260806,
      );
    });

    it('rolls to the next agency day just after agency midnight', () => {
      // 00:01 CDT on Aug 7 is 05:01Z on Aug 7.
      expect(quoteDateYmd(new Date('2026-08-07T05:01:00.000Z'), CHICAGO)).toBe(
        20260807,
      );
    });

    it('files the same instant on different days for agencies in different zones', () => {
      // 19:00Z on Aug 5 is 14:00 Aug 5 in Chicago and 00:30 Aug 6 in Kolkata.
      const at = new Date('2026-08-05T19:00:00.000Z');
      expect(quoteDateYmd(at, CHICAGO)).toBe(20260805);
      expect(quoteDateYmd(at, KOLKATA)).toBe(20260806);
    });
  });

  it('returns undefined for an invalid date rather than NaN', () => {
    // A NaN here would be written straight into the document and quietly
    // exclude the recap from every range query.
    expect(quoteDateYmd(new Date('nonsense'), CHICAGO)).toBeUndefined();
  });

  it('refuses a missing zone rather than filing on the host clock', () => {
    expect(() =>
      quoteDateYmd(
        new Date('2026-08-05T19:00:00.000Z'),
        undefined as unknown as string,
      ),
    ).toThrow(/time zone is required/i);
  });
});
