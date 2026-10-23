import { BadRequestException } from '@nestjs/common';
import { DEFAULT_LEAVE_POLICY_RULES } from '@sfa/shared';
import {
  assertDateOfBirth,
  assertEffectiveFrom,
  effectiveAllocations,
  monthDayOf,
  validateAllocations,
  validateSchedule,
} from './employee-profile.rules';

describe('employee profile rules (PAC-162)', () => {
  const today = '2026-10-23';

  it('derives the anniversary from a hire date', () => {
    expect(monthDayOf('2024-03-15')).toBe('03-15');
  });

  describe('assertEffectiveFrom', () => {
    const bounds = { today, hireDate: '2026-01-10', previous: '2026-06-01' };

    it('accepts today, the previous entry day, and a day between', () => {
      expect(() => assertEffectiveFrom(today, bounds)).not.toThrow();
      expect(() => assertEffectiveFrom('2026-06-01', bounds)).not.toThrow();
      expect(() => assertEffectiveFrom('2026-08-01', bounds)).not.toThrow();
    });

    it('refuses the future, before hire, before the previous entry, and junk', () => {
      expect(() => assertEffectiveFrom('2026-10-24', bounds)).toThrow(
        BadRequestException,
      );
      expect(() => assertEffectiveFrom('2026-01-09', bounds)).toThrow(
        /before the hire date/,
      );
      expect(() => assertEffectiveFrom('2026-05-31', bounds)).toThrow(
        /before the previous change/,
      );
      expect(() => assertEffectiveFrom('2026-02-31', bounds)).toThrow(
        /real date/,
      );
    });
  });

  describe('assertDateOfBirth', () => {
    it('accepts a past day within 120 years and refuses the rest', () => {
      expect(() => assertDateOfBirth('1990-05-05', today)).not.toThrow();
      expect(() => assertDateOfBirth(today, today)).toThrow(/in the past/);
      expect(() => assertDateOfBirth('1900-01-01', today)).toThrow(/120 years/);
    });
  });

  describe('validateSchedule', () => {
    it('accepts a null day and a real shift', () => {
      expect(
        validateSchedule({ 1: { start: '09:00', end: '17:00' }, 6: null }),
      ).toEqual([]);
    });

    it('names a bad weekday, a bad clock and an inverted shift', () => {
      const problems = validateSchedule({
        7: { start: '09:00', end: '17:00' },
        1: { start: '9am', end: '17:00' },
        2: { start: '17:00', end: '09:00' },
      } as never);
      // Numeric keys iterate in ascending order whatever the literal says.
      expect(problems).toHaveLength(3);
      expect(problems.join(' ')).toMatch(/not a weekday/);
      expect(problems.join(' ')).toMatch(/HH:mm/);
      expect(problems.join(' ')).toMatch(/after the start/);
    });
  });

  describe('allocations', () => {
    const rules = DEFAULT_LEAVE_POLICY_RULES;

    it('accepts hours on a balance-bearing type and refuses the rest', () => {
      expect(validateAllocations({ paid: 120 }, rules)).toEqual([]);
      expect(validateAllocations({ unpaid: 10 }, rules)[0]).toMatch(
        /does not draw|not an active/,
      );
      expect(validateAllocations({ paid: -1 }, rules)[0]).toMatch(
        /zero or more/,
      );
      expect(validateAllocations({ paid: 9000 }, rules)[0]).toMatch(/8760/);
    });

    it('fills every balance-bearing type from the policy default', () => {
      expect(effectiveAllocations(rules, {})).toEqual({ paid: 80 });
      expect(effectiveAllocations(rules, { paid: 120 })).toEqual({
        paid: 120,
      });
    });
  });
});
