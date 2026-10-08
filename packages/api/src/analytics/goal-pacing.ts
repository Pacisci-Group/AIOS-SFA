import type { GoalPacing } from '@sfa/shared';
import { attainment } from '../leaderboard/leaderboard.normalize';
import { roundCents } from '../owner-dashboard/owner-dashboard.normalize';
import type { CalendarDate, YmdRange } from '../performance/performance.range';

/**
 * Goal pacing for the Analytics summary (PAC-152, part 2).
 *
 * A goal is a **month's** premium target (`producerGoals.month`), so pacing is
 * only meaningful for a window that starts on the 1st and stays inside that
 * month — this month to date, last month, or a custom "May 1–15". Anything
 * else (a quarter, a window starting mid-month) has no month to pace against.
 */
export function pacingMonth(
  range: Pick<YmdRange, 'from' | 'to'>,
): string | null {
  const month = range.from.slice(0, 7);
  return range.from.endsWith('-01') && range.to.slice(0, 7) === month
    ? month
    : null;
}

export interface PacingInput {
  /** `YYYY-MM`. */
  month: string;
  goalPremium: number;
  boundPremium: number;
  producersWithGoals: number;
  /** The window's inclusive last day, `YYYY-MM-DD`. */
  windowTo: string;
  /** Today on the agency's calendar. */
  today: CalendarDate;
}

const round1 = (value: number) => Math.round(value * 10) / 10;

/**
 * Where the month stands against its goal.
 *
 * Elapsed days run to the window's end, but never past today: a custom window
 * ending on the 31st, asked on the 10th, has had ten days to sell in. A month
 * that has not started has elapsed nothing, so it has no projection.
 *
 * `status` compares bound premium with where an even pace would have it:
 * `achieved` once the goal is met, `ahead` at or above the pro-rata line,
 * `behind` below it.
 */
export function computePacing(input: PacingInput): GoalPacing {
  const [year, monthNumber] = input.month.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const windowDay = Number(input.windowTo.slice(8, 10));

  const todayMonth = input.today.year * 100 + input.today.month;
  const thisMonth = year * 100 + monthNumber;
  const elapsedDays =
    todayMonth < thisMonth
      ? 0
      : todayMonth === thisMonth
        ? Math.min(windowDay, input.today.day)
        : windowDay;

  const share = elapsedDays / daysInMonth;
  const goalPremium = roundCents(input.goalPremium);
  const boundPremium = roundCents(input.boundPremium);
  const expectedToDate = roundCents(goalPremium * share);

  return {
    month: input.month,
    goalPremium,
    boundPremium,
    producersWithGoals: input.producersWithGoals,
    elapsedDays,
    daysInMonth,
    elapsedPct: round1(share * 100),
    expectedToDate,
    projectedPremium:
      elapsedDays > 0
        ? roundCents((boundPremium / elapsedDays) * daysInMonth)
        : null,
    attainmentPct: attainment(boundPremium, goalPremium),
    status:
      boundPremium >= goalPremium
        ? 'achieved'
        : boundPremium >= expectedToDate
          ? 'ahead'
          : 'behind',
  };
}
