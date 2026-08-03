import type { OnboardingStepDefinition, OnboardingStepKey } from '@sfa/shared';

/**
 * Pure scheduling and status-derivation for onboarding steps.
 *
 * Deliberately free of Mongoose, Nest, and I/O so the timing rules can be
 * unit-tested directly — they are the part of onboarding most likely to be
 * subtly wrong, and the part users notice when it is.
 *
 * All arithmetic is exact elapsed time. There is no business-calendar logic:
 * a step completed on a Friday evening can come due at the weekend.
 */

const MINUTE_MS = 60_000;

export interface StepTiming {
  /** When the step opens for work. Null while its predecessor is incomplete. */
  availableAt: Date | null;
  dueAt: Date | null;
}

const NOT_SCHEDULABLE: StepTiming = { availableAt: null, dueAt: null };

/**
 * Timing for one step.
 *
 *     availableAt = max(anchorTime + offset, predecessor.completedAt)
 *     dueAt       = availableAt + sla
 *
 * `predecessor` is null for the first step. A predecessor that exists but is
 * incomplete leaves the step unscheduled — which is why a chained ticket is
 * only ever created once the call before it has been completed.
 *
 * The `max()` is the locked 30-day rule: `checkin_30day` anchors to the start
 * of the engagement so it cannot drift when the earlier calls run late, but it
 * still never opens before the 3-day call has closed. When the 3-day call runs
 * past day 30, the max() pushes the 30-day check-in out to that completion
 * instant rather than creating it already open.
 */
export function computeStepTiming(
  definition: OnboardingStepDefinition,
  onboardingStartedAt: Date,
  predecessor: { completedAt: Date | null } | null,
): StepTiming {
  if (predecessor && predecessor.completedAt === null) {
    return NOT_SCHEDULABLE;
  }

  const previousCompletedAt = predecessor?.completedAt ?? null;

  // A `previous_step` anchor on the first step is a misconfiguration; fall
  // back to the start rather than failing to schedule the whole onboarding.
  const anchorTime =
    definition.anchor === 'previous_step' && previousCompletedAt
      ? previousCompletedAt
      : onboardingStartedAt;

  let availableMs = anchorTime.getTime() + definition.offsetMinutes * MINUTE_MS;
  if (previousCompletedAt) {
    availableMs = Math.max(availableMs, previousCompletedAt.getTime());
  }

  return {
    availableAt: new Date(availableMs),
    dueAt: new Date(availableMs + definition.slaMinutes * MINUTE_MS),
  };
}

export interface PlannedStep extends StepTiming {
  stepKey: OnboardingStepKey;
  sortOrder: number;
  completedAt: Date | null;
}

/**
 * Timing for a whole chain, given which steps are already complete.
 *
 * No single ticket holds all of these any more — each step is its own ticket.
 * This is used to *plan* the chain: to work out when the next ticket should
 * open, and to render the "Step 2 of 3" view on the parent record including
 * steps whose ticket does not exist yet.
 *
 * Definitions are sorted defensively — the collection they come from is
 * editable config, and a bad `sortOrder` should not silently reorder the flow.
 */
export function scheduleSteps(
  definitions: OnboardingStepDefinition[],
  onboardingStartedAt: Date,
  completedAtByKey: Partial<Record<OnboardingStepKey, Date | null>> = {},
): PlannedStep[] {
  const ordered = [...definitions].sort((a, b) => a.sortOrder - b.sortOrder);

  const planned: PlannedStep[] = [];
  let predecessor: { completedAt: Date | null } | null = null;

  for (const definition of ordered) {
    const completedAt = completedAtByKey[definition.stepKey] ?? null;
    const timing = computeStepTiming(
      definition,
      onboardingStartedAt,
      predecessor,
    );

    planned.push({
      stepKey: definition.stepKey,
      sortOrder: definition.sortOrder,
      completedAt,
      ...timing,
    });

    predecessor = { completedAt };
  }

  return planned;
}

/**
 * Status derivation moved to `../scheduling/step-status`, which renewal
 * outreach shares — it only ever read `{availableAt, dueAt, completedAt}`, so
 * nothing about it was onboarding-specific. Re-exported here (including
 * `deriveOnboardingStatus` under its original name) so every existing importer
 * and the unit spec are untouched by the move.
 */
export {
  deriveStepStatus,
  deriveStepStatus as deriveOnboardingStatus,
  isStepActionable,
  isStepOverdue,
  type StatusStep,
} from '../scheduling/step-status';
