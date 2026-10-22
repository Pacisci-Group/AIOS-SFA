import {
  endOfDaySweepDate,
  requireEndOfDayHour,
  sweepMarkerAfterScheduleChange,
} from './end-of-day';

const CHICAGO = 'America/Chicago';
/** 8 PM — the default, and the hour every case below ran on before PAC-149. */
const EIGHT_PM = 20;

// PAC-149: the hour is the agency's, and a required argument.
describe('requireEndOfDayHour', () => {
  it('accepts every whole hour of the day', () => {
    for (let hour = 0; hour <= 23; hour += 1) {
      expect(requireEndOfDayHour(hour)).toBe(hour);
    }
  });

  it('refuses anything else, naming what it wanted', () => {
    // A stale `(now, zone, lastAwayDate)` call lands a date string here.
    for (const bad of ['2026-09-25', '20', 24, -1, 7.5, NaN, null, undefined]) {
      expect(() => requireEndOfDayHour(bad)).toThrow(/Agency\.endOfDayHour/);
    }
  });
});

describe('endOfDaySweepDate', () => {
  it('is not due before 8 PM local, whatever the marker says', () => {
    // 19:59 CDT
    const at = new Date('2026-09-26T00:59:00Z');
    expect(endOfDaySweepDate(at, CHICAGO, EIGHT_PM, null)).toBeNull();
    expect(endOfDaySweepDate(at, CHICAGO, EIGHT_PM, '2026-09-24')).toBeNull();
  });

  it('is due from 8 PM local, for the local date', () => {
    // 20:00 CDT — still the 25th in Chicago, already the 26th in UTC.
    const at = new Date('2026-09-26T01:00:00Z');
    expect(endOfDaySweepDate(at, CHICAGO, EIGHT_PM, null)).toBe('2026-09-25');
    expect(endOfDaySweepDate(at, CHICAGO, EIGHT_PM, undefined)).toBe(
      '2026-09-25',
    );
    expect(endOfDaySweepDate(at, CHICAGO, EIGHT_PM, '2026-09-24')).toBe(
      '2026-09-25',
    );
  });

  it('runs once per local date', () => {
    const at = new Date('2026-09-26T01:30:00Z'); // 20:30 CDT
    expect(endOfDaySweepDate(at, CHICAGO, EIGHT_PM, '2026-09-25')).toBeNull();
  });

  it('catches up a missed tick later the same evening', () => {
    const at = new Date('2026-09-26T04:30:00Z'); // 23:30 CDT
    expect(endOfDaySweepDate(at, CHICAGO, EIGHT_PM, '2026-09-24')).toBe(
      '2026-09-25',
    );
  });

  it('does not bleed into the next local date after midnight', () => {
    const at = new Date('2026-09-26T05:30:00Z'); // 00:30 CDT on the 26th
    expect(endOfDaySweepDate(at, CHICAGO, EIGHT_PM, '2026-09-25')).toBeNull();
    expect(endOfDaySweepDate(at, CHICAGO, EIGHT_PM, null)).toBeNull();
  });

  it('follows the zone across a DST change', () => {
    // The evening before spring-forward (CST, UTC-6): 20:00 is 02:00Z.
    expect(
      endOfDaySweepDate(
        new Date('2026-03-08T01:59:00Z'),
        CHICAGO,
        EIGHT_PM,
        null,
      ),
    ).toBeNull();
    expect(
      endOfDaySweepDate(
        new Date('2026-03-08T02:00:00Z'),
        CHICAGO,
        EIGHT_PM,
        null,
      ),
    ).toBe('2026-03-07');
    // The evening after (CDT, UTC-5): 20:00 is 01:00Z.
    expect(
      endOfDaySweepDate(
        new Date('2026-03-09T01:00:00Z'),
        CHICAGO,
        EIGHT_PM,
        '2026-03-07',
      ),
    ).toBe('2026-03-08');
  });

  it('keys off the agency zone, not the server clock', () => {
    const at = new Date('2026-09-25T14:30:00Z');
    expect(endOfDaySweepDate(at, 'Asia/Kolkata', EIGHT_PM, null)).toBe(
      '2026-09-25',
    ); // 20:00 IST
    expect(endOfDaySweepDate(at, CHICAGO, EIGHT_PM, null)).toBeNull(); // 09:30 CDT
  });

  it('keys off the agency hour, not 8 PM', () => {
    // 14:30Z is 09:30 CDT: due for an agency that ends its day at 9 AM (an
    // odd choice, but a legal one), not for one on the default.
    const at = new Date('2026-09-25T14:30:00Z');
    expect(endOfDaySweepDate(at, CHICAGO, 9, null)).toBe('2026-09-25');
    expect(endOfDaySweepDate(at, CHICAGO, 10, null)).toBeNull();
    expect(endOfDaySweepDate(at, CHICAGO, 9, '2026-09-25')).toBeNull();
    // 18:00 CDT: due on a 6 PM agency, an hour early for the default.
    const six = new Date('2026-09-25T23:00:00Z');
    expect(endOfDaySweepDate(six, CHICAGO, 18, null)).toBe('2026-09-25');
    expect(endOfDaySweepDate(six, CHICAGO, EIGHT_PM, null)).toBeNull();
  });

  it('treats hour 0 as due from local midnight, for the date just begun', () => {
    const at = new Date('2026-09-26T05:00:00Z'); // 00:00 CDT on the 26th
    expect(endOfDaySweepDate(at, CHICAGO, 0, null)).toBe('2026-09-26');
    expect(endOfDaySweepDate(at, CHICAGO, 0, '2026-09-26')).toBeNull();
  });

  it('refuses a call that forgot the hour', () => {
    const at = new Date('2026-09-26T01:00:00Z');
    expect(() =>
      // The pre-PAC-149 shape, which a spec would not catch at compile time.
      (endOfDaySweepDate as (...args: unknown[]) => unknown)(
        at,
        CHICAGO,
        '2026-09-24',
      ),
    ).toThrow(/Agency\.endOfDayHour/);
  });
});

// PAC-141 / PAC-149: what the marker becomes when the working day changes.
describe('sweepMarkerAfterScheduleChange', () => {
  it('marks tonight done when it is already 8 PM or later in the new zone', () => {
    // 14:30Z: 20:00 in Kolkata. Moving there from Chicago mid-morning must not
    // put the whole office Away within the next thirty minutes.
    const at = new Date('2026-09-25T14:30:00Z');
    expect(sweepMarkerAfterScheduleChange(at, 'Asia/Kolkata', EIGHT_PM)).toBe(
      '2026-09-25',
    );
    // A minute earlier it is 19:59 there: not yet.
    expect(
      sweepMarkerAfterScheduleChange(
        new Date('2026-09-25T14:29:00Z'),
        'Asia/Kolkata',
        EIGHT_PM,
      ),
    ).toBeNull();
  });

  it('clears the marker when the new zone has not reached 8 PM yet', () => {
    // 02:00Z on the 26th: 21:00 CDT on the 25th (Chicago's sweep has run), but
    // only 19:00 PDT. The old marker would say "25th, done" and skip tonight's
    // 8 PM in Los Angeles; cleared, that sweep runs.
    const at = new Date('2026-09-26T02:00:00Z');
    expect(
      sweepMarkerAfterScheduleChange(at, 'America/Los_Angeles', EIGHT_PM),
    ).toBeNull();
    expect(sweepMarkerAfterScheduleChange(at, CHICAGO, EIGHT_PM)).toBe(
      '2026-09-25',
    );
  });

  it('follows the new zone across the date line', () => {
    // 09:30Z on the 25th is 23:30 on the 25th in Kiritimati (UTC+14).
    const at = new Date('2026-09-25T09:30:00Z');
    expect(
      sweepMarkerAfterScheduleChange(at, 'Pacific/Kiritimati', EIGHT_PM),
    ).toBe('2026-09-25');
  });

  it('marks tonight done when the new hour has already passed', () => {
    // 13:00 CDT. Moving the hour from 20 to 9 by mistake must not put the
    // office Away within thirty minutes of the save.
    const at = new Date('2026-09-25T18:00:00Z');
    expect(sweepMarkerAfterScheduleChange(at, CHICAGO, 9)).toBe('2026-09-25');
    expect(sweepMarkerAfterScheduleChange(at, CHICAGO, 13)).toBe('2026-09-25');
  });

  it('clears the marker when the new hour is still ahead tonight', () => {
    // 21:00 CDT: the 8 PM sweep has run. Moving the hour to 22 clears the
    // marker so 10 PM runs; moving it to 18 keeps tonight done.
    const at = new Date('2026-09-26T02:00:00Z');
    expect(sweepMarkerAfterScheduleChange(at, CHICAGO, 22)).toBeNull();
    expect(sweepMarkerAfterScheduleChange(at, CHICAGO, 18)).toBe('2026-09-25');
  });
});
