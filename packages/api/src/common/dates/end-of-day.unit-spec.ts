import { END_OF_DAY_LOCAL_HOUR, endOfDaySweepDate } from './end-of-day';

const CHICAGO = 'America/Chicago';

describe('endOfDaySweepDate', () => {
  it('is 8 PM', () => {
    expect(END_OF_DAY_LOCAL_HOUR).toBe(20);
  });

  it('is not due before 8 PM local, whatever the marker says', () => {
    // 19:59 CDT
    const at = new Date('2026-09-26T00:59:00Z');
    expect(endOfDaySweepDate(at, CHICAGO, null)).toBeNull();
    expect(endOfDaySweepDate(at, CHICAGO, '2026-09-24')).toBeNull();
  });

  it('is due from 8 PM local, for the local date', () => {
    // 20:00 CDT — still the 25th in Chicago, already the 26th in UTC.
    const at = new Date('2026-09-26T01:00:00Z');
    expect(endOfDaySweepDate(at, CHICAGO, null)).toBe('2026-09-25');
    expect(endOfDaySweepDate(at, CHICAGO, undefined)).toBe('2026-09-25');
    expect(endOfDaySweepDate(at, CHICAGO, '2026-09-24')).toBe('2026-09-25');
  });

  it('runs once per local date', () => {
    const at = new Date('2026-09-26T01:30:00Z'); // 20:30 CDT
    expect(endOfDaySweepDate(at, CHICAGO, '2026-09-25')).toBeNull();
  });

  it('catches up a missed tick later the same evening', () => {
    const at = new Date('2026-09-26T04:30:00Z'); // 23:30 CDT
    expect(endOfDaySweepDate(at, CHICAGO, '2026-09-24')).toBe('2026-09-25');
  });

  it('does not bleed into the next local date after midnight', () => {
    const at = new Date('2026-09-26T05:30:00Z'); // 00:30 CDT on the 26th
    expect(endOfDaySweepDate(at, CHICAGO, '2026-09-25')).toBeNull();
    expect(endOfDaySweepDate(at, CHICAGO, null)).toBeNull();
  });

  it('follows the zone across a DST change', () => {
    // The evening before spring-forward (CST, UTC-6): 20:00 is 02:00Z.
    expect(
      endOfDaySweepDate(new Date('2026-03-08T01:59:00Z'), CHICAGO, null),
    ).toBeNull();
    expect(
      endOfDaySweepDate(new Date('2026-03-08T02:00:00Z'), CHICAGO, null),
    ).toBe('2026-03-07');
    // The evening after (CDT, UTC-5): 20:00 is 01:00Z.
    expect(
      endOfDaySweepDate(
        new Date('2026-03-09T01:00:00Z'),
        CHICAGO,
        '2026-03-07',
      ),
    ).toBe('2026-03-08');
  });

  it('keys off the agency zone, not the server clock', () => {
    const at = new Date('2026-09-25T14:30:00Z');
    expect(endOfDaySweepDate(at, 'Asia/Kolkata', null)).toBe('2026-09-25'); // 20:00 IST
    expect(endOfDaySweepDate(at, CHICAGO, null)).toBeNull(); // 09:30 CDT
  });
});
