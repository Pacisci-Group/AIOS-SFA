import type { ServiceTicketStatus } from '@sfa/shared';

/**
 * Status derivation for any *scheduled step* a ticket can carry.
 *
 * Extracted from `onboarding-scheduling.ts` unchanged: these three functions
 * only ever looked at `{availableAt, dueAt, completedAt}`, so nothing about
 * them was onboarding-specific except their names. Renewal outreach carries a
 * step of the same shape and derives its status the same way.
 *
 * Pure and I/O-free, like the schedulers that feed it.
 */

/** The minimum a step must expose to have a status derived from it. */
export interface StatusStep {
  availableAt: Date | null;
  dueAt: Date | null;
  completedAt: Date | null;
}

/**
 * A ticket's status, derived from its step's timing, in precedence order:
 *
 *   overdue  — incomplete and past due
 *   open     — incomplete and available now
 *   waiting  — incomplete and not yet open (scheduled; hidden from lists)
 *   resolved — complete
 *
 * Computed on read rather than stored because the `waiting -> open` and
 * `open -> overdue` transitions happen through the passage of time, with no
 * write to hang an update off. Nothing here mutates rows, so the queue needs
 * no cron.
 */
export function deriveStepStatus(
  step: StatusStep,
  now: Date,
): ServiceTicketStatus {
  if (step.completedAt !== null) {
    return 'resolved';
  }
  if (isStepOverdue(step, now)) {
    return 'overdue';
  }
  if (isStepActionable(step, now)) {
    return 'open';
  }
  return 'waiting';
}

/** True when the step can be worked right now. */
export function isStepActionable(step: StatusStep, now: Date): boolean {
  return (
    step.completedAt === null &&
    step.availableAt !== null &&
    step.availableAt.getTime() <= now.getTime()
  );
}

/** True when the step is incomplete and past its due date. */
export function isStepOverdue(step: StatusStep, now: Date): boolean {
  return (
    step.completedAt === null &&
    step.dueAt !== null &&
    step.dueAt.getTime() < now.getTime()
  );
}
