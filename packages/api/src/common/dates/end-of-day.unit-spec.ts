import {
  END_OF_DAY_LOCAL_HOUR,
  endOfDaySweepDate,
  sweepMarkerAfterZoneChange,
} from './end-of-day';

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

// PAC-141: what the marker becomes when the agency moves zones.
describe('sweepMarkerAfterZoneChange', () => {
  it('marks tonight done when it is already 8 PM or later in the new zone', () => {
    // 14:30Z: 20:00 in Kolkata. Moving there from Chicago mid-morning must not
    // put the whole office Away within the next thirty minutes.
    const at = new Date('2026-09-25T14:30:00Z');
    expect(sweepMarkerAfterZoneChange(at, 'Asia/Kolkata')).toBe('2026-09-25');
    // A minute earlier it is 19:59 there: not yet.
    expect(
      sweepMarkerAfterZoneChange(
        new Date('2026-09-25T14:29:00Z'),
        'Asia/Kolkata',
      ),
    ).toBeNull();
  });

  it('clears the marker when the new zone has not reached 8 PM yet', () => {
    // 02:00Z on the 26th: 21:00 CDT on the 25th (Chicago's sweep has run), but
    // only 19:00 PDT. The old marker would say "25th, done" and skip tonight's
    // 8 PM in Los Angeles; cleared, that sweep runs.
    const at = new Date('2026-09-26T02:00:00Z');
    expect(sweepMarkerAfterZoneChange(at, 'America/Los_Angeles')).toBeNull();
    expect(sweepMarkerAfterZoneChange(at, CHICAGO)).toBe('2026-09-25');
  });

  it('follows the new zone across the date line', () => {
    // 09:30Z on the 25th is 23:30 on the 25th in Kiritimati (UTC+14).
    const at = new Date('2026-09-25T09:30:00Z');
    expect(sweepMarkerAfterZoneChange(at, 'Pacific/Kiritimati')).toBe(
      '2026-09-25',
    );
  });
});
