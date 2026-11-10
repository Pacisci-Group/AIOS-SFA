import {
  defaultTimeOffPolicyRules,
  isValidMonthDay,
  normalizeTimeOffPolicyRules,
  SUGGESTED_TIME_OFF_POLICIES,
  timeOffPolicyRulesError,
} from './time-off-policy';

const pto = () => ({ ...defaultTimeOffPolicyRules('pto'), hoursPerYear: 80 });

describe('time off policy rules (PAC-174)', () => {
  it('validates MM-DD against a real calendar', () => {
    expect(isValidMonthDay('01-01')).toBe(true);
    expect(isValidMonthDay('02-29')).toBe(true);
    expect(isValidMonthDay('02-30')).toBe(false);
    expect(isValidMonthDay('13-01')).toBe(false);
    expect(isValidMonthDay('1-1')).toBe(false);
  });

  it('nulls every accrual field on an unlimited policy', () => {
    const rules = normalizeTimeOffPolicyRules({
      ...pto(),
      accrualType: 'unlimited',
      maxBalanceHours: 10,
      carryoverCapHours: 5,
      payOutOnTermination: true,
    });
    expect(rules).toMatchObject({
      hoursPerYear: null,
      accrualFrequency: null,
      resetDateKind: null,
      resetMonthDay: null,
      maxBalanceHours: null,
      carryoverCapHours: null,
      annualUsageCapHours: null,
      payOutOnTermination: false,
    });
    expect(timeOffPolicyRulesError(rules)).toBeNull();
  });

  it('keeps Unpaid Time Off unpaid and drops what does not apply', () => {
    const rules = normalizeTimeOffPolicyRules({
      ...defaultTimeOffPolicyRules('unpaid'),
      compensation: 'paid',
      hoursPerYear: 40,
      annualUsageCapHours: 40,
      payOutOnTermination: true,
      resetDateKind: 'hire_anniversary',
      resetMonthDay: '01-01',
      carryoverCapHours: 8,
      autoApprove: { enabled: false, maxCalendarDays: 3, minNoticeHours: 48 },
      description: '  ',
    });
    expect(rules).toMatchObject({
      compensation: 'unpaid',
      payOutOnTermination: false,
      annualUsageCapHours: null,
      resetMonthDay: null,
      carryoverCapHours: null,
      description: null,
      autoApprove: { enabled: false, maxCalendarDays: null, minNoticeHours: null },
    });
  });

  it('refuses a paid Unpaid Time Off policy before normalisation', () => {
    expect(timeOffPolicyRulesError({ ...defaultTimeOffPolicyRules('unpaid'), compensation: 'paid', hoursPerYear: 1 }))
      .toMatch(/always unpaid/);
  });

  it('needs the hours, the frequency and the reset date on a fixed amount', () => {
    expect(timeOffPolicyRulesError({ ...pto(), hoursPerYear: null })).toMatch(/hours earned per year/);
    expect(timeOffPolicyRulesError({ ...pto(), hoursPerYear: 0 })).toMatch(/hours earned per year/);
    expect(timeOffPolicyRulesError({ ...pto(), accrualFrequency: null })).toMatch(/how often/);
    expect(timeOffPolicyRulesError({ ...pto(), resetMonthDay: '02-30' })).toMatch(/reset date/);
    expect(timeOffPolicyRulesError(pto())).toBeNull();
  });

  it('keeps the carryover cap under the max balance', () => {
    expect(timeOffPolicyRulesError({ ...pto(), maxBalanceHours: 100, carryoverCapHours: 120 }))
      .toMatch(/carryover cap/);
    expect(timeOffPolicyRulesError({ ...pto(), maxBalanceHours: 100, carryoverCapHours: 100 })).toBeNull();
  });

  it('wants at least one rule while auto-approval is on', () => {
    expect(
      timeOffPolicyRulesError({
        ...pto(),
        autoApprove: { enabled: true, maxCalendarDays: null, minNoticeHours: null },
      }),
    ).toMatch(/auto-approval/);
    expect(
      timeOffPolicyRulesError({
        ...pto(),
        autoApprove: { enabled: true, maxCalendarDays: 3, minNoticeHours: null },
      }),
    ).toBeNull();
  });

  it('ships three suggested policies that validate as they are', () => {
    expect(SUGGESTED_TIME_OFF_POLICIES.map((s) => s.key)).toEqual(['pto', 'sick', 'unpaid']);
    for (const suggested of SUGGESTED_TIME_OFF_POLICIES) {
      expect(timeOffPolicyRulesError(normalizeTimeOffPolicyRules(suggested.rules))).toBeNull();
    }
    expect(SUGGESTED_TIME_OFF_POLICIES[2].rules).toMatchObject({
      accrualType: 'unlimited',
      compensation: 'unpaid',
      hoursPerYear: null,
    });
  });
});
