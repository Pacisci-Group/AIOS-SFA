import type {
  OnboardingChecklistKey,
  OnboardingEmailMilestoneKey,
  OnboardingStepKey,
  OnboardingView,
  RenewalCycleView,
  RenewalDeskRow,
  RenewalOutcome,
  RenewalStepKey,
  ServiceTicketAssignee,
  ServiceTicketCategory,
  ServiceTicketNoteType,
  ServiceTicketPriority,
  ServiceTicketStats,
  ServiceTicketStatus,
  ServiceTicketView,
} from '@sfa/shared';
import { apiFetch } from '@/lib/api-client';

export type {
  OnboardingChainStep,
  OnboardingChecklistKey,
  OnboardingEmailMilestoneKey,
  OnboardingStepKey,
  OnboardingStepRef,
  OnboardingView,
  RenewalChainStep,
  RenewalCycleView,
  RenewalDeskRow,
  RenewalOutcome,
  RenewalPolicyItem,
  RenewalStepKey,
  RenewalStepRef,
  ServiceTicketAssignee,
  ServiceTicketCategory,
  ServiceTicketNoteType,
  ServiceTicketPriority,
  ServiceTicketStats,
  ServiceTicketStatus,
  ServiceTicketView,
} from '@sfa/shared';

const BASE = '/crm/service-tickets';

export interface ListServiceTicketsOptions {
  status?: ServiceTicketStatus;
  category?: ServiceTicketCategory;
  /**
   * When true, returns only archived tickets (resolved longer ago than the
   * archive window). Omitted returns the active queue, which excludes them.
   */
  archived?: boolean;
}

export function listServiceTickets(options: ListServiceTicketsOptions = {}) {
  const params = new URLSearchParams();
  if (options.status) {
    params.set('status', options.status);
  }
  if (options.category) {
    params.set('category', options.category);
  }
  if (options.archived) {
    params.set('archived', 'true');
  }
  const qs = params.toString();
  return apiFetch<ServiceTicketView[]>(`${BASE}${qs ? `?${qs}` : ''}`);
}

export function getServiceTicketStats() {
  return apiFetch<ServiceTicketStats>(`${BASE}/stats`);
}

/** CRM/CSR users who can be a ticket's Assigned Client Relation Manager. */
export function listServiceTicketAssignees() {
  return apiFetch<ServiceTicketAssignee[]>(`${BASE}/assignees`);
}

export interface CreateServiceTicketInput {
  category: ServiceTicketCategory;
  status?: ServiceTicketStatus;
  priority?: ServiceTicketPriority;
  /** The Assigned Client Relation Manager. */
  assignedUserId?: string;
  policyId?: string;
  householdId?: string;
  clientName?: string;
  /** Free-text notes; becomes the ticket's opening timeline entry. */
  openingNote?: string;
}

export function createServiceTicket(input: CreateServiceTicketInput) {
  return apiFetch<ServiceTicketView>(BASE, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getServiceTicket(id: string) {
  return apiFetch<ServiceTicketView>(`${BASE}/${id}`);
}

export function updateServiceTicketStatus(
  id: string,
  status: ServiceTicketStatus,
) {
  return apiFetch<ServiceTicketView>(`${BASE}/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export function addServiceTicketNote(
  id: string,
  content: string,
  type?: ServiceTicketNoteType,
) {
  return apiFetch<ServiceTicketView>(`${BASE}/${id}/notes`, {
    method: 'POST',
    body: JSON.stringify(type ? { content, type } : { content }),
  });
}

/* -------------------------------------------------------------------------- *
 * Onboarding
 *
 * Onboarding is a ticket category, so these hang off the same ticket resource
 * and need no extra permission beyond `crm_service:write`. Each returns the
 * refreshed ticket, including its recomputed step timing and derived status.
 * -------------------------------------------------------------------------- */

/**
 * Mark an onboarding step done and schedule whatever comes next. Rejected by
 * the API (400) if the step is not yet available or is already complete —
 * check `step.isActionable` before offering the action.
 */
export function completeOnboardingStep(id: string, stepKey: OnboardingStepKey) {
  return apiFetch<ServiceTicketView>(
    `${BASE}/${id}/onboarding/steps/${stepKey}/complete`,
    { method: 'POST' },
  );
}

export function updateOnboardingChecklist(
  id: string,
  changes: Partial<Record<OnboardingChecklistKey, boolean>>,
) {
  return apiFetch<ServiceTicketView>(`${BASE}/${id}/onboarding/checklist`, {
    method: 'PATCH',
    body: JSON.stringify(changes),
  });
}

/** Record (or clear) a client touchpoint. Nothing is sent — this only logs it. */
export function updateOnboardingEmailMilestone(
  id: string,
  milestone: OnboardingEmailMilestoneKey,
  recorded: boolean,
) {
  return apiFetch<ServiceTicketView>(`${BASE}/${id}/onboarding/emails`, {
    method: 'PATCH',
    body: JSON.stringify({ milestone, recorded }),
  });
}

/**
 * The per-client onboarding behind a ticket's chain — the record that holds
 * the checklist, the email milestones, and the "Step 2 of 3" progress.
 * Onboarding is tracked per client, so this, not the ticket, is the journey.
 */
export function getOnboarding(onboardingId: string) {
  return apiFetch<OnboardingView>(`${BASE}/onboardings/${onboardingId}`);
}

/** Every onboarding for a client, newest first. */
export function listOnboardingsForHousehold(householdId: string) {
  return apiFetch<OnboardingView[]>(
    `${BASE}/onboardings/household/${householdId}`,
  );
}

/* -------------------------------------------------------------------------- *
 * Proactive renewal outreach
 *
 * Renewal is a ticket category, so these hang off the same ticket resource and
 * need no permission beyond `crm_service:read`/`:write`.
 *
 * Every timing value on these responses — `daysUntilRenewal`, `isActionable`,
 * `isOverdue` — is computed against the **server** clock. Render them; never
 * recompute them from the timestamps, or a skewed browser clock will offer an
 * action the API rejects.
 * -------------------------------------------------------------------------- */

/**
 * The Proactive Renewal Outreach desk: one row per deal with a call currently
 * on the CSR's plate, most urgent first.
 *
 * This read is also what *materializes* renewal cycles — there is no cron, so
 * loading the desk is what makes newly-due renewals appear.
 */
export function getRenewalDesk() {
  return apiFetch<RenewalDeskRow[]>(`${BASE}/renewals/desk`);
}

/**
 * One renewal cycle: its policy checklist and both calls (or the single merged
 * call on the auto track).
 */
export function getRenewalCycle(renewalCycleId: string) {
  return apiFetch<RenewalCycleView>(`${BASE}/renewals/${renewalCycleId}`);
}

/** Tick a policy off the call's checklist (or un-tick it with `discussed: false`). */
export function updateRenewalPolicy(
  id: string,
  policyId: string,
  discussed: boolean,
) {
  return apiFetch<ServiceTicketView>(`${BASE}/${id}/renewal/policies`, {
    method: 'PATCH',
    body: JSON.stringify({ policyId, discussed }),
  });
}

/**
 * Close a renewal call. Rejected by the API (400) unless every policy has been
 * ticked, and — on the renewal review — unless an outcome is supplied.
 */
export function completeRenewalStep(
  id: string,
  stepKey: RenewalStepKey,
  body: { outcome?: RenewalOutcome; note?: string } = {},
) {
  return apiFetch<ServiceTicketView>(
    `${BASE}/${id}/renewal/steps/${stepKey}/complete`,
    { method: 'POST', body: JSON.stringify(body) },
  );
}

/** Correct a recorded outcome after the call. */
export function setRenewalOutcome(
  id: string,
  outcome: RenewalOutcome,
  note?: string,
) {
  return apiFetch<ServiceTicketView>(`${BASE}/${id}/renewal/outcome`, {
    method: 'PATCH',
    body: JSON.stringify(note ? { outcome, note } : { outcome }),
  });
}
