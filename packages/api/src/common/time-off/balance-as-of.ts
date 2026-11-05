import {
  addDays,
  agencyTodayIso,
  parseIsoDate,
  toIsoDate,
} from '../../performance/performance.range';
import { businessDateInstant } from '../dates/business-dates';

/**
 * The instant a balance *shown to a person* is read as of: the first moment
 * of **tomorrow** on the agency's calendar (PAC-165).
 *
 * A `used` row is dated at the start of its leave day. Everything dated
 * before this instant has happened — today's leave counts as taken — and
 * everything from it on is approved leave that has not happened yet, which
 * the screens show as "other requested hours" rather than inside the balance.
 *
 * The accrual job does **not** use this: it closes a period at the start of
 * the reset day, so leave on that day belongs to the new period.
 */
export function balanceAsOf(timeZone: string, now: Date = new Date()): Date {
  const tomorrow = addDays(parseIsoDate(agencyTodayIso(timeZone, now)), 1);
  return businessDateInstant(toIsoDate(tomorrow), timeZone);
}
