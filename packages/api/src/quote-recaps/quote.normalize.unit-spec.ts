import { quoteDateYmd } from './quote.normalize';

describe('quoteDateYmd', () => {
  describe('migrated recaps (date-only, stored at UTC midnight)', () => {
    it('preserves the date the source system stated', () => {
      // Deriving from Chicago parts would read this as 18:00 on Jan 14 and
      // shift every migrated recap back a day.
      expect(quoteDateYmd(new Date('2026-01-15T00:00:00.000Z'))).toBe(20260115);
    });

    it('preserves a date on the first of a month', () => {
      expect(quoteDateYmd(new Date('2026-03-01T00:00:00.000Z'))).toBe(20260301);
    });

    it('preserves a date on January 1st', () => {
      expect(quoteDateYmd(new Date('2026-01-01T00:00:00.000Z'))).toBe(20260101);
    });
  });

  describe('app-written recaps (a true instant from new Date())', () => {
    it('files an evening quote on the Chicago day, not the UTC one', () => {
      // 19:00 CT on Aug 5 is 00:00Z on Aug 6. UTC derivation would put this
      // on tomorrow's scorecard.
      expect(quoteDateYmd(new Date('2026-08-06T00:00:00.001Z'))).toBe(20260805);
    });

    it('files a late-evening winter quote on the Chicago day', () => {
      // 23:30 CST on Jan 14 is 05:30Z on Jan 15.
      expect(quoteDateYmd(new Date('2026-01-15T05:30:00.000Z'))).toBe(20260114);
    });

    it('agrees with UTC for a midday quote', () => {
      expect(quoteDateYmd(new Date('2026-08-06T17:00:00.000Z'))).toBe(20260806);
    });

    it('handles a quote taken moments before Chicago midnight', () => {
      // 23:59 CDT on Aug 6 is 04:59Z on Aug 7.
      expect(quoteDateYmd(new Date('2026-08-07T04:59:00.000Z'))).toBe(20260806);
    });

    it('rolls to the next Chicago day just after Chicago midnight', () => {
      // 00:01 CDT on Aug 7 is 05:01Z on Aug 7.
      expect(quoteDateYmd(new Date('2026-08-07T05:01:00.000Z'))).toBe(20260807);
    });
  });

  it('returns undefined for an invalid date rather than NaN', () => {
    // A NaN here would be written straight into the document and quietly
    // exclude the recap from every range query.
    expect(quoteDateYmd(new Date('nonsense'))).toBeUndefined();
  });
});
