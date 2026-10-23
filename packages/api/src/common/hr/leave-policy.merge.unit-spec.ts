import { DEFAULT_LEAVE_POLICY_RULES } from '@sfa/shared';
import { mergeRules } from './leave-policy.merge';

describe('mergeRules (PAC-161)', () => {
  it('returns a copy of the template with no overrides', () => {
    for (const overrides of [null, undefined, {}]) {
      const merged = mergeRules(DEFAULT_LEAVE_POLICY_RULES, overrides);
      expect(merged.rules).toEqual(DEFAULT_LEAVE_POLICY_RULES);
      expect(merged.rules).not.toBe(DEFAULT_LEAVE_POLICY_RULES);
      expect(merged.overriddenPaths).toEqual([]);
    }
  });

  it('overrides a scalar and names its path', () => {
    const merged = mergeRules(DEFAULT_LEAVE_POLICY_RULES, {
      pto: { annualAllocationHours: 120 },
    });
    expect(merged.rules.pto.annualAllocationHours).toBe(120);
    expect(merged.rules.pto.resetBasis).toBe('calendar_year');
    expect(merged.overriddenPaths).toEqual(['pto.annualAllocationHours']);
  });

  it('overrides a nested object field by field', () => {
    const merged = mergeRules(DEFAULT_LEAVE_POLICY_RULES, {
      pto: { carryover: { mode: 'capped', capHours: 40 } },
    });
    expect(merged.rules.pto.carryover).toEqual({
      mode: 'capped',
      capHours: 40,
      expiryDays: null,
    });
    expect(merged.overriddenPaths).toEqual([
      'pto.carryover.mode',
      'pto.carryover.capHours',
    ]);
  });

  it('replaces an array whole', () => {
    const merged = mergeRules(DEFAULT_LEAVE_POLICY_RULES, {
      points: { ladders: { tardy: [2] } },
    });
    expect(merged.rules.points.ladders.tardy).toEqual([2]);
    expect(merged.rules.points.ladders.absence).toEqual([2, 3, 4]);
    expect(merged.overriddenPaths).toEqual(['points.ladders.tardy']);
  });

  it('ignores a path the template does not know', () => {
    const merged = mergeRules(DEFAULT_LEAVE_POLICY_RULES, {
      pto: { salary: 1 },
    } as never);
    expect(merged.rules).toEqual(DEFAULT_LEAVE_POLICY_RULES);
    expect(merged.overriddenPaths).toEqual([]);
  });

  it('does not mutate the template', () => {
    const template = structuredClone(DEFAULT_LEAVE_POLICY_RULES);
    const merged = mergeRules(template, {
      attendance: { tardyGraceMinutes: 1 },
    });
    merged.rules.reasons.timeOff.push('Mutated');
    expect(template).toEqual(DEFAULT_LEAVE_POLICY_RULES);
  });
});
