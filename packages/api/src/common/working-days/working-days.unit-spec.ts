import type { WorkSchedule } from '@sfa/shared';
import { parseIsoDate, toIsoDate } from '../../performance/performance.range';
import {
  addBusinessDays,
  isWorkingDay,
  scheduledDaysBetween,
  snapshotFrom,
  workingDaysBetween,
  workingDaysInMonth,
} from './working-days';

const d = (iso: string) => parseIsoDate(iso);

/** Mon–Fri, with the US Thanksgiving pair and a flood closure in 2026. */
const sfa = snapshotFrom(
  [1, 2, 3, 4, 5],
  [
    { date: '2026-11-26', kind: 'holiday' },
    { date: '2026-11-27', kind: 'holiday' },
    { date: '2026-11-03', kind: 'closure' },
    // Open on a Saturday for the year-end push.
    { date: '2026-12-12', kind: 'special_working_day' },
  ],
);

describe('working days (PAC-161)', () => {
  describe('isWorkingDay', () => {
    it('follows the workweek with no row', () => {
      expect(isWorkingDay(sfa, d('2026-11-02'))).toBe(true); // Monday
      expect(isWorkingDay(sfa, d('2026-11-07'))).toBe(false); // Saturday
      expect(isWorkingDay(sfa, d('2026-11-08'))).toBe(false); // Sunday
    });

    it('closes on a holiday and a closure, whatever the workweek says', () => {
      expect(isWorkingDay(sfa, d('2026-11-26'))).toBe(false);
      expect(isWorkingDay(sfa, d('2026-11-03'))).toBe(false);
    });

    it('opens on a special working day, even a weekend', () => {
      expect(isWorkingDay(sfa, d('2026-12-12'))).toBe(true);
    });

    it('honours a four-day workweek', () => {
      const tueFri = snapshotFrom([2, 3, 4, 5], []);
      expect(isWorkingDay(tueFri, d('2026-11-02'))).toBe(false); // Monday
      expect(isWorkingDay(tueFri, d('2026-11-03'))).toBe(true);
    });
  });

  describe('workingDaysInMonth', () => {
    it('counts weekdays minus closures', () => {
      // November 2026 has 21 weekdays; two holidays and one closure.
      expect(workingDaysInMonth(sfa, 2026, 11)).toBe(18);
    });

    it('counts a special working day in', () => {
      // December 2026 has 23 weekdays, plus the Saturday the 12th.
      expect(workingDaysInMonth(sfa, 2026, 12)).toBe(24);
    });
  });

  describe('workingDaysBetween (inclusive)', () => {
    it('counts both ends and skips the closed days', () => {
      // Mon 23 → Mon 30 Nov: 23, 24, 25, 30 (26 + 27 are holidays).
      expect(workingDaysBetween(sfa, d('2026-11-23'), d('2026-11-30'))).toBe(4);
    });

    it('is zero when the range is inverted', () => {
      expect(workingDaysBetween(sfa, d('2026-11-30'), d('2026-11-23'))).toBe(0);
    });

    it('is unaffected by a DST change inside the range', () => {
      // US spring-forward on 2026-03-08 and fall-back on 2026-11-01.
      expect(workingDaysBetween(sfa, d('2026-03-02'), d('2026-03-13'))).toBe(
        10,
      );
      expect(workingDaysBetween(sfa, d('2026-10-26'), d('2026-11-06'))).toBe(
        9, // the 3rd is the closure
      );
    });
  });

  describe('addBusinessDays', () => {
    it('steps over a holiday pair', () => {
      // Wed 25 Nov + 1 → Mon 30 Nov.
      expect(toIsoDate(addBusinessDays(sfa, d('2026-11-25'), 1))).toBe(
        '2026-11-30',
      );
    });

    it('starting on a weekend, the first step is the next working day', () => {
      expect(toIsoDate(addBusinessDays(sfa, d('2026-11-07'), 1))).toBe(
        '2026-11-09',
      );
    });

    it('walks back', () => {
      expect(toIsoDate(addBusinessDays(sfa, d('2026-11-30'), -2))).toBe(
        '2026-11-24',
      );
    });

    it('zero is the identity', () => {
      expect(toIsoDate(addBusinessDays(sfa, d('2026-11-07'), 0))).toBe(
        '2026-11-07',
      );
    });
  });

  describe('scheduledDaysBetween', () => {
    // Mon / Wed / Fri mornings only.
    const partTime: WorkSchedule = {
      1: { start: '09:00', end: '13:00' },
      3: { start: '09:00', end: '13:00' },
      5: { start: '09:00', end: '13:00' },
    };

    it('overlays a partial schedule on the calendar', () => {
      // Mon 23 → Fri 27 Nov: Wed 25 works, Thu/Fri are holidays.
      const days = scheduledDaysBetween(
        sfa,
        partTime,
        d('2026-11-23'),
        d('2026-11-27'),
      );
      expect(
        days.map((day) => [day.date, day.scheduledMinutes, day.reason]),
      ).toEqual([
        ['2026-11-23', 240, 'scheduled'],
        ['2026-11-24', 0, 'not_scheduled'],
        ['2026-11-25', 240, 'scheduled'],
        ['2026-11-26', 0, 'holiday'],
        ['2026-11-27', 0, 'holiday'],
      ]);
      expect(days.filter((day) => day.working)).toHaveLength(3);
    });

    it('names a weekend and a closure', () => {
      const days = scheduledDaysBetween(
        sfa,
        partTime,
        d('2026-10-31'),
        d('2026-11-03'),
      );
      expect(days.map((day) => day.reason)).toEqual([
        'weekend',
        'weekend',
        'scheduled',
        'closure',
      ]);
    });

    it('gives a special working day the schedule for that weekday', () => {
      const saturdays: WorkSchedule = { 6: { start: '08:00', end: '12:00' } };
      const [day] = scheduledDaysBetween(
        sfa,
        saturdays,
        d('2026-12-12'),
        d('2026-12-12'),
      );
      expect(day).toEqual({
        date: '2026-12-12',
        working: true,
        scheduledMinutes: 240,
        reason: 'scheduled',
      });
    });

    it('treats a malformed or inverted shift as zero minutes', () => {
      const broken: WorkSchedule = {
        1: { start: '17:00', end: '09:00' },
        3: { start: '9am', end: '13:00' },
      };
      const days = scheduledDaysBetween(
        sfa,
        broken,
        d('2026-11-02'),
        d('2026-11-04'),
      );
      expect(days.map((day) => day.scheduledMinutes)).toEqual([0, 0, 0]);
    });
  });
});
