import type { ServiceTicketStatus } from '@sfa/shared';

/**
 * Status derivation for any *scheduled step* a ticket can carry.
 *
 * Lives under `common/` rather than `crm/` so the worker may import it: the
 * boundary in `eslint.config.mjs` admits only schemas from feature
 * directories, and `SyncTicketStatusFn` needs this rule to advance statuses.
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
 * The `waiting -> open` and `open -> overdue` transitions happen through the
 * passage of time, with no write to hang an update off. This function was
 * therefore called on every read, and the stored `status` column was left
 * stale — which is exactly what `SyncTicketStatusFn` now fixes: the sweep
 * calls this and writes the answer, so reads can trust the column.
 *
 * That makes this the **single definition of the rule**, not one of two. It is
 * still pure and still safe to call on a read; what changed is that nothing
 * has to, and nothing else may re-implement it. The Mongo predicates that
 * select tickets due to transition are derived from the same precedence in
 * `step-status.query.ts` — change one, change both, and the tests in
 * `step-status.query.spec.ts` will tell you if you didn't.
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
