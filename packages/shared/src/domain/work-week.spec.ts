import { DEFAULT_WORK_WEEK_DAYS } from './hr-policy';
import { clockMinutes, scheduledDayHours, weeklyHours } from './work-week';

describe('weekly hours (PAC-162)', () => {
  it('reads a clock value as minutes past midnight', () => {
    expect(clockMinutes('00:00')).toBe(0);
    expect(clockMinutes('09:30')).toBe(570);
    expect(clockMinutes('17:00')).toBe(1020);
  });

  it('sums the default week to forty hours', () => {
    expect(weeklyHours(DEFAULT_WORK_WEEK_DAYS)).toBe(40);
  });

  it('keeps quarter hours and rounds to two decimals', () => {
    expect(scheduledDayHours({ start: '08:30', end: '12:15' })).toBe(3.75);
    expect(
      weeklyHours([
        { start: '08:30', end: '12:15' },
        { start: '13:00', end: '17:20' },
      ]),
    ).toBe(8.08);
  });

  it('is zero for no days and never negative for an inverted day', () => {
    expect(weeklyHours([])).toBe(0);
    expect(scheduledDayHours({ start: '17:00', end: '09:00' })).toBe(0);
  });
});
