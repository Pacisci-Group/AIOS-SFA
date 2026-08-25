/**
 * Shared domain vocabulary for the CRM Service tickets module. Kept in
 * `@sfa/shared` so the API (schema/DTO validation) and the web app (typed API
 * client + UI) agree on the exact set of allowed values.
 */

import type { RenewalStepRef } from './renewal';

export const SERVICE_TICKET_STATUSES = [
  'open',
  'waiting',
  'resolved',
  'overdue',
  // Finer-grained states offered by the "New Service Ticket" form. The queue
  // and workspace status pickers keep the original four.
  'in_progress',
  'waiting_on_client',
  'waiting_on_carrier',
  'closed',
] as const;
export type ServiceTicketStatus = (typeof SERVICE_TICKET_STATUSES)[number];

/**
 * Statuses a CSR can pick when opening a ticket from the create form. A subset
 * of `SERVICE_TICKET_STATUSES` — `waiting` and `overdue` are derived/legacy
 * states rather than something you file a new ticket under.
 */
export const SERVICE_TICKET_CREATE_STATUSES = [
  'open',
  'in_progress',
  'waiting_on_client',
  'waiting_on_carrier',
  'resolved',
  'closed',
] as const satisfies readonly ServiceTicketStatus[];

/**
 * Statuses offered by the in-place status pickers (service-dashboard queue row
 * and the ticket workspace header). Deliberately the original four — the finer
 * create-form states are set when the ticket is opened.
 *
 * These apply to every ticket, onboarding included: an onboarding ticket's
 * status is derived from its call schedule only until someone picks one here.
 */
export const SERVICE_TICKET_PICKER_STATUSES = [
  'open',
  'waiting',
  'resolved',
  'overdue',
] as const satisfies readonly ServiceTicketStatus[];

/**
 * Statuses that end a ticket's life. Both stop it counting as open work and
 * both start the archive clock.
 */
export const SERVICE_TICKET_TERMINAL_STATUSES = [
  'resolved',
  'closed',
] as const satisfies readonly ServiceTicketStatus[];

export function isTerminalTicketStatus(status: ServiceTicketStatus): boolean {
  return (SERVICE_TICKET_TERMINAL_STATUSES as readonly string[]).includes(
    status,
  );
}

/** Display labels for every status (the multi-word ones are stored snake_case). */
export const SERVICE_TICKET_STATUS_LABELS: Record<
  ServiceTicketStatus,
  string
> = {
  open: 'Open',
  waiting: 'Waiting',
  resolved: 'Resolved',
  overdue: 'Overdue',
  in_progress: 'In Progress',
  waiting_on_client: 'Waiting on Client',
  waiting_on_carrier: 'Waiting on Carrier',
  closed: 'Closed',
};

/**
 * How long a resolved ticket stays in the active queue (the "Resolved" tab)
 * before it moves to the Archived Tickets view. Shared so the API filter and
 * any UI copy agree on the window.
 */
export const SERVICE_TICKET_ARCHIVE_AFTER_DAYS = 7;

export const SERVICE_TICKET_CATEGORIES = [
  'Onboarding',
  'Endorsement',
  'Billing',
  'Claims Assist',
  'Renewal Review',
  'Other',
  'Policy Change',
  'Payment',
  'Company Transfer',
  'Save',
  'Termination',
  'Renewal Taken',
  // A quote in flight for a lead. Opened by "Start Quote" on the Household
  // page, never by hand — see `SERVICE_TICKET_CREATE_CATEGORIES`.
  'Quote',
] as const;
export type ServiceTicketCategory = (typeof SERVICE_TICKET_CATEGORIES)[number];

/**
 * Categories the "New Service Ticket" form offers — everything except `Quote`.
 *
 * A `Quote` ticket belongs to a lead and is opened by the Start Quote flow. A
 * hand-filed one would carry no `leadId`, and since a `Quote` ticket's status
 * follows its lead, one without a lead could never be resolved.
 *
 * `Onboarding` deliberately stays on the list: filing one by hand starts the
 * whole chain through `ServiceTicketsService.startOnboarding`, which is the
 * interim entry point until deal-audit approval calls it directly.
 */
export const SERVICE_TICKET_CREATE_CATEGORIES = SERVICE_TICKET_CATEGORIES.filter(
  (category): category is Exclude<ServiceTicketCategory, 'Quote'> =>
    category !== 'Quote',
);

export const SERVICE_TICKET_PRIORITIES = ['high', 'medium', 'low'] as const;
export type ServiceTicketPriority = (typeof SERVICE_TICKET_PRIORITIES)[number];

/**
 * Categories from which a CSR can record a **policy transfer** — a client
 * moving package or tier without any new business being written.
 *
 * These four are the conversations a transfer actually comes out of: a renewal
 * that came back too expensive, an explicit policy change, a payment problem
 * that ends in a cheaper tier, or a company transfer proper. Every other
 * category (Claims Assist, Onboarding, Billing…) either has nothing to do with
 * the policy line-up or is a chain that owns its own workflow.
 */
export const POLICY_TRANSFER_CATEGORIES = [
  'Renewal Review',
  'Policy Change',
  'Payment',
  'Company Transfer',
] as const satisfies readonly ServiceTicketCategory[];

export function allowsPolicyTransfer(category: ServiceTicketCategory): boolean {
  return (POLICY_TRANSFER_CATEGORIES as readonly string[]).includes(category);
}

/** One policy replaced by another, as summarized on the ticket. */
export interface PolicyTransferPair {
  fromPolicyId: string;
  fromPolicyNumber: string | null;
  fromPolicyType: string | null;
  fromPremium: number;
  toPolicyId: string;
  toPolicyNumber: string | null;
  toPolicyType: string | null;
  toPremium: number;
}

/**
 * The transfer booked from this ticket, summarizing the `Deal` it produced.
 *
 * Carried on the ticket rather than fetched separately because the panel needs
 * nothing else — unlike onboarding and renewal, whose panels read a parent
 * aggregate that keeps changing, a transfer is written once and never edited.
 */
export interface PolicyTransferRef {
  dealId: string;
  transferDate: string | null;
  /** Total premium of the new policies — what the Transfers scorecard counts. */
  premium: number;
  policyCount: number;
  /**
   * New premium minus old, so negative is a saving for the client. Null when a
   * from-policy no longer resolves.
   */
  premiumDelta: number | null;
  recordedByName: string;
  recordedAt: string;
  /** The generated hand-off checklist, or null if generation found no templates. */
  dealAuditId: string | null;
  pairs: PolicyTransferPair[];
}

/* -------------------------------------------------------------------------- *
 * Onboarding
 *
 * An onboarding is a client's journey through three calls. Each call is its own
 * service ticket with `category: 'Onboarding'` — completing one creates the
 * next — and an `Onboarding` record ties the chain together per client.
 *
 * Two things this is deliberately NOT:
 *   - Not a separate module or page. The tickets live in the normal queue.
 *   - Not a status. `SERVICE_TICKET_STATUSES` is untouched; a ticket's status
 *     is derived from its own step timing, so every consumer keeps working.
 *
 * A step is a *scheduled item*: it opens at `availableAt` and is due 48h later.
 * -------------------------------------------------------------------------- */

/** The onboarding calls, in the order they are worked. */
export const ONBOARDING_STEP_KEYS = [
  'welcome_call',
  'checkin_3day',
  'checkin_30day',
] as const;
export type OnboardingStepKey = (typeof ONBOARDING_STEP_KEYS)[number];

export const ONBOARDING_STEP_LABELS: Record<OnboardingStepKey, string> = {
  welcome_call: 'Welcome Call',
  checkin_3day: '3-Day Check-In',
  checkin_30day: '30-Day Check-In',
};

/** The step that ends the onboarding when completed. */
export const FINAL_ONBOARDING_STEP: OnboardingStepKey = 'checkin_30day';

/** The step that follows `stepKey`, or null if it is the last one. */
export function nextOnboardingStep(
  stepKey: OnboardingStepKey,
): OnboardingStepKey | null {
  const index = ONBOARDING_STEP_KEYS.indexOf(stepKey);
  if (index < 0 || index === ONBOARDING_STEP_KEYS.length - 1) {
    return null;
  }
  return ONBOARDING_STEP_KEYS[index + 1];
}

/**
 * What a step's timer counts from.
 *
 * `onboarding_start` pins a step to the beginning of the engagement (the deal
 * audit approval) so it cannot drift when earlier calls run late;
 * `previous_step` measures from the moment the preceding call was completed
 * ("three days after we last spoke").
 */
export const ONBOARDING_STEP_ANCHORS = [
  'onboarding_start',
  'previous_step',
] as const;
export type OnboardingStepAnchor = (typeof ONBOARDING_STEP_ANCHORS)[number];

/** Fallback SLA when a step definition does not specify one. */
export const DEFAULT_STEP_SLA_HOURS = 48;

export interface OnboardingStepDefinition {
  stepKey: OnboardingStepKey;
  sortOrder: number;
  anchor: OnboardingStepAnchor;
  /** Added to the anchor time. `0` means "as soon as the anchor is reached". */
  offsetMinutes: number;
  /** How long after becoming available the step is due. */
  slaMinutes: number;
}

const HOUR = 60;
const DAY = 24 * HOUR;

/**
 * Seed values for the `onboardingStepDefinitions` collection, which is the
 * runtime source of truth. Timing is config rather than code so it can be
 * retuned without a deploy — this array only bootstraps a fresh install.
 */
export const DEFAULT_ONBOARDING_STEP_DEFINITIONS: OnboardingStepDefinition[] = [
  {
    stepKey: 'welcome_call',
    sortOrder: 0,
    anchor: 'onboarding_start',
    offsetMinutes: 0,
    slaMinutes: DEFAULT_STEP_SLA_HOURS * HOUR,
  },
  {
    stepKey: 'checkin_3day',
    sortOrder: 1,
    anchor: 'previous_step',
    offsetMinutes: 3 * DAY,
    slaMinutes: DEFAULT_STEP_SLA_HOURS * HOUR,
  },
  {
    stepKey: 'checkin_30day',
    // Anchored to the start of the engagement, not the previous call: the
    // 30-day check-in is "one month in" and must not slip when the earlier
    // calls run late. The scheduler's max() still keeps it behind the 3-day
    // call, so a very late 3-day call pushes it out rather than opening two
    // tickets at once.
    sortOrder: 2,
    anchor: 'onboarding_start',
    offsetMinutes: 30 * DAY,
    slaMinutes: DEFAULT_STEP_SLA_HOURS * HOUR,
  },
];

/**
 * Things verified once about the client over the course of the onboarding.
 * These live on the `Onboarding` record, not on any one ticket — they describe
 * the client, not a single call.
 */
export const ONBOARDING_CHECKLIST_KEYS = [
  'mortgageeClauseVerified',
  'loanNumberVerified',
  'portalAccessVerified',
  'rulesOfEngagementSet',
  'googleReviewRequested',
] as const;
export type OnboardingChecklistKey = (typeof ONBOARDING_CHECKLIST_KEYS)[number];

export const ONBOARDING_CHECKLIST_LABELS: Record<
  OnboardingChecklistKey,
  string
> = {
  mortgageeClauseVerified: 'Mortgagee clause verified',
  loanNumberVerified: 'Loan number verified',
  portalAccessVerified: 'Portal access verified',
  rulesOfEngagementSet: 'Rules of engagement set',
  googleReviewRequested: 'Google review requested',
};

/**
 * Which checklist items belong to which call, so the panel shows only what is
 * on the agenda for the ticket in front of the CSR. The Google review is asked
 * for during the 30-day call rather than being its own step.
 */
export const ONBOARDING_STEP_CHECKLIST: Record<
  OnboardingStepKey,
  readonly OnboardingChecklistKey[]
> = {
  welcome_call: [
    'mortgageeClauseVerified',
    'loanNumberVerified',
    'portalAccessVerified',
    'rulesOfEngagementSet',
  ],
  checkin_3day: [],
  checkin_30day: ['googleReviewRequested'],
};

/**
 * Client touchpoints that are *recorded, never sent* — there is no mailer in
 * the system. Each key holds the ISO timestamp it was marked, or null.
 */
export const ONBOARDING_EMAIL_MILESTONE_KEYS = [
  'welcomeSent',
  'day3Sent',
  'day7Sent',
  'day30Sent',
] as const;
export type OnboardingEmailMilestoneKey =
  (typeof ONBOARDING_EMAIL_MILESTONE_KEYS)[number];

export const ONBOARDING_EMAIL_MILESTONE_LABELS: Record<
  OnboardingEmailMilestoneKey,
  string
> = {
  welcomeSent: 'Welcome email',
  day3Sent: 'Day 3 email',
  day7Sent: 'Day 7 email',
  day30Sent: 'Day 30 email',
};

/**
 * The onboarding payload carried by a single ticket: which call this is, when
 * it opens, when it is due. One ticket, one step.
 */
export interface OnboardingStepRef {
  /** The parent `Onboarding` record tying this ticket's chain together. */
  onboardingId: string;
  stepKey: OnboardingStepKey;
  label: string;
  /** 1-based position in the chain, for "Step 2 of 3". */
  sequence: number;
  totalSteps: number;
  /** When this call opens for work. */
  availableAt: string | null;
  dueAt: string | null;
  completedAt: string | null;
  completedBy: string | null;
  completedByName: string;
  /**
   * Server-computed: available now and not yet complete. The UI must use this
   * rather than comparing dates itself — the server clock is authoritative,
   * and a scheduled ticket is hidden from the queue until it flips true.
   */
  isActionable: boolean;
  /** Server-computed: incomplete and past `dueAt`. */
  isOverdue: boolean;
}

/** One link in the chain, as summarized on the parent record. */
export interface OnboardingChainStep {
  stepKey: OnboardingStepKey;
  label: string;
  sequence: number;
  /** Null until the step's ticket has been created. */
  ticketId: string | null;
  ticketNumber: string | null;
  availableAt: string | null;
  dueAt: string | null;
  completedAt: string | null;
  isActionable: boolean;
  isOverdue: boolean;
}

/**
 * A client's onboarding journey. Onboarding is tracked per client, so this —
 * not any one ticket — is what "the onboarding" means, and what completing the
 * final call closes.
 */
export interface OnboardingView {
  id: string;
  householdId: string;
  clientName: string;
  /** Warm-handoff reference: who sold the policy. */
  salesProducerName: string;
  /** The originating deal, or null for a hand-started onboarding. */
  dealId: string | null;
  dealAuditId: string | null;
  startedAt: string;
  /** The call currently in flight, or null once the onboarding is complete. */
  currentStepKey: OnboardingStepKey | null;
  completedAt: string | null;
  isComplete: boolean;
  checklist: Record<OnboardingChecklistKey, boolean>;
  emailMilestones: Record<OnboardingEmailMilestoneKey, string | null>;
  /** All three steps, whether or not their ticket exists yet. */
  chain: OnboardingChainStep[];
}

export const SERVICE_TICKET_ACTIVITY_TYPES = [
  'created',
  'note',
  'status',
  'system',
  'call',
  'email',
] as const;
export type ServiceTicketActivityType =
  (typeof SERVICE_TICKET_ACTIVITY_TYPES)[number];

/**
 * The subset of activity types a user can log manually from the ticket detail
 * view (an internal note, a phone call, or an email touchpoint).
 */
export const SERVICE_TICKET_NOTE_TYPES = ['note', 'call', 'email'] as const;
export type ServiceTicketNoteType = (typeof SERVICE_TICKET_NOTE_TYPES)[number];

export interface ServiceTicketActivity {
  id: string;
  type: ServiceTicketActivityType;
  author?: string;
  content: string;
  /** ISO timestamp of when the activity was recorded. */
  at: string;
  /** Human-friendly timestamp label for display (e.g. "Jun 9, 2026 — 9:14 AM"). */
  timestamp: string;
}

/**
 * The serialized service-ticket shape returned by the API and consumed by the
 * web app. Field names mirror the original mock UI so components need minimal
 * changes.
 */
export interface ServiceTicketView {
  id: string;
  ticketNumber: string;
  clientName: string;
  category: ServiceTicketCategory;
  status: ServiceTicketStatus;
  priority: ServiceTicketPriority;
  assignedRep: string;
  assignedUserId: string | null;
  /** Who opened the ticket. Set from the caller and never edited afterwards. */
  createdByUserId: string | null;
  createdByName: string;
  policyNumber: string;
  policyType: string;
  household: string;
  /**
   * Linked `Policy` record id, or null for tickets that only carry the
   * denormalized `policyNumber`/`policyType` display strings.
   */
  policyId: string | null;
  /** Linked `Household` record id, or null for display-string-only tickets. */
  householdId: string | null;
  /**
   * The `Lead` this ticket was opened for, or null for every ticket that is not
   * a quote in flight. Non-null is what makes `isStatusLocked` true.
   */
  leadId: string | null;
  /**
   * True when this ticket's status is owned by its lead rather than by the
   * person looking at it: the pickers must render a static badge, and
   * `PATCH /crm/service-tickets/:id/status` rejects with 400.
   *
   * Server-computed on purpose, for the same reason as
   * `OnboardingStepRef.isActionable` — the rule lives on the server and the UI
   * renders it, rather than each surface re-deriving `leadId !== null` and
   * drifting when the rule changes.
   */
  isStatusLocked: boolean;
  /**
   * The linked lead's status, so the workspace can say *why* the ticket is
   * still open without a second fetch.
   *
   * Only populated by the single-ticket read (`GET /crm/service-tickets/:id`).
   * List responses leave it null — filling it there would cost one lead read
   * per row, and no list surface displays it.
   */
  leadStatus: string | null;
  phone: string;
  email: string;
  /** Whole days since the ticket was opened. */
  daysOpen: number;
  /** Relative label for the last activity (e.g. "2 hours ago"). */
  lastActivity: string;
  openedAt: string;
  lastActivityAt: string;
  /** When the ticket was last moved to `resolved`, or null if it never was. */
  resolvedAt: string | null;
  /**
   * True once a resolved ticket is older than
   * `SERVICE_TICKET_ARCHIVE_AFTER_DAYS`. Archived tickets are excluded from the
   * default ticket list and surface in the Archived Tickets view instead.
   */
  isArchived: boolean;
  timeline: ServiceTicketActivity[];
  /**
   * This ticket's onboarding step, or null for every other category. `status`
   * above is derived from its timing when this is non-null.
   */
  onboarding: OnboardingStepRef | null;
  /**
   * This ticket's renewal-outreach call, or null for every other category.
   * Like `onboarding`, `status` above is derived from its timing when this is
   * non-null — and a ticket never carries both.
   */
  renewal: RenewalStepRef | null;
  /**
   * Whether this ticket's category allows a policy transfer to be recorded from
   * it — see {@link POLICY_TRANSFER_CATEGORIES}.
   *
   * Server-computed rather than re-derived per surface, for the same reason as
   * `isStatusLocked` above: the rule lives on the server and the UI renders it.
   */
  allowsPolicyTransfer: boolean;
  /**
   * The transfer already booked from this ticket, or null. Non-null is what
   * replaces the "Policy Transfer" action with the read-only summary panel —
   * one transfer per ticket, enforced by a unique index on the deal.
   */
  policyTransfer: PolicyTransferRef | null;
}

/**
 * A user who can be set as a ticket's Assigned Client Relation Manager. Served
 * by the tickets module itself so a CSR can populate the picker without the
 * `users:read` permission.
 */
export interface ServiceTicketAssignee {
  id: string;
  name: string;
  email: string;
  /** Role slugs the user holds, e.g. `csr` / `crm`. */
  roles: string[];
}

export interface ServiceTicketStats {
  openTickets: number;
  needsActionToday: number;
  upcomingRenewals: number;
  premiumIncreases: number;
  resolvedToday: number;
  dailyTarget: number;
  totalHouseholds: number;
  avgLobDensity: number;
}
