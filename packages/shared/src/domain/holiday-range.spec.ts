import {
  expandHolidayRange,
  holidayRangeError,
  MAX_HOLIDAY_RANGE_DAYS,
} from './holiday-range';
import { ALL_WEEKDAYS, DEFAULT_WORKWEEK } from './hr-calendar';

describe('custom holiday ranges (PAC-161)', () => {
  it('expands a range to its workweek days only', () => {
    // Thu 24 Dec 2026 – Sat 2 Jan 2027: Mon–Fri skips the two weekends.
    expect(expandHolidayRange('2026-12-24', '2027-01-02', DEFAULT_WORKWEEK)).toEqual([
      '2026-12-24',
      '2026-12-25',
      '2026-12-28',
      '2026-12-29',
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
    ]);
  });

  it('keeps every day for a seven-day workweek', () => {
    expect(expandHolidayRange('2026-12-24', '2027-01-02', ALL_WEEKDAYS)).toHaveLength(10);
  });

  it('expands a single day, and nothing on a closed day', () => {
    expect(expandHolidayRange('2026-11-27', '2026-11-27', DEFAULT_WORKWEEK)).toEqual([
      '2026-11-27',
    ]);
    // Sunday.
    expect(expandHolidayRange('2026-11-29', '2026-11-29', DEFAULT_WORKWEEK)).toEqual([]);
  });

  it('refuses an end before the start, a malformed day and a rolled-over day', () => {
    expect(holidayRangeError('2026-12-26', '2026-12-24')).toBe(
      'The end date is before the start date.',
    );
    expect(holidayRangeError('', '2026-12-24')).toBe('Choose a start date.');
    expect(holidayRangeError('2026-12-24', '2026-13-01')).toBe('Choose an end date.');
    expect(holidayRangeError('2026-02-30', '2026-03-01')).toBe('Choose a start date.');
    expect(expandHolidayRange('2026-12-26', '2026-12-24', ALL_WEEKDAYS)).toEqual([]);
  });

  it(`caps a range at ${MAX_HOLIDAY_RANGE_DAYS} days inclusive`, () => {
    expect(holidayRangeError('2026-01-01', '2026-03-01')).toBeNull(); // 60 days
    expect(holidayRangeError('2026-01-01', '2026-03-02')).toMatch(/at most 60 days/);
  });

  it('is unmoved by the process zone', () => {
    const original = process.env.TZ;
    process.env.TZ = 'Pacific/Kiritimati';
    try {
      expect(expandHolidayRange('2026-01-01', '2026-01-02', ALL_WEEKDAYS)).toEqual([
        '2026-01-01',
        '2026-01-02',
      ]);
    } finally {
      process.env.TZ = original;
    }
  });
});
