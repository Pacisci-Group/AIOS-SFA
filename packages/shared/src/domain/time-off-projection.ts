import {
  anniversaryMonthDay,
  cappedAllocation,
  isLeapYear,
  monthlyAccrualDue,
  monthlyAccrualHours,
  resetDueOn,
  resetRows,
  roundHours,
} from './time-off-accrual';
import type { TimeOffPolicyRules } from './time-off-policy';

/**
 * Looking ahead on a fixed-amount time off policy (PAC-165).
 *
 * A request for January, made in November, cannot be judged against
 * November's balance: the policy grants new hours on its reset date, and a
 * monthly policy earns a twelfth on every 1st in between. Decided 2026-11-05
 * (Asad): the "not below zero" check **projects** the balance, counting
 * **every scheduled accrual up to each leave day** — one rule, "will the
 * person have the hours on that day?".
 *
 * {@link projectLeave} is that walk. It is built from the very functions the
 * accrual job posts rows with (`resetDueOn`, `resetRows`, `cappedAllocation`,
 * `monthlyAccrualDue`), in the job's order, so the projection and the ledger
 * agree by construction rather than by a second copy of the rules.
 *
 * It is an **estimate**: a policy edited tomorrow, or a day the worker never
 * ran, changes the real rows. It decides whether a request may be *sent*;
 * nothing is ever posted from it.
 */

/** A `YYYY-MM-DD` calendar date. */
type IsoDate = string;

type PeriodRules = Pick<
  TimeOffPolicyRules,
  'accrualType' | 'resetDateKind' | 'resetMonthDay'
>;

const DAY_MS = 86_400_000;

function nextDay(date: IsoDate): IsoDate {
  return new Date(Date.parse(`${date}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
}

/** `MM-DD` in `year`, with 29 February observed on the 28th when there is none. */
function monthDayIn(monthDay: string, year: number): IsoDate {
  const observed = monthDay === '02-29' && !isLeapYear(year) ? '02-28' : monthDay;
  return `${year}-${observed}`;
}

/**
 * The first day of the period `day` falls in — the most recent reset on or
 * before it — or `null` when the policy has never reset for this person:
 * an Unlimited policy, a hire-anniversary reset with no hire date, or one
 * whose first anniversary has not come. With no start, all usage counts and
 * no day is in a closed period.
 */
export function periodStartFor(
  rules: PeriodRules,
  hireDate: IsoDate | null,
  day: IsoDate,
): IsoDate | null {
  if (rules.accrualType !== 'fixed_amount') return null;
  const year = Number(day.slice(0, 4));
  if (rules.resetDateKind === 'fixed') {
    if (!rules.resetMonthDay) return null;
    const thisYear = monthDayIn(rules.resetMonthDay, year);
    return thisYear <= day ? thisYear : monthDayIn(rules.resetMonthDay, year - 1);
  }
  if (rules.resetDateKind === 'hire_anniversary') {
    if (!hireDate) return null;
    const hireYear = Number(hireDate.slice(0, 4));
    for (const candidate of [year, year - 1]) {
      // The job resets only after a full year of service.
      if (candidate <= hireYear) continue;
      const start = `${candidate}-${anniversaryMonthDay(hireDate, candidate)}`;
      if (start <= day) return start;
    }
  }
  return null;
}

export interface LeaveProjectionInput {
  rules: Pick<
    TimeOffPolicyRules,
    | 'accrualType'
    | 'accrualFrequency'
    | 'resetDateKind'
    | 'resetMonthDay'
    | 'hoursPerYear'
    | 'maxBalanceHours'
    | 'carryoverCapHours'
    | 'annualUsageCapHours'
  >;
  hireDate: IsoDate | null;
  /** Today on the agency's calendar. */
  today: IsoDate;
  /** The ledger balance through the end of today. */
  currentBalance: number;
  /** Hours already used in the period today falls in (a positive number). */
  usedThisPeriod: number;
  /**
   * The person's other leave on this policy that is not in `currentBalance`
   * yet: approved leave after today and requests still waiting, by date.
   */
  otherLeave: Readonly<Record<string, number>>;
  /** The request being judged, by date. */
  requestLeave: Readonly<Record<string, number>>;
}

export interface LeaveProjection {
  /**
   * The lowest the balance gets from this request's first day to the last
   * known leave day. Below zero means the request cannot be covered.
   */
  lowestBalance: number;
  lowestOn: IsoDate | null;
  /** An accrual or a reset falls inside the walk — the projection differs from today's numbers. */
  crossesAccrual: boolean;
  /** Hours over the yearly usage cap in the worst period this request touches; 0 when within it. */
  capExceededBy: number;
}

/**
 * Walk the balance forward, day by day, from today to the last known leave
 * day. Per day, in the accrual job's order: the reset (the period closes
 * through the carryover cap, a Yearly policy grants its total), the monthly
 * twelfth, then that day's leave.
 *
 * Leave dated today or earlier — a recorded sick day, a request starting
 * today — is taken off before the walk starts: it posts in the past.
 */
export function projectLeave(input: LeaveProjectionInput): LeaveProjection {
  const { rules, hireDate, today } = input;
  const requestDates = Object.keys(input.requestLeave).sort();
  const otherDates = Object.keys(input.otherLeave).sort();
  const firstRequestDay = requestDates[0] ?? null;
  const lastKnownDay = [...requestDates, ...otherDates, today].sort().pop() as IsoDate;
  const cap = rules.annualUsageCapHours;

  let balance = input.currentBalance;
  let usedInPeriod = input.usedThisPeriod;
  let periodTouched = false;
  let capExceededBy = 0;
  let crossesAccrual = false;
  let lowestBalance = Number.POSITIVE_INFINITY;
  let lowestOn: IsoDate | null = null;

  const take = (date: IsoDate): void => {
    const mine = input.requestLeave[date] ?? 0;
    const hours = mine + (input.otherLeave[date] ?? 0);
    if (hours) {
      balance = roundHours(balance - hours);
      usedInPeriod = roundHours(usedInPeriod + hours);
    }
    if (mine > 0) periodTouched = true;
  };
  const closePeriod = (): void => {
    if (cap !== null && periodTouched) {
      capExceededBy = Math.max(capExceededBy, roundHours(usedInPeriod - cap));
    }
    usedInPeriod = 0;
    periodTouched = false;
  };
  const observe = (date: IsoDate): void => {
    if (!firstRequestDay || date < firstRequestDay) return;
    if (balance < lowestBalance) {
      lowestBalance = balance;
      lowestOn = date;
    }
  };

  for (const date of [...new Set([...requestDates, ...otherDates])].sort()) {
    if (date <= today) take(date);
  }
  if (firstRequestDay && firstRequestDay <= today) observe(today);

  const accrues = rules.accrualType === 'fixed_amount' && Boolean(rules.hoursPerYear);
  for (let date = nextDay(today); date <= lastKnownDay; date = nextDay(date)) {
    if (accrues && resetDueOn(rules, hireDate, date)) {
      crossesAccrual = true;
      closePeriod();
      balance = resetRows(balance, rules.carryoverCapHours).carryover;
      if (rules.accrualFrequency === 'yearly') {
        balance = roundHours(
          balance +
            cappedAllocation(rules.hoursPerYear ?? 0, balance, rules.maxBalanceHours),
        );
      }
    }
    if (accrues && rules.accrualFrequency === 'monthly' && monthlyAccrualDue(date)) {
      crossesAccrual = true;
      balance = roundHours(
        balance +
          cappedAllocation(
            monthlyAccrualHours(rules.hoursPerYear ?? 0),
            balance,
            rules.maxBalanceHours,
          ),
      );
    }
    take(date);
    observe(date);
  }
  closePeriod();

  return {
    lowestBalance: Number.isFinite(lowestBalance) ? roundHours(lowestBalance) : roundHours(balance),
    lowestOn,
    crossesAccrual,
    capExceededBy: Math.max(0, roundHours(capExceededBy)),
  };
}
