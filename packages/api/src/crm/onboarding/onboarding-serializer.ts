import {
  ONBOARDING_CHECKLIST_KEYS,
  ONBOARDING_EMAIL_MILESTONE_KEYS,
  ONBOARDING_STEP_KEYS,
  ONBOARDING_STEP_LABELS,
} from '@sfa/shared';
import type {
  OnboardingChainStep,
  OnboardingChecklistKey,
  OnboardingEmailMilestoneKey,
  OnboardingStepKey,
  OnboardingStepRef,
  OnboardingView,
} from '@sfa/shared';
import type { Onboarding } from '../schemas/onboarding.schema';
import type { OnboardingStepEntry } from '../schemas/service-ticket.schema';
import {
  isStepActionable,
  isStepOverdue,
  PlannedStep,
} from './onboarding-scheduling';

const iso = (value: Date | null | undefined): string | null =>
  value ? new Date(value).toISOString() : null;

const asDate = (value: Date | null | undefined): Date | null =>
  value ? new Date(value) : null;

/**
 * Serialize a ticket's onboarding step.
 *
 * `isActionable` / `isOverdue` are computed here against the server clock and
 * sent as booleans — the web app must not re-derive them from the timestamps,
 * so that a skewed browser clock cannot offer an action the API would reject.
 */
export function serializeOnboardingStep(
  step: OnboardingStepEntry,
  now: Date = new Date(),
): OnboardingStepRef {
  const timing = {
    availableAt: asDate(step.availableAt),
    dueAt: asDate(step.dueAt),
    completedAt: asDate(step.completedAt),
  };

  return {
    onboardingId: String(step.onboardingId),
    stepKey: step.stepKey,
    label: ONBOARDING_STEP_LABELS[step.stepKey] ?? step.stepKey,
    sequence: step.sequence,
    totalSteps: ONBOARDING_STEP_KEYS.length,
    availableAt: iso(step.availableAt),
    dueAt: iso(step.dueAt),
    completedAt: iso(step.completedAt),
    completedBy: step.completedBy ? String(step.completedBy) : null,
    completedByName: step.completedByName ?? '',
    isActionable: isStepActionable(timing, now),
    isOverdue: isStepOverdue(timing, now),
  };
}

/** A ticket in the chain, keyed by step, for stitching into the chain view. */
export interface ChainTicket {
  _id: unknown;
  ticketNumber: string;
  onboarding: OnboardingStepEntry | null;
}

/**
 * Serialize the per-client onboarding record, stitching in whichever chain
 * tickets already exist.
 *
 * `planned` supplies timing for steps whose ticket has not been created yet,
 * so the chain view can show the whole journey rather than stopping at the
 * current call. A planned step with no ticket is shown with `ticketId: null`.
 */
export function serializeOnboarding(
  onboarding: Onboarding & { _id: unknown },
  tickets: ChainTicket[],
  planned: PlannedStep[],
  now: Date = new Date(),
): OnboardingView {
  const ticketByStep = new Map<OnboardingStepKey, ChainTicket>();
  for (const ticket of tickets) {
    if (ticket.onboarding) {
      ticketByStep.set(ticket.onboarding.stepKey, ticket);
    }
  }
  const plannedByStep = new Map(planned.map((p) => [p.stepKey, p]));

  const chain: OnboardingChainStep[] = ONBOARDING_STEP_KEYS.map(
    (stepKey, index) => {
      const ticket = ticketByStep.get(stepKey);
      const step = ticket?.onboarding ?? null;
      const fallback = plannedByStep.get(stepKey);

      // Prefer the ticket's own stored timing; fall back to the plan for steps
      // that have not been created yet.
      const timing = {
        availableAt: step
          ? asDate(step.availableAt)
          : (fallback?.availableAt ?? null),
        dueAt: step ? asDate(step.dueAt) : (fallback?.dueAt ?? null),
        completedAt: step ? asDate(step.completedAt) : null,
      };

      return {
        stepKey,
        label: ONBOARDING_STEP_LABELS[stepKey],
        sequence: index + 1,
        ticketId: ticket ? String(ticket._id) : null,
        ticketNumber: ticket?.ticketNumber ?? null,
        availableAt: iso(timing.availableAt),
        dueAt: iso(timing.dueAt),
        completedAt: iso(timing.completedAt),
        // A step with no ticket is never actionable — there is nothing to open.
        isActionable: ticket ? isStepActionable(timing, now) : false,
        isOverdue: ticket ? isStepOverdue(timing, now) : false,
      };
    },
  );

  const checklist = {} as Record<OnboardingChecklistKey, boolean>;
  for (const key of ONBOARDING_CHECKLIST_KEYS) {
    checklist[key] = Boolean(onboarding.checklist?.[key]);
  }

  const emailMilestones = {} as Record<
    OnboardingEmailMilestoneKey,
    string | null
  >;
  for (const key of ONBOARDING_EMAIL_MILESTONE_KEYS) {
    emailMilestones[key] = iso(onboarding.emailMilestones?.[key]);
  }

  return {
    id: String(onboarding._id),
    householdId: String(onboarding.householdId),
    clientName: onboarding.clientName,
    salesProducerName: onboarding.salesProducerName ?? '',
    dealId: onboarding.dealId ? String(onboarding.dealId) : null,
    dealAuditId: onboarding.dealAuditId ? String(onboarding.dealAuditId) : null,
    startedAt: new Date(onboarding.startedAt).toISOString(),
    currentStepKey: onboarding.currentStepKey ?? null,
    completedAt: iso(onboarding.completedAt),
    isComplete: Boolean(onboarding.completedAt),
    checklist,
    emailMilestones,
    chain,
  };
}
