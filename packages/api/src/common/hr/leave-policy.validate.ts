import { PARTIAL_DAY_INCREMENTS, type LeavePolicyRules } from '@sfa/shared';

/**
 * The cross-field rules a leave policy must satisfy **as a whole** (PAC-161).
 *
 * The zod DTO checks shapes and ranges on the *patch*; these are the rules
 * that only make sense on the merged result — a PATCH that sets
 * `resetBasis: 'fiscal_year'` is fine on its own and wrong against a policy
 * whose `fiscalYearStart` is null. Returns every problem, in form-field terms,
 * so the editor can show them all at once.
 */
export function validateLeavePolicyRules(rules: LeavePolicyRules): string[] {
  const problems: string[] = [];

  if (!rules.leaveTypes.some((type) => type.active)) {
    problems.push('At least one leave type must be active.');
  }
  const typeKeys = rules.leaveTypes.map((type) => type.key);
  if (new Set(typeKeys).size !== typeKeys.length) {
    problems.push('Leave type keys must be unique.');
  }

  if (
    !(PARTIAL_DAY_INCREMENTS as readonly number[]).includes(
      rules.requests.partialDayIncrementMinutes,
    )
  ) {
    problems.push(
      `Partial-day increment must be one of ${PARTIAL_DAY_INCREMENTS.join(', ')} minutes.`,
    );
  }
  if (
    rules.requests.validation.advanceNotice !== 'off' &&
    rules.requests.advanceNoticeDays === null
  ) {
    problems.push(
      'Advance notice days are required while the advance-notice check is on.',
    );
  }
  for (const range of rules.requests.blackoutRanges) {
    if (range.from > range.to) {
      problems.push(`Blackout "${range.label}" ends before it starts.`);
    }
  }

  if (rules.pto.resetBasis === 'fiscal_year' && !rules.pto.fiscalYearStart) {
    problems.push('A fiscal-year start is required for a fiscal-year reset.');
  }
  if (
    rules.pto.carryover.mode === 'capped' &&
    rules.pto.carryover.capHours === null
  ) {
    problems.push('A carryover cap is required when carryover is capped.');
  }
  if (
    rules.pto.negativeBalance.mode === 'floor' &&
    rules.pto.negativeBalance.floorHours === null
  ) {
    problems.push('A floor is required when a negative balance is floored.');
  }

  if (rules.attendance.eventTypes.length === 0) {
    problems.push('At least one attendance event type must be in use.');
  }

  if (rules.points.enabled) {
    if (rules.points.ladders.tardy.length === 0) {
      problems.push('The tardy ladder needs at least one step.');
    }
    if (rules.points.ladders.absence.length === 0) {
      problems.push('The absence ladder needs at least one step.');
    }
    const points = rules.points.thresholds.map((t) => t.points);
    for (let i = 1; i < points.length; i += 1) {
      if (points[i] <= points[i - 1]) {
        problems.push('Point thresholds must be ascending and unique.');
        break;
      }
    }
  }

  return problems;
}
