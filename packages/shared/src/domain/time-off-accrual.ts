import type { TimeOffPolicyRules } from './time-off-policy';

/**
 * Accrual and reset arithmetic for fixed-amount time off policies (PAC-174).
 *
 * Pure and calendar-only: every date is a `YYYY-MM-DD` on the agency's
 * calendar, decided by the caller (the worker asks `agencyTodayIso`, a test
 * passes a literal). Nothing here knows about time zones, Mongo or the
 * ledger — the job in `packages/api` turns these answers into rows.
 *
 * Decided 2026-11-04 (ticket): **Monthly** posts the full twelfth on the
 * 1st, whatever day the person joined, `hoursPerYear / 12` to two decimals;
 * **Yearly** posts the whole total on the reset date; a mid-year joiner on a
 * fixed-date Yearly policy starts with the full total (the starting balance
 * default, not this module); no negative-balance floor.
 */

/** A `YYYY-MM-DD` calendar date. */
type IsoDate = string;

/** Hours are kept to two decimals everywhere. */
export function roundHours(hours: number): number {
  // `|| 0` turns a `-0` (rounding `-0.001`, negating `0`) into a plain zero.
  return Math.round((hours + Number.EPSILON) * 100) / 100 || 0;
}

/** The full twelfth posted on the 1st. */
export function monthlyAccrualHours(hoursPerYear: number): number {
  return roundHours(hoursPerYear / 12);
}

/**
 * How much of an accrual fits under the max balance. The whole amount when
 * there is no cap; never negative, so a balance already over the cap (a
 * manual adjustment, a lowered cap) accrues nothing rather than losing hours.
 */
export function cappedAllocation(
  hours: number,
  balance: number,
  maxBalanceHours: number | null,
): number {
  if (maxBalanceHours === null) return roundHours(hours);
  return roundHours(Math.max(0, Math.min(hours, maxBalanceHours - balance)));
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * The `MM-DD` a hire anniversary falls on in `year`: the hire date's month
 * and day, except a 29 February anniversary observed on 28 February when the
 * year has none (the custom-holiday convention).
 */
export function anniversaryMonthDay(hireDate: IsoDate, year: number): string {
  const monthDay = hireDate.slice(5, 10);
  if (monthDay === '02-29' && !isLeapYear(year)) return '02-28';
  return monthDay;
}

/** Monthly accrual is due on the first of the month. */
export function monthlyAccrualDue(today: IsoDate): boolean {
  return today.slice(8, 10) === '01';
}

/**
 * Whether `today` is this person's reset day on the policy. A fixed date
 * is the same for everyone; a hire anniversary needs the person's hire date
 * (nobody resets until it is set — decided) and at least one full year of
 * service. Unlimited policies never reset.
 */
export function resetDueOn(
  policy: Pick<TimeOffPolicyRules, 'accrualType' | 'resetDateKind' | 'resetMonthDay'>,
  hireDate: IsoDate | null,
  today: IsoDate,
): boolean {
  if (policy.accrualType !== 'fixed_amount') return false;
  const monthDay = today.slice(5, 10);
  if (policy.resetDateKind === 'fixed') return policy.resetMonthDay === monthDay;
  if (policy.resetDateKind === 'hire_anniversary') {
    if (!hireDate) return false;
    const year = Number(today.slice(0, 4));
    if (Number(hireDate.slice(0, 4)) >= year) return false;
    return anniversaryMonthDay(hireDate, year) === monthDay;
  }
  return false;
}

export interface ResetRows {
  /** Closes the period: minus the whole balance. */
  expiration: number;
  /** Reopens it: what the cap keeps. A negative balance carries over negative. */
  carryover: number;
}

/**
 * The pair of rows a reset writes. They net to the hours lost to the cap —
 * zero when nothing is lost — and keep each period's rows summing to that
 * period's balance, which is what PAC-165's per-period usage needs.
 */
export function resetRows(balance: number, carryoverCapHours: number | null): ResetRows {
  const kept = carryoverCapHours === null ? balance : Math.min(balance, carryoverCapHours);
  return { expiration: roundHours(-balance), carryover: roundHours(kept) };
}

/** The idempotency key of a monthly or yearly grant. */
export function accrualPeriodKey(
  frequency: 'monthly' | 'yearly',
  today: IsoDate,
): string {
  return frequency === 'monthly' ? `accrual:${today.slice(0, 7)}` : `accrual:${today}`;
}

/** The idempotency key of a reset's rows. */
export function resetPeriodKey(today: IsoDate): string {
  return `reset:${today}`;
}

/**
 * The starting balance a new member gets when the admin sets none: the
 * whole yearly total on a Yearly policy (a mid-year joiner too — decided),
 * nothing otherwise, and no row at all on Unlimited (`null`).
 */
export function defaultStartingBalance(
  policy: Pick<TimeOffPolicyRules, 'accrualType' | 'accrualFrequency' | 'hoursPerYear'>,
): number | null {
  if (policy.accrualType === 'unlimited') return null;
  if (policy.accrualType === 'fixed_amount' && policy.accrualFrequency === 'yearly') {
    return roundHours(policy.hoursPerYear ?? 0);
  }
  return 0;
}
