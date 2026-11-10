import type { TimeOffPolicyRules } from './time-off-policy';

/**
 * The request-time rules a time off policy carries (PAC-174), as pure
 * evaluators for PAC-165's submit path. Nothing in PAC-174 calls them at
 * runtime; they live beside the policy so the rules and their tests land
 * with the fields they read.
 *
 * Decided 2026-11-04: the usage waiting period reads a **nullable** hire
 * date (PAC-162 adds it) and blocks nobody while it is unset; auto-approval
 * is per policy, off by default, **approves only** — it never declines,
 * never applies to time a manager records on someone's behalf, and a
 * request that would take the balance below zero needs a person unless
 * negative balances are allowed.
 */

/** A `YYYY-MM-DD` calendar date. */
type IsoDate = string;

const DAY_MS = 86_400_000;

function utcDay(iso: IsoDate): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function toIso(utcMs: number): IsoDate {
  return new Date(utcMs).toISOString().slice(0, 10);
}

/**
 * The first day a person may request time off, or `null` when nothing
 * stands in the way: no waiting period on the policy, or no hire date yet.
 */
export function usageAllowedFrom(
  hireDate: IsoDate | null,
  waitingPeriodDays: number | null,
): IsoDate | null {
  if (!hireDate || !waitingPeriodDays || waitingPeriodDays <= 0) return null;
  return toIso(utcDay(hireDate) + waitingPeriodDays * DAY_MS);
}

/** Sick only: would this request take the year's usage past the cap? */
export function exceedsAnnualUsageCap(
  annualUsageCapHours: number | null,
  usedThisPeriodHours: number,
  requestedHours: number,
): boolean {
  if (annualUsageCapHours === null) return false;
  return usedThisPeriodHours + requestedHours > annualUsageCapHours;
}

/** First day through last, weekends included (Gusto's count). */
export function calendarDaysInclusive(firstDay: IsoDate, lastDay: IsoDate): number {
  return Math.round((utcDay(lastDay) - utcDay(firstDay)) / DAY_MS) + 1;
}

export interface AutoApprovalCandidate {
  firstDay: IsoDate;
  lastDay: IsoDate;
  /** When the request was submitted. */
  submittedAt: Date;
  /** The first instant of `firstDay` on the agency's calendar. */
  firstDayStartsAt: Date;
  /** The balance after this request, or `null` on an Unlimited policy. */
  balanceAfterHours: number | null;
  /** Recorded by a manager on the employee's behalf: never auto-approved. */
  recordedByManager: boolean;
}

export type AutoApprovalReason =
  | 'disabled'
  | 'manager_recorded'
  | 'too_many_days'
  | 'too_little_notice'
  | 'negative_balance';

export type AutoApprovalVerdict =
  | { approve: true }
  | { approve: false; reason: AutoApprovalReason };

/**
 * Whether a request is approved on submission. Every rule the policy sets
 * must hold; a rule left null is not checked. The verdict's `reason` is the
 * first rule that failed, for the timeline entry.
 */
export function evaluateAutoApproval(
  policy: Pick<TimeOffPolicyRules, 'autoApprove' | 'allowNegativeBalance'>,
  candidate: AutoApprovalCandidate,
): AutoApprovalVerdict {
  const { enabled, maxCalendarDays, minNoticeHours } = policy.autoApprove;
  if (!enabled) return { approve: false, reason: 'disabled' };
  if (candidate.recordedByManager) return { approve: false, reason: 'manager_recorded' };
  if (
    maxCalendarDays !== null &&
    calendarDaysInclusive(candidate.firstDay, candidate.lastDay) > maxCalendarDays
  ) {
    return { approve: false, reason: 'too_many_days' };
  }
  if (minNoticeHours !== null) {
    const noticeHours =
      (candidate.firstDayStartsAt.getTime() - candidate.submittedAt.getTime()) / 3_600_000;
    if (noticeHours < minNoticeHours) return { approve: false, reason: 'too_little_notice' };
  }
  if (
    candidate.balanceAfterHours !== null &&
    candidate.balanceAfterHours < 0 &&
    !policy.allowNegativeBalance
  ) {
    return { approve: false, reason: 'negative_balance' };
  }
  return { approve: true };
}
