import { BadRequestException } from '@nestjs/common';
import {
  ALL_WEEKDAYS,
  clockToMinutes,
  type LeaveAllocations,
  type LeavePolicyRules,
  type WorkSchedule,
} from '@sfa/shared';
import { isValidIsoDate, parseIsoDate } from '../../performance/performance.range';

/**
 * The bounds on an employee profile's facts (PAC-162), judged as **agency
 * days** — every date here is a `YYYY-MM-DD` calendar fact, so the only
 * place the zone enters is the caller's `today` (`agencyTodayIso`).
 *
 * Every rule throws a `400` whose message the forms show on the field, or
 * returns a list of problems in form-field terms so an editor can show them
 * all at once. Pure: no Mongo, no clock.
 */

const MONTH_DAY = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** `YYYY-MM-DD` → `MM-DD`. */
export function monthDayOf(isoDate: string): string {
  return isoDate.slice(5);
}

export function assertIsoDay(label: string, day: string): void {
  if (!isValidIsoDate(day)) {
    throw new BadRequestException(`${label} must be a real date (YYYY-MM-DD)`);
  }
}

export function assertDayNotInFuture(
  label: string,
  day: string,
  today: string,
): void {
  if (day > today) {
    throw new BadRequestException(`${label} cannot be in the future`);
  }
}

/** `day` may not precede `floor`; the same day is allowed. A null floor bounds nothing. */
export function assertDayNotBefore(
  label: string,
  day: string,
  floor: string | null | undefined,
  floorLabel: string,
): void {
  if (floor && day < floor) {
    throw new BadRequestException(
      `${label} cannot be before ${floorLabel} (${floor})`,
    );
  }
}

export function assertMonthDay(label: string, value: string): void {
  if (!MONTH_DAY.test(value)) {
    throw new BadRequestException(`${label} must be MM-DD`);
  }
}

/** A birthday is in the past and within a human lifetime. */
export function assertDateOfBirth(day: string, today: string): void {
  assertIsoDay('Date of birth', day);
  if (day >= today) {
    throw new BadRequestException('Date of birth must be in the past');
  }
  const floor = parseIsoDate(today);
  const floorIso = `${String(floor.year - 120).padStart(4, '0')}${today.slice(4)}`;
  if (day < floorIso) {
    throw new BadRequestException('Date of birth is more than 120 years ago');
  }
}

/**
 * When a new assignment entry may take effect: not in the future, not
 * before the hire date, and not before the previous entry (equal is allowed
 * — a same-day correction appends, and the as-of lookup takes the later one).
 */
export function assertEffectiveFrom(
  day: string,
  bounds: { today: string; hireDate: string | null; previous: string | null },
): void {
  assertIsoDay('Effective from', day);
  assertDayNotInFuture('Effective from', day, bounds.today);
  assertDayNotBefore('Effective from', day, bounds.hireDate, 'the hire date');
  assertDayNotBefore(
    'Effective from',
    day,
    bounds.previous,
    'the previous change',
  );
}

/** Every problem with a schedule override, in form-field terms. */
export function validateSchedule(schedule: WorkSchedule): string[] {
  const problems: string[] = [];
  const known = new Set<number>(ALL_WEEKDAYS);
  for (const [key, day] of Object.entries(schedule)) {
    const weekday = Number(key);
    if (!Number.isInteger(weekday) || !known.has(weekday)) {
      problems.push(`"${key}" is not a weekday (0–6).`);
      continue;
    }
    if (day === null || day === undefined) continue;
    const start = clockToMinutes(day.start);
    const end = clockToMinutes(day.end);
    if (start === null || end === null) {
      problems.push(`Weekday ${weekday}: times must be HH:mm.`);
    } else if (end <= start) {
      problems.push(`Weekday ${weekday}: the end must be after the start.`);
    }
  }
  return problems;
}

/**
 * Allocation keys must be **active, balance-bearing** leave types of the
 * person's effective rules; hours are non-negative and at most a year.
 */
export function validateAllocations(
  allocations: LeaveAllocations,
  rules: LeavePolicyRules,
): string[] {
  const problems: string[] = [];
  const allowed = new Map(
    rules.leaveTypes
      .filter((type) => type.active && type.drawsFromBalance)
      .map((type) => [type.key, type.label]),
  );
  for (const [key, hours] of Object.entries(allocations)) {
    if (!allowed.has(key)) {
      problems.push(
        `"${key}" is not an active leave type that draws from a balance.`,
      );
      continue;
    }
    if (typeof hours !== 'number' || !Number.isFinite(hours) || hours < 0) {
      problems.push(`${allowed.get(key)}: hours must be zero or more.`);
    } else if (hours > 8760) {
      problems.push(`${allowed.get(key)}: hours cannot exceed a year (8760).`);
    }
  }
  return problems;
}

/** Every active balance-bearing type, filled in from the policy default. */
export function effectiveAllocations(
  rules: LeavePolicyRules,
  allocations: LeaveAllocations,
): LeaveAllocations {
  const out: LeaveAllocations = {};
  for (const type of rules.leaveTypes) {
    if (!type.active || !type.drawsFromBalance) continue;
    out[type.key] = allocations[type.key] ?? rules.pto.annualAllocationHours;
  }
  return out;
}
