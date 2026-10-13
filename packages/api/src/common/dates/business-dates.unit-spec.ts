import {
  businessDateInstant,
  businessDay,
  businessDaysDiff,
} from './business-dates';

const CHICAGO = 'America/Chicago';
const KOLKATA = 'Asia/Kolkata';

describe('business dates (PAC-159)', () => {
  describe('businessDateInstant', () => {
    it('stores a day-only entry at agency-local midnight, never UTC midnight', () => {
      expect(businessDateInstant('2026-10-06', CHICAGO).toISOString()).toBe(
        '2026-10-06T05:00:00.000Z',
      );
      expect(businessDateInstant('2026-01-15', CHICAGO).toISOString()).toBe(
        '2026-01-15T06:00:00.000Z',
      );
      expect(businessDateInstant('2026-10-06', KOLKATA).toISOString()).toBe(
        '2026-10-05T18:30:00.000Z',
      );
      expect(businessDateInstant('2026-10-06', 'UTC').toISOString()).toBe(
        '2026-10-06T00:00:00.000Z',
      );
    });

    it('round-trips through businessDay in the same zone', () => {
      for (const day of ['2026-03-08', '2026-11-01', '2026-12-31']) {
        expect(businessDay(businessDateInstant(day, CHICAGO), CHICAGO)).toBe(
          day,
        );
      }
    });

    it('ignores anything after the date part', () => {
      expect(
        businessDateInstant('2026-10-06T15:00:00.000Z', CHICAGO).toISOString(),
      ).toBe('2026-10-06T05:00:00.000Z');
    });
  });

  describe('businessDay', () => {
    it('reads an evening instant on the agency day, not the UTC day', () => {
      // 01:00Z on the 6th is 20:00 CDT on the 5th.
      expect(businessDay(new Date('2026-08-06T01:00:00.000Z'), CHICAGO)).toBe(
        '2026-08-05',
      );
      expect(businessDay(new Date('2026-08-06T01:00:00.000Z'), KOLKATA)).toBe(
        '2026-08-06',
      );
    });

    it('is null for an absent or invalid value', () => {
      expect(businessDay(null, CHICAGO)).toBeNull();
      expect(businessDay(undefined, CHICAGO)).toBeNull();
      expect(businessDay(new Date('nope'), CHICAGO)).toBeNull();
    });

    it('throws without a zone, like every zone-taking helper', () => {
      expect(() => businessDay(new Date(), '')).toThrow(
        /time zone is required/i,
      );
    });
  });

  describe('businessDaysDiff', () => {
    it('counts agency-calendar days, same day being zero', () => {
      const quoted = businessDateInstant('2026-05-04', CHICAGO);
      const sold = new Date('2026-05-21T02:30:00.000Z'); // 21:30 CDT May 20
      expect(businessDaysDiff(quoted, sold, CHICAGO)).toBe(16);
      expect(businessDaysDiff(quoted, quoted, CHICAGO)).toBe(0);
      expect(businessDaysDiff(sold, quoted, CHICAGO)).toBe(-16);
    });

    it('is unaffected by a DST change inside the span', () => {
      expect(
        businessDaysDiff(
          businessDateInstant('2026-03-01', CHICAGO),
          businessDateInstant('2026-03-15', CHICAGO),
          CHICAGO,
        ),
      ).toBe(14);
    });
  });
});
