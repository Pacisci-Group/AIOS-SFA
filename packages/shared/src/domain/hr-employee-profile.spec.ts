import {
  diffRules,
  overridePaths,
  scheduleFromWorkweek,
  shiftMinutes,
  weeklyMinutes,
} from './hr-employee-profile';
import { DEFAULT_LEAVE_POLICY_RULES, type LeavePolicyRules } from './hr-leave-policy';

/**
 * `diffRules` is the inverse of the API's `mergeRules` (PAC-162): what the
 * web sends as overrides. The merge itself is unit-tested beside it in
 * `packages/api/src/common/hr/`; here, that the diff names exactly the paths
 * that changed, arrays whole, and nothing else.
 */
describe('diffRules (PAC-162)', () => {
  const template = DEFAULT_LEAVE_POLICY_RULES;

  it('is empty when nothing differs, including a structurally equal copy', () => {
    expect(diffRules(template, structuredClone(template))).toEqual({});
  });

  it('names a changed scalar by its nested path only', () => {
    const edited = structuredClone(template) as LeavePolicyRules;
    edited.pto.annualAllocationHours = 120;
    expect(diffRules(template, edited)).toEqual({
      pto: { annualAllocationHours: 120 },
    });
  });

  it('replaces an array whole, never element by element', () => {
    const edited = structuredClone(template) as LeavePolicyRules;
    edited.points.ladders.tardy = [1, 2, 3, 4, 5];
    expect(diffRules(template, edited)).toEqual({
      points: { ladders: { tardy: [1, 2, 3, 4, 5] } },
    });
  });

  it('ignores keys the template does not have', () => {
    const edited = {
      ...structuredClone(template),
      somethingNew: true,
    } as unknown as LeavePolicyRules;
    expect(diffRules(template, edited)).toEqual({});
  });

  it('round-trips with overridePaths', () => {
    const edited = structuredClone(template) as LeavePolicyRules;
    edited.pto.carryover = { mode: 'capped', capHours: 40, expiryDays: null };
    edited.attendance.tardyGraceMinutes = 10;
    const diff = diffRules(template, edited);
    expect(overridePaths(diff)).toEqual([
      'pto.carryover.mode',
      'pto.carryover.capHours',
      'attendance.tardyGraceMinutes',
    ]);
  });
});

describe('schedules (PAC-162)', () => {
  it('builds a 9-to-5 week from the workweek', () => {
    const schedule = scheduleFromWorkweek([1, 2, 3, 4, 5]);
    expect(Object.keys(schedule)).toEqual(['1', '2', '3', '4', '5']);
    expect(schedule[1]).toEqual({ start: '09:00', end: '17:00' });
    expect(weeklyMinutes(schedule)).toBe(5 * 8 * 60);
  });

  it('counts zero for a malformed or inverted shift', () => {
    expect(shiftMinutes({ start: '17:00', end: '09:00' })).toBe(0);
    expect(shiftMinutes({ start: '9am', end: '17:00' })).toBe(0);
    expect(shiftMinutes(null)).toBe(0);
  });
});
