import {
  accrualPeriodKey,
  anniversaryMonthDay,
  cappedAllocation,
  defaultStartingBalance,
  monthlyAccrualDue,
  monthlyAccrualHours,
  resetDueOn,
  resetPeriodKey,
  resetRows,
  roundHours,
} from './time-off-accrual';
import { defaultTimeOffPolicyRules } from './time-off-policy';

const fixedJan1 = { ...defaultTimeOffPolicyRules('pto'), hoursPerYear: 80 };
const anniversary = { ...fixedJan1, resetDateKind: 'hire_anniversary' as const, resetMonthDay: null };
const unlimited = { ...fixedJan1, accrualType: 'unlimited' as const };

describe('time off accrual maths (PAC-174)', () => {
  it('posts a full twelfth to two decimals', () => {
    expect(monthlyAccrualHours(80)).toBe(6.67);
    expect(monthlyAccrualHours(100)).toBe(8.33);
    expect(monthlyAccrualHours(120)).toBe(10);
    expect(roundHours(1.005)).toBe(1.01);
  });

  it('clips an accrual at the max balance and never goes negative', () => {
    expect(cappedAllocation(6.67, 118, 120)).toBe(2);
    expect(cappedAllocation(6.67, 120, 120)).toBe(0);
    expect(cappedAllocation(6.67, 130, 120)).toBe(0);
    expect(cappedAllocation(6.67, 118, null)).toBe(6.67);
  });

  it('is due on the first of the month only', () => {
    expect(monthlyAccrualDue('2027-03-01')).toBe(true);
    expect(monthlyAccrualDue('2027-03-02')).toBe(false);
  });

  it('resets everyone on the fixed date', () => {
    expect(resetDueOn(fixedJan1, null, '2027-01-01')).toBe(true);
    expect(resetDueOn(fixedJan1, '2020-06-15', '2027-01-02')).toBe(false);
  });

  it('resets on the hire anniversary once the person has a hire date and a year in', () => {
    expect(resetDueOn(anniversary, '2024-06-15', '2027-06-15')).toBe(true);
    expect(resetDueOn(anniversary, '2024-06-15', '2027-06-14')).toBe(false);
    expect(resetDueOn(anniversary, null, '2027-06-15')).toBe(false);
    // Hired this year: the first anniversary is next year.
    expect(resetDueOn(anniversary, '2027-06-15', '2027-06-15')).toBe(false);
  });

  it('observes a 29 February anniversary on 28 February in a common year', () => {
    expect(anniversaryMonthDay('2024-02-29', 2027)).toBe('02-28');
    expect(anniversaryMonthDay('2024-02-29', 2028)).toBe('02-29');
    expect(resetDueOn(anniversary, '2024-02-29', '2027-02-28')).toBe(true);
    expect(resetDueOn(anniversary, '2024-02-29', '2028-02-29')).toBe(true);
    expect(resetDueOn(anniversary, '2024-02-29', '2028-02-28')).toBe(false);
  });

  it('never resets an unlimited policy', () => {
    expect(resetDueOn(unlimited, '2020-01-01', '2027-01-01')).toBe(false);
  });

  it('closes and reopens the period, keeping what the carryover cap allows', () => {
    expect(resetRows(50, 40)).toEqual({ expiration: -50, carryover: 40 });
    expect(resetRows(50, null)).toEqual({ expiration: -50, carryover: 50 });
    expect(resetRows(50, 0)).toEqual({ expiration: -50, carryover: 0 });
    expect(resetRows(30, 40)).toEqual({ expiration: -30, carryover: 30 });
    // A negative balance carries over negative — no floor.
    expect(resetRows(-10, 40)).toEqual({ expiration: 10, carryover: -10 });
    expect(resetRows(0, 40)).toEqual({ expiration: 0, carryover: 0 });
  });

  it('keys monthly grants by month and the rest by day', () => {
    expect(accrualPeriodKey('monthly', '2027-03-01')).toBe('accrual:2027-03');
    expect(accrualPeriodKey('yearly', '2027-01-01')).toBe('accrual:2027-01-01');
    expect(resetPeriodKey('2027-01-01')).toBe('reset:2027-01-01');
  });

  it('defaults the starting balance to the yearly total, else zero, none on unlimited', () => {
    expect(defaultStartingBalance(fixedJan1)).toBe(80);
    expect(defaultStartingBalance({ ...fixedJan1, accrualFrequency: 'monthly' })).toBe(0);
    expect(defaultStartingBalance(unlimited)).toBeNull();
  });
});
