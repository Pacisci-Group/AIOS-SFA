import { BadRequestException } from '@nestjs/common';
import { EARLIEST_DATE_OF_BIRTH } from '@sfa/shared';

/**
 * The rules on an employee profile's calendar days (PAC-162). Every day is
 * `YYYY-MM-DD` and every bound is judged on the agency's calendar — `today`
 * is `agencyTodayIso(timeZone)`, never the server's clock. Pure, so the
 * controller's DTO and the service share them and the unit spec pins them.
 */

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DD` naming a real day (30 Feb is not one). */
export function isIsoDay(value: string): boolean {
  const match = ISO_DAY.exec(value);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function assertIsoDay(value: string, label: string): void {
  if (!isIsoDay(value)) {
    throw new BadRequestException(`${label} must be a date (YYYY-MM-DD).`);
  }
}

/** A hire date is a day that has come: today at the latest. */
export function assertHireDate(hireDate: string, today: string): void {
  assertIsoDay(hireDate, 'Hire date');
  if (hireDate > today) {
    throw new BadRequestException('A hire date cannot be in the future.');
  }
}

/** Born before today and after 1900 — anything else is a typo. */
export function assertDateOfBirth(dateOfBirth: string, today: string): void {
  assertIsoDay(dateOfBirth, 'Date of birth');
  if (dateOfBirth >= today) {
    throw new BadRequestException('A date of birth must be in the past.');
  }
  if (dateOfBirth < EARLIEST_DATE_OF_BIRTH) {
    throw new BadRequestException(
      `A date of birth cannot be before ${EARLIEST_DATE_OF_BIRTH}.`,
    );
  }
}

/** Nobody is hired after they were removed. */
export function assertHireBeforeTermination(
  hireDate: string | null,
  terminationDate: string | null,
): void {
  if (hireDate && terminationDate && hireDate > terminationDate) {
    throw new BadRequestException(
      `The hire date cannot be after the termination date (${terminationDate}).`,
    );
  }
}
