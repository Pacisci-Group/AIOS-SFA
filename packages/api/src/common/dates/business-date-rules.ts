import { BadRequestException } from '@nestjs/common';
import { agencyTodayIso } from '../../performance/performance.range';
import { businessDay } from './business-dates';

/**
 * The bounds on a business date (PAC-159 §1b), judged on the **agency's
 * calendar** and compared as days — so a quote and a sale on one visit are
 * fine whatever their times, and "today" is the agency's today rather than
 * the server clock's UTC day or the browser's.
 *
 * Every rule throws a `400` whose message the forms show on the date field.
 * The callers apply them only to a date that is actually being set or moved:
 * legacy never enforced any of this, so a migrated pair may already violate
 * a rule, and a patch that edits the notes must not be refused for it.
 *
 * Which pair is checked is the caller's decision: a sale is bounded by the
 * quote it was sold from (`Deal.quoteRecapId`) and by its lead, never by
 * "any quote on the lead" — a requote recorded after the first sale is
 * legitimate. See the services for the exact pairs.
 */

/** `label` is the field as the form names it: "Sold date", "Quote date", "Lead date". */
export function assertNotInFuture(
  label: string,
  day: string,
  timeZone: string,
  now: Date = new Date(),
): void {
  if (day > agencyTodayIso(timeZone, now)) {
    throw new BadRequestException(`${label} cannot be in the future`);
  }
}

/**
 * `day` may not precede the agency-calendar day of `floor`; the same day is
 * allowed. A missing `floor` bounds nothing.
 */
export function assertNotBefore(
  label: string,
  day: string,
  floor: Date | null | undefined,
  floorLabel: string,
  timeZone: string,
): void {
  const floorDay = businessDay(floor, timeZone);
  if (floorDay && day < floorDay) {
    throw new BadRequestException(
      `${label} cannot be before ${floorLabel} (${floorDay})`,
    );
  }
}

/**
 * `day` may not follow the agency-calendar day of `ceiling`; the same day is
 * allowed. A missing `ceiling` bounds nothing.
 */
export function assertNotAfter(
  label: string,
  day: string,
  ceiling: Date | null | undefined,
  ceilingLabel: string,
  timeZone: string,
): void {
  const ceilingDay = businessDay(ceiling, timeZone);
  if (ceilingDay && day > ceilingDay) {
    throw new BadRequestException(
      `${label} cannot be after ${ceilingLabel} (${ceilingDay})`,
    );
  }
}
