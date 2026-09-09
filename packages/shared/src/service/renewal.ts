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

import {
  ANNUAL_TERM_MONTHS,
  SEMIANNUAL_TERM_MONTHS,
  isSemiannualPolicyType,
  policyTermMonths,
} from '../domain/policy-type';
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
  annual: ANNUAL_TERM_MONTHS,
  semiannual: SEMIANNUAL_TERM_MONTHS,
};

/**
 * Fold a free-form policy type down to something comparable: trimmed,
 * lowercased, inner whitespace collapsed, and a trailing plural dropped so
 * "Autos" matches "Auto".
 *
 * Distinct from `domain/policy-type`'s `normalizePolicyType`, which resolves a
 * stored value to its **canonical label** ("Auto", "Condominium") and is what
 * read paths should use. This one produces a lowercase *comparison key* and
 * exists only so renewal-track matching tolerates the free-form spellings
 * sitting in `policies.policyType`.
 */
export function normalizeRenewalPolicyType(
  value: string | null | undefined,
): string {
  const normalized = (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  return normalized.endsWith('s') ? normalized.slice(0, -1) : normalized;
}

/**
 * Which track a policy renews on. Anything unrecognized is treated as annual.
 *
 * **Delegates to `domain/policy-type`'s {@link isSemiannualPolicyType}** rather
 * than keeping its own list, so the renewal cadence and the premium's `/6 mo`
 * label are the same decision and cannot drift.
 *
 * This used to match a hand-written `['auto']` against
 * {@link normalizeRenewalPolicyType}, which was wrong twice over: `Auto -
 * Special` and `Motorcycle` fell through to the annual T-90/T-45 track, and a
 * migrated row storing a raw SmartSuite code (`Zgsh3`) did too, because the
 * de-pluralizing key function does not resolve codes.
 */
export function renewalTrackFor(
  policyType: string | null | undefined,
): RenewalTrack {
  return isSemiannualPolicyType(policyType) ? 'semiannual' : 'annual';
}

/* -------------------------------------------------------------------------- *
 * The anchor — when a policy actually renews next
 * -------------------------------------------------------------------------- */

/**
 * Midnight UTC on the day `date` falls in.
 *
 * Renewals are calendar days, not instants: a policy renewing *today* has not
 * renewed "already" just because the clock has passed midnight. Comparing at
 * day granularity is what keeps {@link nextRenewalDate} from rolling a policy
 * a whole term forward on its own renewal day.
 */
function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

/**
 * `date` shifted by whole calendar months, clamped to the end of the target
 * month.
 *
 * `Date.setUTCMonth` **overflows** rather than clamping — 31 Jan + 1 month
 * lands on 2 or 3 March, not 28 February. Left alone that would walk a
 * month-end policy forward a day or two every term until its renewal date had
 * drifted into the following month.
 */
function addUtcMonths(date: Date, months: number): Date {
  const shifted = new Date(date.getTime());
  const dayOfMonth = date.getUTCDate();

  // Move to the 1st first, so the month shift itself can never overflow.
  shifted.setUTCDate(1);
  shifted.setUTCMonth(shifted.getUTCMonth() + months);

  // Day 0 of the *next* month is the last day of this one.
  const daysInTargetMonth = new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 0),
  ).getUTCDate();
  shifted.setUTCDate(Math.min(dayOfMonth, daysInTargetMonth));

  return shifted;
}

/**
 * A policy's next renewal on or after `now`, counted in whole terms from the
 * date coverage began.
 *
 * The term comes from {@link policyTermMonths} — 6 months for the auto family,
 * 12 for everything else — so this and the premium's `/6 mo` label are the same
 * decision and cannot drift.
 *
 * **Whole calendar months, always measured from the original anchor.** A policy
 * effective the 8th renews on the 8th, forever; adding `termMonths` repeatedly
 * to the *running* value would let a month-end clamp compound into permanent
 * drift. `30 * DAY` arithmetic would do the same, faster.
 *
 * Deterministic for a given `(anchor, policyType, now)`, which is what makes it
 * safe to recompute: `formatTermKey` derives a cycle's identity from this date,
 * so a value that wobbled by a day between runs would fork every cycle.
 *
 * Returns null for an unusable anchor — an invalid date, or one so far in the
 * past that a sane number of terms cannot reach the present. There is nothing
 * to count down to, and inventing a date would be worse than saying so.
 */
export function nextRenewalDate(
  anchor: Date | string | null | undefined,
  policyType: string | null | undefined,
  now: Date,
): Date | null {
  if (!anchor) return null;
  const start = anchor instanceof Date ? anchor : new Date(anchor);
  if (Number.isNaN(start.getTime())) return null;

  const termMonths = policyTermMonths(policyType);
  const today = startOfUtcDay(now);

  // 200 terms is 100 years on the annual track — far past any real policy, and
  // a bound that stops a nonsense anchor (year 1900, a bad parse) from spinning.
  const maxTerms = 200;
  for (let term = 0; term <= maxTerms; term += 1) {
    const candidate = addUtcMonths(startOfUtcDay(start), term * termMonths);
    if (candidate >= today) return candidate;
  }
  return null;
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

/**
 * How far ahead of its `availableAt` a scheduled call appears on the Proactive
 * Renewal Outreach desk.
 *
 * The desk used to show only calls that had already opened, which made the
 * outreach reactive in a panel named for the opposite: a T-45 call surfaced on
 * the morning it was due to start, with no chance to slot it into a week. Two
 * weeks of warning is enough to plan around and short enough that the desk
 * still reads as this fortnight's work.
 *
 * A previewed call is **not** actionable — `RenewalStepRef.isActionable` stays
 * false until `availableAt`, and `completeRenewalStep` refuses it — so this
 * only widens what is *shown*, never what can be done.
 */
export const RENEWAL_DESK_PREVIEW_DAYS = 14;

/**
 * The day proactive renewal outreach went live.
 *
 * Until the anchor backfill, `policies.renewalDate` held a migration artifact —
 * SmartSuite's Renewal Date column carried the *effective* date, so every value
 * was historical and no cycle was ever created. Deriving real renewal dates
 * makes the whole book eligible at once, and a book that has been running
 * un-serviced for months has calls whose ideal date passed long ago.
 *
 * Those are not work anyone can still do on time, and materializing them would
 * bury the CSR queue under years of retrospective calls on day one. So a step
 * more than {@link RENEWAL_BACKLOG_GRACE_DAYS} before this date is suppressed —
 * see `renewalStepsToOpen`.
 *
 * **Self-disarming.** Once the scan has been running, nothing is ever that
 * stale, so this stops applying on its own. It is a constant rather than config
 * because it describes something that happened once, on a specific day.
 */
export const RENEWAL_OUTREACH_CUTOVER = new Date('2026-09-08T00:00:00.000Z');

/**
 * How far before the cutover a call could open and still be worth making.
 *
 * A week: long enough that a renewal review missed over a single busy week is
 * still placed in front of a CSR, short enough that nothing genuinely
 * retrospective survives.
 */
export const RENEWAL_BACKLOG_GRACE_DAYS = 7;

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
  /**
   * Days until this call opens, or `null` once it has — the flag that separates
   * a previewed row (see {@link RENEWAL_DESK_PREVIEW_DAYS}) from one on the
   * plate today.
   *
   * Server-computed for the same reason `isActionable` is: the browser clock is
   * not authoritative, and a row that looks startable but 400s on submit is the
   * failure the whole serializer exists to avoid.
   */
  daysUntilAvailable: number | null;
  status: ServiceTicketStatus;
  isActionable: boolean;
  isOverdue: boolean;
  mergedFrom: RenewalStepKey[];
  outcome: RenewalOutcome | null;
}
