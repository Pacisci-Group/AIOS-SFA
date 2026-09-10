import type { FilterQuery } from 'mongoose';

/**
 * Mongo predicates selecting tickets whose *derived* status has moved on from
 * the one stored on them.
 *
 * `deriveStepStatus` is the rule; these are the same precedence expressed as
 * queries, so `SyncTicketStatusFn` can find the tickets that need advancing
 * with an indexed range scan instead of loading the book and recomputing every
 * row. The two files must change together — `step-status.query.spec.ts` runs
 * both over the same fixtures and fails if they disagree.
 *
 * Pure: these build plain objects and touch no I/O, which is what lets the
 * worker import them across the boundary that bars it from feature services.
 *
 * ## Two guards that carry the correctness
 *
 * **`statusOverriddenAt: null`** — a CSR who set the status by hand owns it,
 * and the schedule must not take it back. Matches missing as well as null, so
 * tickets predating the field are schedule-owned, which they are.
 *
 * **`$ne: null` on the date ranges** — defensive, not load-bearing, and the
 * distinction is worth stating because the code this replaced got it wrong.
 * `onboardingStatusMatch` claimed a bare `{ dueAt: { $lt: now } }` would also
 * match an unscheduled step, "because BSON sorts null before every date". The
 * sort order does; **query comparison does not**. Mongo's range operators are
 * type-bracketed, so `$lt: <Date>` matches Date values only — never null,
 * never a missing field. Verified against the server, not reasoned about.
 *
 * The guards stay anyway, for a hazard that is real: `$expr` is **not**
 * type-bracketed. `{ $expr: { $lt: ['$dueAt', now] } }` does match a null
 * `dueAt`, and this codebase already reaches for `$expr` a few lines away in
 * `archivedMatch`. Anyone rewriting these into an aggregation expression
 * inherits a guard that is doing nothing today and everything then.
 */

/** The two step shapes a ticket can carry. A ticket never has both. */
export const STEP_PATHS = ['onboarding', 'renewal'] as const;
export type StepPath = (typeof STEP_PATHS)[number];

/**
 * Incomplete, scheduled, and past its due date → `overdue`.
 *
 * `status: { $ne: 'overdue' }` keeps the sweep's write set to tickets that
 * actually change, so `modifiedCount` means "transitions this tick" rather
 * than "rows rewritten to the value they already held".
 */
export function pastDueMatch(
  step: StepPath,
  now: Date,
): FilterQuery<Record<string, unknown>> {
  return {
    statusOverriddenAt: null,
    status: { $ne: 'overdue' },
    [`${step}.completedAt`]: null,
    [`${step}.dueAt`]: { $ne: null, $lt: now },
  };
}

/**
 * Incomplete, open for work, and not yet past due → `open`.
 *
 * The `dueAt` clause is what keeps this disjoint from {@link pastDueMatch}:
 * `overdue` outranks `open` in the derivation, so a step that is both
 * available and past due must land in exactly one of these. `$gte` rather than
 * `$gt` mirrors `isStepOverdue`, which is strict (`dueAt < now`) — a step due
 * at exactly `now` is not yet late.
 *
 * A null `dueAt` is a scheduled step with no deadline, which is open once
 * available; `$or` admits it rather than letting the range clause drop it.
 */
export function nowOpenMatch(
  step: StepPath,
  now: Date,
): FilterQuery<Record<string, unknown>> {
  return {
    statusOverriddenAt: null,
    status: { $ne: 'open' },
    [`${step}.completedAt`]: null,
    [`${step}.availableAt`]: { $ne: null, $lte: now },
    $or: [{ [`${step}.dueAt`]: null }, { [`${step}.dueAt`]: { $gte: now } }],
  };
}
