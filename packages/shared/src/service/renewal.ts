/**
 * Shared domain vocabulary for **proactive renewal outreach**.
 *
 * A policy renews on a fixed term, and the agency calls the client twice before
 * it does:
 *
 *   - **T-90 Annual Review** — a warm-up call. Prepare the client for coming
 *     changes and surface life changes (a new dependent, another house) that
 *     should be reflected in their coverage.
 *   - **T-45 Renewal Review** — the carrier has sent the revised plans and
 *     paperwork, so this is where the actual renewal is discussed. It ends one
 *     of exactly two ways: the client took the renewal, or is shopping around.
 *
 * **Auto policies renew every 6 months**, which leaves no room for a 90-day
 * warm-up — so on that track the two agendas merge into a single call at T-45.
 *
 * Two things this is deliberately NOT, mirroring onboarding:
 *   - Not a separate module or page. The tickets live in the normal queue under
 *     the existing `Renewal Review` category.
 *   - Not a status. `SERVICE_TICKET_STATUSES` is untouched; a renewal ticket's
 *     status is derived from its own step timing, so every consumer keeps
 *     working.
 *
 * Kept in its own file rather than growing `service-ticket.ts`, which is
 * already carrying the whole onboarding vocabulary. The dependency runs one
 * way: `service-ticket.ts` imports `RenewalStepRef` from here, never the
 * reverse.
 */

import type { ServiceTicketStatus } from './service-ticket';

/* -------------------------------------------------------------------------- *
 * Tracks — the cadence a policy renews on
 * -------------------------------------------------------------------------- */

/**
 * Named after the *cadence*, not the line of business. "Auto" is a mapping into
 * `semiannual`, not a track of its own — which is what keeps the 6-month rule
 * from hardening into a check on one policy type.
 */
export const RENEWAL_TRACKS = ['annual', 'semiannual'] as const;
export type RenewalTrack = (typeof RENEWAL_TRACKS)[number];

export const RENEWAL_TERM_MONTHS: Record<RenewalTrack, number> = {
  annual: 12,
  semiannual: 6,
};

/**
 * Policy types that renew on a 6-month term, normalized (see
 * `normalizePolicyType`). `Policy.policyType` is a free-form string — the seeds
 * alone contain Auto, Home, Life, Umbrella and Renters — so this is a value
 * match, not an enum lookup.
 *
 * **Extending this array is the only change needed to add another 6-month
 * line.** There is deliberately no `if (policyType === 'Auto')` anywhere in the
 * codebase.
 */
export const SEMIANNUAL_POLICY_TYPES: readonly string[] = ['auto'];

/**
 * Fold a free-form policy type down to something comparable: trimmed,
 * lowercased, inner whitespace collapsed, and a trailing plural dropped so
 * "Autos" matches "Auto".
 */
export function normalizePolicyType(value: string | null | undefined): string {
  const normalized = (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  return normalized.endsWith('s') ? normalized.slice(0, -1) : normalized;
}

/** Which track a policy renews on. Anything unrecognized is treated as annual. */
export function renewalTrackFor(
  policyType: string | null | undefined,
): RenewalTrack {
  return SEMIANNUAL_POLICY_TYPES.includes(normalizePolicyType(policyType))
    ? 'semiannual'
    : 'annual';
}

/* -------------------------------------------------------------------------- *
 * Steps — the calls themselves
 * -------------------------------------------------------------------------- */

export const RENEWAL_STEP_KEYS = ['annual_review', 'renewal_review'] as const;
export type RenewalStepKey = (typeof RENEWAL_STEP_KEYS)[number];

export const RENEWAL_STEP_LABELS: Record<RenewalStepKey, string> = {
  annual_review: 'Annual Review Call',
  renewal_review: 'Renewal Review Call',
};

/** Talking points, so a merged call can carry both calls' agendas. */
export const RENEWAL_AGENDA_KEYS = [
  'life_changes',
  'coverage_review',
  'carrier_changes',
  'paperwork_reviewed',
  'renewal_decision',
] as const;
export type RenewalAgendaKey = (typeof RENEWAL_AGENDA_KEYS)[number];

export const RENEWAL_AGENDA_LABELS: Record<RenewalAgendaKey, string> = {
  life_changes: 'Major life changes since last term',
  coverage_review: 'Coverage still fits the household',
  carrier_changes: "Carrier's changes for the coming term",
  paperwork_reviewed: 'Renewal paperwork walked through',
  renewal_decision: 'Renewal decision captured',
};

/**
 * What a renewal step's timing is measured from. Unlike onboarding — which
 * counts *forward* from the start of the engagement — a renewal counts
 * **backward** from a date the carrier owns, so there is one anchor and the
 * offsets are negative.
 */
export const RENEWAL_STEP_ANCHORS = ['renewal_date'] as const;
export type RenewalStepAnchor = (typeof RENEWAL_STEP_ANCHORS)[number];

/** How long a renewal call stays on time once it opens. */
export const DEFAULT_RENEWAL_SLA_HOURS = 48;

export interface RenewalStepDefinition {
  track: RenewalTrack;
  stepKey: RenewalStepKey;
  sortOrder: number;
  anchor: RenewalStepAnchor;
  /** **Negative** — minutes *before* the renewal date that the call opens. */
  offsetMinutes: number;
  /** Added to `availableAt` to get the due date. */
  slaMinutes: number;
  /** What this call covers. The merged auto call carries both agendas. */
  agendaKeys: readonly RenewalAgendaKey[];
  /**
   * Steps this one absorbs — `['annual_review']` on the auto track's single
   * call. This is how the 6-month exception is expressed as *data*: nothing
   * branches on the track to decide how many calls to make, it just reads the
   * definitions.
   */
  mergedFrom: readonly RenewalStepKey[];
}

const HOUR = 60;
const DAY = 24 * HOUR;

/**
 * Seed values for the `renewalStepDefinitions` collection, which is the runtime
 * source of truth. Timing is config rather than code so an agency can retune
 * its cadence without a deploy — this array only bootstraps a fresh install.
 *
 * The auto track deliberately reuses the `renewal_review` step key rather than
 * inventing a third one. That is what lets "the outcome is recorded on the
 * renewal_review step" hold on both tracks with no special-casing.
 */
export const DEFAULT_RENEWAL_STEP_DEFINITIONS: RenewalStepDefinition[] = [
  {
    track: 'annual',
    stepKey: 'annual_review',
    sortOrder: 0,
    anchor: 'renewal_date',
    offsetMinutes: -90 * DAY,
    slaMinutes: DEFAULT_RENEWAL_SLA_HOURS * HOUR,
    agendaKeys: ['life_changes', 'coverage_review'],
    mergedFrom: [],
  },
  {
    track: 'annual',
    stepKey: 'renewal_review',
    sortOrder: 1,
    anchor: 'renewal_date',
    offsetMinutes: -45 * DAY,
    slaMinutes: DEFAULT_RENEWAL_SLA_HOURS * HOUR,
    agendaKeys: ['carrier_changes', 'paperwork_reviewed', 'renewal_decision'],
    mergedFrom: [],
  },
  {
    // Auto renews every 6 months, so a 90-day warm-up would land before the
    // previous term was even half over. Both agendas merge into ONE call.
    track: 'semiannual',
    stepKey: 'renewal_review',
    sortOrder: 0,
    anchor: 'renewal_date',
    offsetMinutes: -45 * DAY,
    slaMinutes: DEFAULT_RENEWAL_SLA_HOURS * HOUR,
    agendaKeys: [
      'life_changes',
      'coverage_review',
      'carrier_changes',
      'paperwork_reviewed',
      'renewal_decision',
    ],
    mergedFrom: ['annual_review'],
  },
];

/* -------------------------------------------------------------------------- *
 * Outcome
 * -------------------------------------------------------------------------- */

/**
 * How a renewal review ends. Exactly two, per the owner: the client either took
 * the renewal or is going out to shop it.
 *
 * Recorded once for the whole call, not per policy — a renewal ticket covers a
 * deal, and the deal is what the client is deciding about.
 */
export const RENEWAL_OUTCOMES = ['took_renewal', 'shopping'] as const;
export type RenewalOutcome = (typeof RENEWAL_OUTCOMES)[number];

export const RENEWAL_OUTCOME_LABELS: Record<RenewalOutcome, string> = {
  took_renewal: 'Took the renewal',
  shopping: 'Shopping around',
};

/** Why a cycle stopped being live. `completed` is the only happy path. */
export const RENEWAL_CLOSED_REASONS = [
  'completed',
  'superseded',
  'policy_ineligible',
  'lapsed',
] as const;
export type RenewalClosedReason = (typeof RENEWAL_CLOSED_REASONS)[number];

/* -------------------------------------------------------------------------- *
 * Read models
 * -------------------------------------------------------------------------- */

/** One policy on the cycle's checklist — what the CSR must cover on the call. */
export interface RenewalPolicyItem {
  policyId: string;
  policyNumber: string;
  policyType: string;
  carrier: string;
  premium: number;
  renewalDate: string | null;
  /** When it was ticked off as discussed, or null. */
  discussedAt: string | null;
  discussedByName: string;
}

/**
 * A renewal cycle's step as carried by one ticket.
 *
 * Field names deliberately mirror `OnboardingStepRef` so the ticket-feed row
 * and the urgency sort can treat either payload as "the scheduled step this
 * ticket carries" without knowing which kind it is.
 */
export interface RenewalStepRef {
  /** The parent `RenewalCycle` this ticket belongs to. */
  renewalCycleId: string;
  stepKey: RenewalStepKey;
  label: string;
  track: RenewalTrack;
  /** 1-based position, for "Step 1 of 2". */
  sequence: number;
  /**
   * How many calls this cycle has — **1 on the auto track, 2 otherwise**. Unlike
   * onboarding, where it is the constant `ONBOARDING_STEP_KEYS.length`, this
   * varies by track and is therefore stored rather than computed.
   */
  totalSteps: number;
  /** The carrier's renewal date this cycle is counting down to. */
  renewalDate: string;
  /** Server-computed whole days until `renewalDate`; negative once past. */
  daysUntilRenewal: number;
  availableAt: string | null;
  dueAt: string | null;
  completedAt: string | null;
  completedBy: string | null;
  completedByName: string;
  /**
   * Server-computed: available now and not yet complete. The UI must use this
   * rather than comparing dates itself — the server clock is authoritative,
   * and a scheduled call is hidden from the queue until it flips true.
   */
  isActionable: boolean;
  /** Server-computed: incomplete and past `dueAt`. */
  isOverdue: boolean;
  agendaKeys: RenewalAgendaKey[];
  /** `['annual_review']` on the merged auto call; empty otherwise. */
  mergedFrom: RenewalStepKey[];
  outcome: RenewalOutcome | null;
  outcomeAt: string | null;
  /**
   * Whether completing this call demands an outcome. Server-computed so the
   * auto-merge rule never has to be re-derived in the browser.
   */
  requiresOutcome: boolean;
}

/** One call in the cycle, as summarized on the parent record. */
export interface RenewalChainStep {
  stepKey: RenewalStepKey;
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
 * One deal's outreach for one renewal term. This — not any single ticket — is
 * what "the renewal" means: the policy checklist and the outcome live here.
 */
export interface RenewalCycleView {
  id: string;
  /** `deal:<id>`, or `household:<id>` for policies with no deal. */
  groupKey: string;
  dealId: string | null;
  householdId: string | null;
  clientName: string;
  householdName: string;
  track: RenewalTrack;
  /** UTC `yyyy-mm-dd` of the anchor date at creation. The cycle's identity. */
  termKey: string;
  /** The current anchor, which can drift from `termKey` if a carrier moves it. */
  renewalDate: string;
  daysUntilRenewal: number;
  /** The call currently in flight, or null once the outreach is done. */
  currentStepKey: RenewalStepKey | null;
  completedAt: string | null;
  isComplete: boolean;
  closedReason: RenewalClosedReason | null;
  outcome: RenewalOutcome | null;
  outcomeAt: string | null;
  outcomeByName: string;
  outcomeNote: string;
  /** Every policy renewing in this cycle — the call's checklist. */
  policies: RenewalPolicyItem[];
  /** Both calls (or the single merged one), whether or not their ticket exists. */
  chain: RenewalChainStep[];
}

/**
 * One row of the Proactive Renewal Outreach desk: the currently-actionable call
 * for a cycle, flattened with just enough context to render without a second
 * request.
 *
 * Note there is no premium-change field. `Policy.premium` is a single current
 * number and the system holds no premium history, so an increase cannot be
 * computed — the desk shows the renewal window and the call, nothing invented.
 */
export interface RenewalDeskRow {
  cycleId: string;
  ticketId: string | null;
  ticketNumber: string | null;
  stepKey: RenewalStepKey;
  label: string;
  track: RenewalTrack;
  clientName: string;
  householdId: string | null;
  householdName: string;
  /** How many policies this one call has to cover. */
  policyCount: number;
  policies: RenewalPolicyItem[];
  renewalDate: string;
  daysUntilRenewal: number;
  availableAt: string | null;
  dueAt: string | null;
  status: ServiceTicketStatus;
  isActionable: boolean;
  isOverdue: boolean;
  mergedFrom: RenewalStepKey[];
  outcome: RenewalOutcome | null;
}
