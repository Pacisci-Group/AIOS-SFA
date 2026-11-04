import { defaultTimeOffPolicyRules } from '@sfa/shared';
import { createHrPolicySchema, updateHrPolicySchema } from './hr-policy.dto';

const userId = 'a'.repeat(24);

const body = (
  timeOff: Record<string, unknown> = {},
  rest: Record<string, unknown> = {},
) => ({
  type: 'time_off',
  name: 'Paid time off',
  timeOff: {
    ...defaultTimeOffPolicyRules('pto'),
    hoursPerYear: 80,
    ...timeOff,
  },
  memberIds: [userId],
  ...rest,
});

const firstMessage = (
  result: ReturnType<typeof createHrPolicySchema.safeParse>,
) => (result.success ? null : result.error.issues[0]?.message);

describe('createHrPolicySchema — time off (PAC-174)', () => {
  it('accepts a yearly PTO policy and normalises what the model nulls', () => {
    const parsed = createHrPolicySchema.parse(
      body({
        resetDateKind: 'hire_anniversary',
        resetMonthDay: '01-01',
        carryoverCapHours: 8,
      }),
    );
    if (parsed.type !== 'time_off') throw new Error('type');
    expect(parsed.timeOff).toMatchObject({
      resetMonthDay: null,
      carryoverCapHours: null,
      annualUsageCapHours: null,
    });
  });

  it.each([
    ['hours worked', { accrualType: 'hours_worked' }],
    ['per pay period', { accrualFrequency: 'per_pay_period' }],
    ['an accrual rate', { accrualRate: 4 }],
    ['an accrual waiting period', { accrualWaitingPeriodDays: 30 }],
  ])('refuses the reserved %s as not available yet', (_label, timeOff) => {
    const result = createHrPolicySchema.safeParse(body(timeOff));
    expect(result.success).toBe(false);
    expect(firstMessage(result)).toBe('That option is not available yet.');
  });

  it('refuses a paid Unpaid Time Off policy rather than correcting it', () => {
    const result = createHrPolicySchema.safeParse(
      body({ timeOffType: 'unpaid', compensation: 'paid' }),
    );
    expect(result.success).toBe(false);
    expect(firstMessage(result)).toMatch(/always unpaid/);
  });

  it('rounds hours to two decimals and refuses a bad reset date', () => {
    const parsed = createHrPolicySchema.parse(
      body({ hoursPerYear: 80.004, maxBalanceHours: 120.555 }),
    );
    if (parsed.type !== 'time_off') throw new Error('type');
    expect(parsed.timeOff.hoursPerYear).toBe(80);
    expect(parsed.timeOff.maxBalanceHours).toBe(120.56);
    expect(
      createHrPolicySchema.safeParse(body({ resetMonthDay: '02-30' })).success,
    ).toBe(false);
  });

  it('takes starting balances keyed by user id, never negative', () => {
    const ok = createHrPolicySchema.parse(
      body({}, { startingBalanceHours: { [userId]: 12.5 } }),
    );
    if (ok.type !== 'time_off') throw new Error('type');
    expect(ok.startingBalanceHours).toEqual({ [userId]: 12.5 });
    expect(
      createHrPolicySchema.safeParse(
        body({}, { startingBalanceHours: { [userId]: -1 } }),
      ).success,
    ).toBe(false);
    expect(
      createHrPolicySchema.safeParse(
        body({}, { startingBalanceHours: { nope: 1 } }),
      ).success,
    ).toBe(false);
  });
});

describe('updateHrPolicySchema — time off (PAC-174)', () => {
  it('accepts a partial rule set', () => {
    const parsed = updateHrPolicySchema.parse({
      timeOff: { hoursPerYear: 96 },
    });
    expect(parsed.timeOff).toEqual({ hoursPerYear: 96 });
  });

  it('wants the member list with starting balances', () => {
    expect(
      updateHrPolicySchema.safeParse({ startingBalanceHours: { [userId]: 8 } })
        .success,
    ).toBe(false);
    expect(
      updateHrPolicySchema.safeParse({
        memberIds: [userId],
        startingBalanceHours: { [userId]: 8 },
      }).success,
    ).toBe(true);
  });
});
