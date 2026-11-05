import { defaultTimeOffPolicyRules } from './time-off-policy';
import { periodStartFor, projectLeave } from './time-off-projection';

const yearly = {
  ...defaultTimeOffPolicyRules('pto'),
  hoursPerYear: 80,
  carryoverCapHours: 40,
  maxBalanceHours: 120,
};
const monthly = {
  ...defaultTimeOffPolicyRules('pto'),
  hoursPerYear: 80,
  accrualFrequency: 'monthly' as const,
};
const anniversary = {
  ...defaultTimeOffPolicyRules('pto'),
  hoursPerYear: 80,
  resetDateKind: 'hire_anniversary' as const,
  resetMonthDay: null,
};
const sick = {
  ...defaultTimeOffPolicyRules('sick'),
  hoursPerYear: 40,
  annualUsageCapHours: 24,
};
const unlimited = { ...yearly, accrualType: 'unlimited' as const };

const base = {
  hireDate: null,
  today: '2026-11-05',
  usedThisPeriod: 0,
  otherLeave: {},
};

describe('periodStartFor (PAC-165)', () => {
  it('is the latest fixed reset on or before the day', () => {
    expect(periodStartFor(yearly, null, '2026-11-05')).toBe('2026-01-01');
    expect(periodStartFor(yearly, null, '2027-01-01')).toBe('2027-01-01');
    const july = { ...yearly, resetMonthDay: '07-01' };
    expect(periodStartFor(july, null, '2026-06-30')).toBe('2025-07-01');
    expect(periodStartFor(july, null, '2026-07-01')).toBe('2026-07-01');
  });

  it('is the latest hire anniversary, observed on 28 February without a 29th', () => {
    expect(periodStartFor(anniversary, '2022-03-15', '2026-11-05')).toBe('2026-03-15');
    expect(periodStartFor(anniversary, '2022-03-15', '2026-03-14')).toBe('2025-03-15');
    expect(periodStartFor(anniversary, '2024-02-29', '2027-03-01')).toBe('2027-02-28');
    expect(periodStartFor(anniversary, '2024-02-29', '2028-03-01')).toBe('2028-02-29');
  });

  it('has no start before the policy has ever reset for the person', () => {
    // No hire date: nobody resets until it is set.
    expect(periodStartFor(anniversary, null, '2026-11-05')).toBeNull();
    // First year of service: the first anniversary has not come.
    expect(periodStartFor(anniversary, '2026-03-15', '2026-11-05')).toBeNull();
    expect(periodStartFor(anniversary, '2026-03-15', '2027-03-14')).toBeNull();
    expect(periodStartFor(anniversary, '2026-03-15', '2027-03-15')).toBe('2027-03-15');
    expect(periodStartFor(unlimited, null, '2026-11-05')).toBeNull();
  });
});

describe('projectLeave (PAC-165)', () => {
  it('equals today’s remaining balance when nothing accrues before the leave', () => {
    const projection = projectLeave({
      ...base,
      rules: yearly,
      currentBalance: 40,
      otherLeave: { '2026-12-01': 8 },
      requestLeave: { '2026-11-16': 8, '2026-11-17': 8 },
    });
    expect(projection).toEqual({
      lowestBalance: 16,
      lowestOn: '2026-12-01',
      crossesAccrual: false,
      capExceededBy: 0,
    });
  });

  it('goes below zero when later approved leave already needs the hours', () => {
    // 40 h now, 40 h of approved leave in December: a day in November would
    // leave December short, even though November itself looks affordable.
    const projection = projectLeave({
      ...base,
      rules: yearly,
      currentBalance: 40,
      otherLeave: {
        '2026-12-21': 8,
        '2026-12-22': 8,
        '2026-12-23': 8,
        '2026-12-24': 8,
        '2026-12-28': 8,
      },
      requestLeave: { '2026-11-16': 8 },
    });
    expect(projection.lowestBalance).toBe(-8);
    expect(projection.lowestOn).toBe('2026-12-28');
  });

  it('covers a request spanning the reset from the new period’s grant', () => {
    // 8 h left in November; one day in December and four in January.
    const projection = projectLeave({
      ...base,
      rules: yearly,
      currentBalance: 8,
      requestLeave: {
        '2026-12-31': 8,
        '2027-01-04': 8,
        '2027-01-05': 8,
        '2027-01-06': 8,
        '2027-01-07': 8,
      },
    });
    // 31 Dec: 8 − 8 = 0. 1 Jan: carryover min(0, 40) = 0, grant 80. Then 4 × 8.
    expect(projection.lowestBalance).toBe(0);
    expect(projection.lowestOn).toBe('2026-12-31');
    expect(projection.crossesAccrual).toBe(true);
  });

  it('judges the days before the reset against this period only', () => {
    const projection = projectLeave({
      ...base,
      rules: yearly,
      currentBalance: 8,
      requestLeave: { '2026-12-30': 8, '2026-12-31': 8, '2027-01-04': 8 },
    });
    // The second December day is not covered by January's grant.
    expect(projection.lowestBalance).toBe(-8);
    expect(projection.lowestOn).toBe('2026-12-31');
  });

  it('applies the carryover cap and the max balance at the reset, as the job does', () => {
    // 100 h now, cap 40, max 120: 1 Jan → carry 40, grant min(80, 120 − 40) = 80 → 120.
    const projection = projectLeave({
      ...base,
      rules: yearly,
      currentBalance: 100,
      requestLeave: { '2027-01-04': 120 },
    });
    expect(projection.lowestBalance).toBe(0);
    // No cap on carryover: 100 carries, the grant is clipped to 20 by the max.
    const uncapped = projectLeave({
      ...base,
      rules: { ...yearly, carryoverCapHours: null },
      currentBalance: 100,
      requestLeave: { '2027-01-04': 120 },
    });
    expect(uncapped.lowestBalance).toBe(0);
    // A negative balance carries over negative and the grant lands on top.
    const negative = projectLeave({
      ...base,
      rules: yearly,
      currentBalance: -10,
      requestLeave: { '2027-01-04': 8 },
    });
    expect(negative.lowestBalance).toBe(62);
  });

  it('counts every monthly twelfth up to the leave day', () => {
    // 10 h in November on 80 h a year: 6.67 on 1 Dec, 1 Jan (after the reset
    // carries everything — no cap), 1 Feb, 1 Mar → 36.68 by a day in March.
    const projection = projectLeave({
      ...base,
      rules: monthly,
      currentBalance: 10,
      requestLeave: { '2027-03-02': 32 },
    });
    expect(projection.lowestBalance).toBe(4.68);
    expect(projection.crossesAccrual).toBe(true);
    // The same request a month earlier is one twelfth short.
    const early = projectLeave({
      ...base,
      rules: monthly,
      currentBalance: 10,
      requestLeave: { '2027-02-02': 32 },
    });
    expect(early.lowestBalance).toBe(-1.99);
  });

  it('resets on the hire anniversary, and never without a hire date', () => {
    const rules = { ...anniversary, carryoverCapHours: null };
    const withDate = projectLeave({
      ...base,
      rules,
      hireDate: '2022-12-01',
      currentBalance: 0,
      requestLeave: { '2026-12-02': 40 },
    });
    expect(withDate.lowestBalance).toBe(40);
    const without = projectLeave({
      ...base,
      rules,
      hireDate: null,
      currentBalance: 0,
      requestLeave: { '2026-12-02': 40 },
    });
    expect(without.lowestBalance).toBe(-40);
    expect(without.crossesAccrual).toBe(false);
  });

  it('takes a recorded day in the past straight off today’s balance', () => {
    const projection = projectLeave({
      ...base,
      rules: yearly,
      currentBalance: 4,
      requestLeave: { '2026-11-03': 8 },
    });
    expect(projection).toMatchObject({ lowestBalance: -4, lowestOn: '2026-11-05' });
  });

  it('measures the yearly usage cap per period', () => {
    // 16 h used this year, cap 24: 8 more fit, 16 more are 8 over.
    const within = projectLeave({
      ...base,
      rules: sick,
      currentBalance: 24,
      usedThisPeriod: 16,
      requestLeave: { '2026-11-10': 8 },
    });
    expect(within.capExceededBy).toBe(0);
    const over = projectLeave({
      ...base,
      rules: sick,
      currentBalance: 24,
      usedThisPeriod: 16,
      requestLeave: { '2026-11-10': 8, '2026-11-11': 8 },
    });
    expect(over.capExceededBy).toBe(8);
    // Other waiting leave in the same period counts toward the cap too.
    const withOther = projectLeave({
      ...base,
      rules: sick,
      currentBalance: 24,
      usedThisPeriod: 16,
      otherLeave: { '2026-11-20': 8 },
      requestLeave: { '2026-11-10': 8 },
    });
    expect(withOther.capExceededBy).toBe(8);
  });

  it('starts the usage count again after the reset', () => {
    // 24 h used this year (at the cap); January's days are a new year.
    const projection = projectLeave({
      ...base,
      rules: sick,
      currentBalance: 16,
      usedThisPeriod: 24,
      requestLeave: { '2027-01-04': 8, '2027-01-05': 8 },
    });
    expect(projection.capExceededBy).toBe(0);
    // A request on both sides is judged in each: one December day is over.
    const spanning = projectLeave({
      ...base,
      rules: sick,
      currentBalance: 16,
      usedThisPeriod: 24,
      requestLeave: { '2026-12-31': 8, '2027-01-04': 8 },
    });
    expect(spanning.capExceededBy).toBe(8);
  });

  it('ignores a period the request does not touch', () => {
    // The person's other leave is over the cap next year; a request this
    // year is not blamed for it.
    const projection = projectLeave({
      ...base,
      rules: sick,
      currentBalance: 24,
      usedThisPeriod: 0,
      otherLeave: { '2027-01-04': 8, '2027-01-05': 8, '2027-01-06': 8, '2027-01-07': 8 },
      requestLeave: { '2026-11-10': 8 },
    });
    expect(projection.capExceededBy).toBe(0);
  });
});
