import { RENEWAL_STEP_LABELS } from '@sfa/shared';
import type {
  RenewalChainStep,
  RenewalCycleView,
  RenewalPolicyItem,
  RenewalStepDefinition,
  RenewalStepKey,
  RenewalStepRef,
} from '@sfa/shared';
import {
  deriveStepStatus,
  isStepActionable,
  isStepOverdue,
} from '../scheduling/step-status';
import type { RenewalCycle } from '../schemas/renewal-cycle.schema';
import type { RenewalStepEntry } from '../schemas/service-ticket.schema';
import { daysUntil, type PlannedRenewalStep } from './renewal-scheduling';

/**
 * Wire serialization for renewal outreach, mirroring `onboarding-serializer.ts`.
 *
 * `isActionable` / `isOverdue` / `daysUntilRenewal` are computed here against
 * the **server clock** and sent as plain values — the web app must not
 * re-derive them from the timestamps, so that a skewed browser clock cannot
 * offer an action the API would reject. The mock desk's permanently-stale
 * hardcoded `daysUntil` is exactly the failure this avoids.
 */

const iso = (value: Date | string | null | undefined): string | null => {
  if (!value) return null;
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
};

const asDate = (value: Date | string | null | undefined): Date | null => {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
};

/** The definition backing a step, so agendas and merges survive to the UI. */
function definitionFor(
  definitions: RenewalStepDefinition[],
  step: { track: string; stepKey: RenewalStepKey },
): RenewalStepDefinition | null {
  return (
    definitions.find(
      (d) => d.track === step.track && d.stepKey === step.stepKey,
    ) ?? null
  );
}

/** One ticket's call. */
export function serializeRenewalStep(
  step: RenewalStepEntry,
  definitions: RenewalStepDefinition[],
  now: Date = new Date(),
): RenewalStepRef {
  const timing = {
    availableAt: asDate(step.availableAt),
    dueAt: asDate(step.dueAt),
    completedAt: asDate(step.completedAt),
  };
  const definition = definitionFor(definitions, step);
  const renewalDate = asDate(step.renewalDate) ?? now;

  return {
    renewalCycleId: String(step.renewalCycleId),
    stepKey: step.stepKey,
    label: RENEWAL_STEP_LABELS[step.stepKey] ?? step.stepKey,
    track: step.track,
    sequence: step.sequence,
    totalSteps: step.totalSteps,
    renewalDate: renewalDate.toISOString(),
    daysUntilRenewal: daysUntil(renewalDate, now),
    availableAt: iso(step.availableAt),
    dueAt: iso(step.dueAt),
    completedAt: iso(step.completedAt),
    completedBy: step.completedBy ? String(step.completedBy) : null,
    completedByName: step.completedByName ?? '',
    isActionable: isStepActionable(timing, now),
    isOverdue: isStepOverdue(timing, now),
    agendaKeys: [...(definition?.agendaKeys ?? [])],
    mergedFrom: [...(definition?.mergedFrom ?? [])],
    outcome: step.outcome ?? null,
    outcomeAt: iso(step.outcomeAt),
    // Only the renewal review carries a decision — on both tracks, since the
    // merged auto call reuses that same step key.
    requiresOutcome: step.stepKey === 'renewal_review',
  };
}

export function serializeRenewalPolicy(
  policy: RenewalCycle['policies'][number],
): RenewalPolicyItem {
  return {
    policyId: String(policy.policyId),
    policyNumber: policy.policyNumber ?? '',
    policyType: policy.policyType ?? '',
    carrier: policy.carrier ?? '',
    premium: policy.premium ?? 0,
    renewalDate: iso(policy.renewalDate),
    discussedAt: iso(policy.discussedAt),
    discussedByName: policy.discussedByName ?? '',
  };
}

/** The minimum a chain ticket must expose. Keeps this file free of Mongoose. */
export interface ChainTicket {
  _id: unknown;
  ticketNumber: string;
  renewal?: RenewalStepEntry | null;
}

/**
 * The whole cycle: its policy checklist plus every call, whether or not the
 * call's ticket exists yet.
 *
 * Iterates the *plan* rather than the tickets, so a chain is always full length
 * — one row on the auto track, two on the annual one.
 */
export function serializeRenewalCycle(
  cycle: RenewalCycle & { _id: unknown },
  tickets: ChainTicket[],
  planned: PlannedRenewalStep[],
  now: Date = new Date(),
): RenewalCycleView {
  const ticketByStep = new Map<RenewalStepKey, ChainTicket>();
  for (const ticket of tickets) {
    if (ticket.renewal) {
      ticketByStep.set(ticket.renewal.stepKey, ticket);
    }
  }

  const chain: RenewalChainStep[] = planned.map((step) => {
    const ticket = ticketByStep.get(step.stepKey);
    // Prefer the ticket's stored timing; fall back to the plan for a call whose
    // ticket does not exist yet.
    const timing = {
      availableAt: asDate(ticket?.renewal?.availableAt) ?? step.availableAt,
      dueAt: asDate(ticket?.renewal?.dueAt) ?? step.dueAt,
      completedAt: asDate(ticket?.renewal?.completedAt) ?? step.completedAt,
    };

    return {
      stepKey: step.stepKey,
      label: step.label,
      sequence: step.sequence,
      ticketId: ticket ? String(ticket._id) : null,
      ticketNumber: ticket?.ticketNumber ?? null,
      availableAt: iso(timing.availableAt),
      dueAt: iso(timing.dueAt),
      completedAt: iso(timing.completedAt),
      // A call with no ticket is never actionable — there is nothing to open.
      isActionable: ticket ? isStepActionable(timing, now) : false,
      isOverdue: ticket ? isStepOverdue(timing, now) : false,
    };
  });

  const renewalDate = asDate(cycle.renewalDate) ?? now;

  return {
    id: String(cycle._id),
    groupKey: cycle.groupKey,
    dealId: cycle.dealId ? String(cycle.dealId) : null,
    householdId: cycle.householdId ? String(cycle.householdId) : null,
    clientName: cycle.clientName ?? '',
    householdName: cycle.householdName ?? '',
    track: cycle.track,
    termKey: cycle.termKey,
    renewalDate: renewalDate.toISOString(),
    daysUntilRenewal: daysUntil(renewalDate, now),
    currentStepKey: cycle.currentStepKey ?? null,
    completedAt: iso(cycle.completedAt),
    isComplete: Boolean(cycle.completedAt),
    closedReason: cycle.closedReason ?? null,
    outcome: cycle.outcome ?? null,
    outcomeAt: iso(cycle.outcomeAt),
    outcomeByName: cycle.outcomeByName ?? '',
    outcomeNote: cycle.outcomeNote ?? '',
    policies: (cycle.policies ?? []).map(serializeRenewalPolicy),
    chain,
  };
}

/** Status of a ticket's call, for the desk row. */
export function renewalStepStatus(step: RenewalStepEntry, now: Date) {
  return deriveStepStatus(
    {
      availableAt: asDate(step.availableAt),
      dueAt: asDate(step.dueAt),
      completedAt: asDate(step.completedAt),
    },
    now,
  );
}
