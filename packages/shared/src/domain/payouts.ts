import { carrierSlug, normalizeCarrier } from './carrier';
import type { ChargebackReason, ChargebackSource } from './chargeback';

/**
 * Payouts (PAC-176) — payment structures and the agency's payout settings.
 *
 * The wire contract between `/payouts/*` and the Payouts settings page, plus
 * the rules both sides validate with. Statements, the calculation and the
 * chargeback import build on these in later sub-stories (PAC-178…182).
 *
 * ## A payment structure
 *
 * A structure is **a set of pay rules plus the people on it** — the shape the
 * HR time-off policies use (PAC-161): different pay for different people is
 * another structure, never a per-person override. Its rules:
 *
 * - **Rates** — a commission percentage per carrier, plus at most one rate
 *   for "any other carrier" ({@link ANY_CARRIER}). Premium is bucketed per
 *   carrier and each bucket is paid at its own rate. A rate may also carry a
 *   **minimum bundle rate** the person must keep on that carrier; missing it
 *   **flags** the statement for the manager and changes no pay (owner, 5 Nov
 *   2026 — see {@link PAYOUT_BUNDLE_MIN_POLICIES} and {@link bundleMinimumFor}).
 * - **Lead-source rates** — optional overrides: sales from a given lead source
 *   are paid a different rate, for one carrier or for any carrier
 *   ({@link LeadSourceRateRule}). An override **replaces** the carrier rate
 *   for those sales; it changes nothing else — every sale's premium still
 *   counts toward tiers, Salesperson of the Month and the team threshold
 *   (owner, 4 Nov 2026: Jessica Yates is paid one rate on JYA leads and
 *   another on everything else). {@link rateFor} is the precedence.
 * - **Hat trick** — a bonus for every agency-local day on which the person
 *   books at least `dealsPerDay` sales (David: three sales in a day is $50).
 * - **Monthly tiers** — sell at least `thresholdPremium` in the month and
 *   earn `bonusAmount`. Not stackable: the highest tier reached pays.
 *   Stackable (`tiersStackable`): every tier reached pays and the amounts add
 *   up ({@link tierBonusFor}).
 * - **Team bonus** — whether the structure's members share the agency-wide
 *   team pool ({@link TeamBonusSettings}), which has levels that may stack
 *   the same way.
 *
 * A person is on **at most one** active structure. Adding them to another
 * moves them, as enrolling in a second holiday policy does.
 *
 * ## Money
 *
 * Every amount is US dollars as a number with at most two decimals, and every
 * percentage is 0–100 with at most two decimals. Nothing here is a float that
 * a later step might round differently: the validators refuse a third
 * decimal so that what the owner typed is what the statement computes with.
 */

/** The rate rule that covers every carrier without a rule of its own. */
export const ANY_CARRIER = '*';

export const PAYMENT_STRUCTURE_STATUSES = ['active', 'archived'] as const;
export type PaymentStructureStatus =
  (typeof PAYMENT_STRUCTURE_STATUSES)[number];

export const PAYMENT_STRUCTURE_NAME_MAX_LENGTH = 80;
export const MAX_RATE_RULES = 50;
export const MAX_BONUS_TIERS = 20;
/** Upper bound on any single amount the owner types: a guard against a slipped key, not a policy. */
export const MAX_PAYOUT_AMOUNT = 10_000_000;
export const MIN_HAT_TRICK_DEALS = 2;
export const MAX_HAT_TRICK_DEALS = 20;

/** 409 when another active structure already has the name. */
export const PAYMENT_STRUCTURE_NAME_TAKEN = 'PAYMENT_STRUCTURE_NAME_TAKEN';

/**
 * 409 when an update's `expectedUpdatedAt` is not the structure's stored
 * `updatedAt`: it was saved somewhere else — another tab, another person, or
 * a save of another structure that moved one of its members — since the page
 * loaded it. Saving anyway would silently undo that change.
 */
export const PAYMENT_STRUCTURE_STALE = 'PAYMENT_STRUCTURE_STALE';

// ── Rules ───────────────────────────────────────────────────────────────

export interface RateRule {
  /** A carrier's display name, or {@link ANY_CARRIER}. */
  carrier: string;
  /** 0–100. */
  ratePercent: number;
  /**
   * The bundle rate (0–100, more than 0) the person must keep on this
   * carrier's sales in the month; `null` or absent when not enforced. Missing
   * it flags the statement — pay is not changed (owner, 5 Nov 2026). On the
   * "any other carrier" rule it applies to each carrier that rule covers,
   * checked separately. Views always send it (`null` when off).
   */
  minBundleRatePercent?: number | null;
  /**
   * What the rate's {@link steps} are measured on (2026 comp plans): the
   * person's sold premium for the month, or their month-end retention (a
   * figure the manager enters on the statement). Absent = `premium`.
   */
  stepBasis?: RateStepBasis;
  /**
   * The rate **steps up** as the month's measure rises: the highest step
   * reached whose gates are met replaces `ratePercent` for **all** of the
   * month's premium on this rule (not split-rate — the Inside Sales plan:
   * "the applicable commission percentage is applied to the full amount
   * sold"). `ratePercent` is the base: below the first step, and what a
   * person below their structure's compliance floor is paid. Absent or `[]`
   * = a flat rate.
   */
  steps?: RateStep[];
}

// ── 2026 comp plans (6 Nov 2026) ────────────────────────────────────────
//
// David's pay plans (Inside Sales, Outside Sales, Client Relations Manager,
// Office Manager) need more than a flat rate per carrier. The additions are
// all optional parts of a structure; a structure without them pays exactly as
// before. The engine is `payout-math.ts`; the rules are on the PAC-176 epic.

/** What a rate's steps are measured on. */
export const RATE_STEP_BASES = ['premium', 'retention'] as const;
export type RateStepBasis = (typeof RATE_STEP_BASES)[number];

export const MAX_RATE_STEPS = 10;

/**
 * One step of a stepped rate: reach `threshold` (dollars of premium, or a
 * retention percentage) and the rule pays `ratePercent` on all its premium.
 * A step may also pay a one-off `bonusAmount` (the Client Relations
 * Manager's $500 at 90% retention), and may be **gated**: it counts only
 * when the person's compliance rate and overall bundle rate meet the
 * minimums (Outside Sales' 15% needs 95% compliance and an 83% bundle rate).
 * A step whose gate is not met is skipped, and the highest step below it that
 * is met applies.
 */
export interface RateStep {
  threshold: number;
  ratePercent: number;
  bonusAmount: number;
  /** `null` = no compliance gate. */
  minCompliancePercent: number | null;
  /** `null` = no bundle gate. The person's overall bundle rate, all carriers. */
  minBundleRatePercent: number | null;
}

/**
 * The 2026 plan's compliance floor: below `minimumPercent` (the rate the
 * manager enters on the statement), the person gets no Sales of the Month,
 * hat trick, team bonus or tier bonuses, is paid every rate at its base, and
 * loses `reductionPercent` of their variable pay. Base pay and stipends are
 * not reduced.
 */
export interface ComplianceFloor {
  minimumPercent: number;
  reductionPercent: number;
}

/**
 * Pay on premium other people sold.
 *
 * - `agency` — a percentage of every sale in the agency on `carrier` ("any"
 *   for all), the person's own included: the Office Manager's 1% on all
 *   premium sold in the office, whatever the source.
 * - `lead_source` — a percentage of premium **other people** sold from one
 *   lead source: Outside Sales' 1% on overflow leads they handed to Inside
 *   Sales, tagged with their own lead source.
 */
export const OVERRIDE_BASES = ['agency', 'lead_source'] as const;
export type OverrideBasis = (typeof OVERRIDE_BASES)[number];

export interface OverrideRule {
  basis: OverrideBasis;
  /** Set for `lead_source`, `null` for `agency`. */
  leadSourceId: string | null;
  /** A carrier's name, or {@link ANY_CARRIER}. */
  carrier: string;
  ratePercent: number;
}

export interface OverrideRuleView extends OverrideRule {
  leadSourceName: string | null;
}

export const MAX_OVERRIDE_RULES = 10;

/**
 * The Client Relations Manager's life referrals: fewer than `minimum` valid
 * referrals in the month costs `shortfallDeduction`; `bonusThreshold` or more
 * (when set) earns `bonusAmount`. The count is entered on the statement.
 */
export interface ReferralRule {
  minimum: number;
  shortfallDeduction: number;
  bonusThreshold: number | null;
  bonusAmount: number;
}

/**
 * Extra conditions for the team bonus (Client Relations Manager plan): every
 * sale of the month entered within `soldLogWithinDays` days of its sold date
 * (`null` = not required), and on-time attendance at sales meetings (ticked
 * by the manager on the statement). Not met = no share of the pool.
 */
export interface TeamRequirements {
  soldLogWithinDays: number | null;
  meetingAttendance: boolean;
}

export const DEFAULT_TEAM_REQUIREMENTS: TeamRequirements = {
  soldLogWithinDays: null,
  meetingAttendance: false,
};

/** When a member started, for the stipend schedule: month 1 is `startMonth`. */
export interface MemberStart {
  userId: string;
  /** `YYYY-MM`. */
  startMonth: string;
}

export const MAX_STIPEND_MONTHS = 12;
export const MAX_SOLD_LOG_DAYS = 31;
export const MAX_CHARGEBACK_WINDOW_MONTHS = 36;
export const MAX_REFERRAL_COUNT = 1_000;

/**
 * The figures the app cannot know, entered by the manager on each draft:
 * the compliance rate, month-end retention, valid life referrals, and
 * whether the person attended the sales meetings. `null` = not entered. A
 * gate that needs a figure is **not met** until it is entered (pay is not
 * unlocked on a guess); a penalty is applied only from an entered figure.
 */
export interface StatementInputs {
  compliancePercent: number | null;
  retentionPercent: number | null;
  lifeReferrals: number | null;
  meetingAttendance: boolean | null;
}

export const EMPTY_STATEMENT_INPUTS: StatementInputs = {
  compliancePercent: null,
  retentionPercent: null,
  lifeReferrals: null,
  meetingAttendance: null,
};

/** Which {@link StatementInputs} a structure reads — the ones the page asks for. */
export interface StatementInputsNeeded {
  compliance: boolean;
  retention: boolean;
  referrals: boolean;
  attendance: boolean;
}

/**
 * Producer of the Year (2026 plan): a bonus on the December statement to the
 * year's top producer by sold premium who was compliant — an entered
 * compliance rate of at least `minCompliancePercent` — in at least
 * `minCompliantMonths` months of the year.
 */
export interface ProducerOfYearSettings {
  enabled: boolean;
  bonusAmount: number;
  minCompliantMonths: number;
  minCompliancePercent: number;
}

export const DEFAULT_PRODUCER_OF_YEAR: ProducerOfYearSettings = {
  enabled: false,
  bonusAmount: 0,
  minCompliantMonths: 9,
  minCompliancePercent: 95,
};

/**
 * A **bundle** is a sale with at least this many policies, whatever they are
 * and whichever carriers they are with — two household policies, auto + home,
 * and so on (owner, 5 Nov 2026). Deliberately **not** `Deal.isBundle`, which
 * means auto + property on one sale.
 *
 * A person's bundle rate on a carrier for a month is: of their sales that
 * month including a policy with that carrier, the share that are bundles.
 * A sale of Allstate auto + Progressive home is a bundle for both carriers.
 */
export const PAYOUT_BUNDLE_MIN_POLICIES = 2;

/**
 * A lead-source rate override: sales whose lead came from `leadSourceId` are
 * paid `ratePercent` instead of the carrier rate — for one carrier, or for
 * any carrier ({@link ANY_CARRIER}).
 *
 * **One lead source per rule.** "Mail-JYA" is its own `leadSources` row and
 * needs its own rule; whether a source pays differently by carrier is the
 * owner's choice, rule by rule. The source is referenced by id and its name
 * resolved on read, never stored (AGENTS.md, PAC-135).
 */
export interface LeadSourceRateRule {
  /** A `leadSources` row: the agency's own, or a platform row. */
  leadSourceId: string;
  /** A carrier's display name, or {@link ANY_CARRIER} for every carrier. */
  carrier: string;
  /** 0–100. */
  ratePercent: number;
}

/** A lead-source rule as the API serves it, with the source's name. */
export interface LeadSourceRateRuleView extends LeadSourceRateRule {
  /**
   * The source's name, archived sources included — an old rule still says
   * where its sales come from. `''` only for an id with no row at all.
   */
  leadSourceName: string;
}

/**
 * Which rule set a premium's rate came from, most specific first: a
 * lead-source rule naming the carrier, a lead-source rule for any carrier,
 * the carrier's own rate, the "any other carrier" rate.
 */
export const RATE_SOURCES = [
  'lead_source_carrier',
  'lead_source',
  'carrier',
  'any',
] as const;
export type RateSource = (typeof RATE_SOURCES)[number];

export interface ResolvedRate {
  ratePercent: number;
  source: RateSource;
}

export interface HatTrickRule {
  enabled: boolean;
  /** Sales on one agency-local day that earn the bonus. */
  dealsPerDay: number;
  bonusAmount: number;
}

export interface BonusTier {
  thresholdPremium: number;
  bonusAmount: number;
  /**
   * The tier pays only with an entered compliance rate at least this high
   * (Inside Sales' $1,500 at $100,000 needs good standing); `null` or absent =
   * no gate. Used on a structure's monthly tiers only.
   */
  minCompliancePercent?: number | null;
}

export const DEFAULT_HAT_TRICK: HatTrickRule = {
  enabled: true,
  dealsPerDay: 3,
  bonusAmount: 50,
};

// ── Agency settings ─────────────────────────────────────────────────────

/** One level of the team bonus: agency premium reached → pool paid out. */
export interface TeamBonusLevel {
  thresholdPremium: number;
  poolAmount: number;
}

/**
 * The agency-wide team bonus. Each level whose `thresholdPremium` the
 * agency's sold premium for the month reaches pays its `poolAmount`:
 * **stackable**, every level reached pays and the pools add up ($300,000 →
 * $3,000 and $350,000 → another $3,000 is $6,000 at $360,000); not stackable,
 * only the highest level reached pays ({@link teamPoolFor}). The pool is split
 * `csrSharePercent` among CSRs and `producerSharePercent` among producers,
 * each person by their share of their group's premium. Only members of a
 * structure with `teamBonusEligible` take part.
 */
export interface TeamBonusSettings {
  enabled: boolean;
  stackable: boolean;
  /** Lowest threshold first. At least one while `enabled`. */
  levels: TeamBonusLevel[];
  csrSharePercent: number;
  producerSharePercent: number;
}

/** A fixed bonus for the month's top seller (the Commission Statement's "SOM"). */
export interface SalespersonOfMonthSettings {
  enabled: boolean;
  bonusAmount: number;
}

export const DEFAULT_TEAM_BONUS: TeamBonusSettings = {
  enabled: false,
  stackable: false,
  levels: [{ thresholdPremium: 300_000, poolAmount: 0 }],
  csrSharePercent: 20,
  producerSharePercent: 80,
};

export const DEFAULT_SALESPERSON_OF_MONTH: SalespersonOfMonthSettings = {
  enabled: false,
  bonusAmount: 0,
};

export interface PayoutSettingsView {
  teamBonus: TeamBonusSettings;
  salespersonOfMonth: SalespersonOfMonthSettings;
  producerOfYear: ProducerOfYearSettings;
}

/** Any section may be sent alone; a section that is sent is sent whole. */
export interface UpdatePayoutSettingsInput {
  teamBonus?: TeamBonusSettings;
  salespersonOfMonth?: SalespersonOfMonthSettings;
  producerOfYear?: ProducerOfYearSettings;
}

// ── Structures over the wire ────────────────────────────────────────────

export type PayoutPersonStatus = 'active' | 'invited' | 'deactivated';

export interface PaymentStructureMemberView {
  id: string;
  name: string;
  email: string;
  /** Role names, for display. */
  roles: string[];
  status: PayoutPersonStatus;
}

export interface PaymentStructureSummary {
  id: string;
  name: string;
  status: PaymentStructureStatus;
  rules: RateRule[];
  /**
   * Overrides of `rules` for sales from particular lead sources, by source
   * name and then carrier ("any carrier" last). Empty for most structures.
   */
  leadSourceRules: LeadSourceRateRuleView[];
  hatTrick: HatTrickRule;
  individualTiers: BonusTier[];
  /** Every tier reached pays (amounts add up), rather than only the highest. */
  tiersStackable: boolean;
  teamBonusEligible: boolean;
  /** Monthly base pay, on every member's statement. `0` = none. */
  basePay: number;
  /**
   * A stipend by month of the member's start (the Outside Sales "Launch
   * Pad"): month 1 pays `stipendAmounts[0]`, and so on; `[]` = none.
   */
  stipendAmounts: number[];
  /** Members' start months, for the stipend. */
  memberStarts: MemberStart[];
  complianceFloor: ComplianceFloor | null;
  overrides: OverrideRuleView[];
  /**
   * A personal bonus measured on the **agency's** sold premium on
   * {@link agencyTiersCarrier} (the Office Manager's production bonus on
   * total Allstate premium): the highest tier reached pays.
   */
  agencyTiers: BonusTier[];
  /** A carrier's name, or {@link ANY_CARRIER} for all premium. */
  agencyTiersCarrier: string;
  teamRequirements: TeamRequirements;
  referralRule: ReferralRule | null;
  /**
   * A chargeback counts only within this many months of the cancellation
   * (Client Relations Manager plan: six); `null` = no limit.
   */
  chargebackWindowMonths: number | null;
  /** Members who have not been removed from the agency. */
  memberCount: number;
  /** ISO-8601. */
  createdAt: string;
  updatedAt: string;
}

export interface PaymentStructureView extends PaymentStructureSummary {
  members: PaymentStructureMemberView[];
}

export interface PaymentStructuresResponse {
  /** Active structures, by name. */
  structures: PaymentStructureSummary[];
}

/** Who can be put on a structure, and where each person is today. */
export interface PayoutPersonView extends PaymentStructureMemberView {
  branchName: string | null;
  /** The active structure the person is on, if any. */
  structure: { id: string; name: string } | null;
}

export interface PayoutPeopleResponse {
  people: PayoutPersonView[];
}

export interface UpsertPaymentStructureInput {
  name: string;
  rules: RateRule[];
  /** The whole override list, replacing the stored one; `[]` for none. */
  leadSourceRules: LeadSourceRateRule[];
  hatTrick: HatTrickRule;
  individualTiers: BonusTier[];
  tiersStackable: boolean;
  teamBonusEligible: boolean;
  /** The whole member list, replacing the stored one. */
  memberIds: string[];
  // The 2026 comp-plan parts: each optional, and left out = none.
  basePay?: number;
  stipendAmounts?: number[];
  /** Only members' entries are kept. */
  memberStarts?: MemberStart[];
  complianceFloor?: ComplianceFloor | null;
  overrides?: OverrideRule[];
  agencyTiers?: BonusTier[];
  agencyTiersCarrier?: string;
  teamRequirements?: TeamRequirements;
  referralRule?: ReferralRule | null;
  chargebackWindowMonths?: number | null;
}

/**
 * `PATCH /payouts/structures/:id`: the whole structure plus the `updatedAt`
 * of the copy it was edited from (ISO-8601, as the API served it). A
 * mismatch is a 409 {@link PAYMENT_STRUCTURE_STALE}.
 */
export type UpdatePaymentStructureInput = UpsertPaymentStructureInput & {
  expectedUpdatedAt: string;
};

// ── Rules: pure helpers ─────────────────────────────────────────────────

/** True for a finite number with at most two decimals. */
export function hasAtMostTwoDecimals(value: number): boolean {
  if (!Number.isFinite(value)) return false;
  const cents = value * 100;
  return Math.abs(cents - Math.round(cents)) < 1e-6;
}

/** Why a dollar amount cannot be stored, or `null` when it can. */
export function amountError(value: number, label: string): string | null {
  if (!Number.isFinite(value)) return `${label} must be a number.`;
  if (value < 0) return `${label} cannot be negative.`;
  if (value > MAX_PAYOUT_AMOUNT) {
    return `${label} cannot be more than $${MAX_PAYOUT_AMOUNT.toLocaleString('en-US')}.`;
  }
  if (!hasAtMostTwoDecimals(value))
    return `${label} has more than two decimals.`;
  return null;
}

/** Why a percentage cannot be stored, or `null` when it can. */
export function percentError(value: number, label: string): string | null {
  if (!Number.isFinite(value)) return `${label} must be a number.`;
  if (value < 0 || value > 100) return `${label} must be between 0 and 100.`;
  if (!hasAtMostTwoDecimals(value))
    return `${label} has more than two decimals.`;
  return null;
}

/**
 * The key two rate rules collide on: the carrier's canonical name, slugged —
 * so "Allstate", " allstate " and the migrated code `B4tEH` are one carrier.
 */
export function rateRuleKey(carrier: string): string {
  const trimmed = carrier.trim();
  if (trimmed === ANY_CARRIER) return ANY_CARRIER;
  return carrierSlug(normalizeCarrier(trimmed));
}

/** Why a structure's rate rules cannot be stored, or `null` when they can. */
export function rateRulesError(rules: readonly RateRule[]): string | null {
  if (rules.length === 0) return 'Add at least one commission rate.';
  if (rules.length > MAX_RATE_RULES) {
    return `A structure has at most ${MAX_RATE_RULES} rates.`;
  }
  /** Key → the carrier's name as first given, for the duplicate message. */
  const seen = new Map<string, string>();
  for (const rule of rules) {
    const key = rateRuleKey(rule.carrier);
    if (!key) return 'Every rate needs a carrier.';
    const name = rateRuleCarrierLabel(rule.carrier);
    const label =
      key === ANY_CARRIER ? 'The "any other carrier" rate' : `The ${name} rate`;
    const error = percentError(rule.ratePercent, label);
    if (error) return error;
    const minimum = minBundleRateError(rule, key, name);
    if (minimum) return minimum;
    const steps = rateStepsError(rule, label);
    if (steps) return steps;
    const first = seen.get(key);
    if (first !== undefined) {
      return key === ANY_CARRIER
        ? 'Only one "any other carrier" rate is allowed.'
        : `${first} has more than one rate.`;
    }
    seen.set(key, name);
  }
  return null;
}

/** Why a rule's minimum bundle rate cannot be stored, or `null` when it can (or is off). */
function minBundleRateError(
  rule: RateRule,
  key: string,
  name: string,
): string | null {
  const minimum = rule.minBundleRatePercent;
  if (minimum === null || minimum === undefined) return null;
  const label =
    key === ANY_CARRIER
      ? 'The "any other carrier" minimum bundle rate'
      : `The ${name} minimum bundle rate`;
  const error = percentError(minimum, label);
  if (error) return error;
  return minimum > 0 ? null : `${label} must be more than 0%.`;
}

/** A gate's minimum: off (`null`), or a percentage above 0%. */
function gateError(
  value: number | null | undefined,
  label: string,
): string | null {
  if (value === null || value === undefined) return null;
  const error = percentError(value, label);
  if (error) return error;
  return value > 0 ? null : `${label} must be more than 0%.`;
}

/**
 * Why a rule's steps cannot be stored, or `null` when they can (or it has
 * none): at most {@link MAX_RATE_STEPS}, thresholds above zero and distinct
 * (dollars on a premium basis, a percentage on a retention basis), rates and
 * bonuses valid, gates above 0%. A higher step may not pay a lower rate than
 * the one below it, nor any step less than the base rate — reaching a step
 * must never lower the rate.
 */
function rateStepsError(rule: RateRule, label: string): string | null {
  const steps = rule.steps ?? [];
  if (!steps.length) return null;
  const basis = rule.stepBasis ?? 'premium';
  if (!(RATE_STEP_BASES as readonly string[]).includes(basis)) {
    return `${label} steps must be measured on premium or retention.`;
  }
  if (steps.length > MAX_RATE_STEPS) {
    return `${label} has at most ${MAX_RATE_STEPS} steps.`;
  }
  for (const [index, step] of steps.entries()) {
    const stepLabel = `${label}, step ${index + 1}`;
    const threshold =
      basis === 'premium'
        ? amountError(step.threshold, `${stepLabel}: the premium`)
        : percentError(step.threshold, `${stepLabel}: the retention`);
    if (threshold) return threshold;
    if (step.threshold <= 0) {
      return basis === 'premium'
        ? `${stepLabel}: the premium must be more than $0.`
        : `${stepLabel}: the retention must be more than 0%.`;
    }
    const error =
      percentError(step.ratePercent, `${stepLabel}: the rate`) ??
      amountError(step.bonusAmount, `${stepLabel}: the bonus`) ??
      gateError(
        step.minCompliancePercent,
        `${stepLabel}: the minimum compliance rate`,
      ) ??
      gateError(
        step.minBundleRatePercent,
        `${stepLabel}: the minimum bundle rate`,
      );
    if (error) return error;
    if (step.ratePercent < rule.ratePercent) {
      return `${stepLabel} cannot pay less than the base rate of ${rule.ratePercent}%.`;
    }
  }
  const sorted = [...steps].sort((a, b) => a.threshold - b.threshold);
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index].threshold === sorted[index - 1].threshold) {
      return `${label} has two steps with the same threshold.`;
    }
    if (sorted[index].ratePercent < sorted[index - 1].ratePercent) {
      return `${label}: a higher step cannot pay a lower rate than the step below it.`;
    }
  }
  return null;
}

/**
 * The key two lead-source rules collide on: the source id (ids are hex, so
 * case is not meaningful) and the carrier's {@link rateRuleKey}.
 */
function leadSourceKey(leadSourceId: string): string {
  return leadSourceId.trim().toLowerCase();
}

/**
 * Why a structure's lead-source rates cannot be stored, or `null` when they
 * can. None is fine. Rules are named by position ("Lead-source rate 2") —
 * the source's name is not known here, and the position is what the editor
 * titles each row with and what a request body lists them in.
 */
export function leadSourceRulesError(
  rules: readonly LeadSourceRateRule[],
): string | null {
  if (rules.length > MAX_RATE_RULES) {
    return `A structure has at most ${MAX_RATE_RULES} lead-source rates.`;
  }
  /**
   * `source|carrier` key → the 1-based position that first used it and its
   * carrier as given there, for the duplicate message.
   */
  const seen = new Map<string, { position: number; carrier: string }>();
  for (const [index, rule] of rules.entries()) {
    const label = `Lead-source rate ${index + 1}`;
    const source = leadSourceKey(rule.leadSourceId);
    if (!source) return `${label} needs a lead source.`;
    const carrier = rateRuleKey(rule.carrier);
    if (!carrier) return `${label} needs a carrier.`;
    const error = percentError(rule.ratePercent, label);
    if (error) return error;
    const key = `${source}|${carrier}`;
    const first = seen.get(key);
    if (first !== undefined) {
      return `Lead-source rates ${first.position} and ${index + 1} both set a rate for ${first.carrier} from the same lead source.`;
    }
    seen.set(key, {
      position: index + 1,
      carrier:
        carrier === ANY_CARRIER
          ? 'any carrier'
          : normalizeCarrier(rule.carrier.trim()),
    });
  }
  return null;
}

/** A threshold → amount level, the shape tiers and team levels share. */
interface PaidLevel {
  thresholdPremium: number;
  amount: number;
}

/**
 * The rules tiers and team levels share: at most {@link MAX_BONUS_TIERS},
 * thresholds above $0 and distinct, amounts valid. Only when the levels do
 * **not** stack must a higher one pay at least as much as the one below — it
 * is the only one paid, so reaching it must never pay less. Stacked, a higher
 * level's amount is *extra*, and a smaller extra is a legitimate choice.
 */
function levelsError(
  levels: readonly PaidLevel[],
  stackable: boolean,
  words: {
    /** "tier" / "level", for the messages. */
    noun: string;
    /** The cap message's subject: "A structure" / "The team bonus". */
    owner: string;
    threshold: string;
    amount: string;
  },
): string | null {
  if (levels.length > MAX_BONUS_TIERS) {
    return `${words.owner} has at most ${MAX_BONUS_TIERS} ${words.noun}s.`;
  }
  for (const level of levels) {
    const threshold = amountError(level.thresholdPremium, words.threshold);
    if (threshold) return threshold;
    if (level.thresholdPremium <= 0) {
      return `${words.threshold} must be more than $0.`;
    }
    const amount = amountError(level.amount, words.amount);
    if (amount) return amount;
  }
  const sorted = sortBonusTiers(levels);
  for (let index = 1; index < sorted.length; index += 1) {
    const below = sorted[index - 1];
    const level = sorted[index];
    if (level.thresholdPremium === below.thresholdPremium) {
      return `Two ${words.noun}s have the same threshold.`;
    }
    if (!stackable && level.amount < below.amount) {
      return `A higher ${words.noun} cannot pay less than the ${words.noun} below it, unless the ${words.noun}s stack.`;
    }
  }
  return null;
}

/** Why a structure's monthly tiers cannot be stored, or `null` when they can. */
export function bonusTiersError(
  tiers: readonly BonusTier[],
  options: { stackable: boolean },
): string | null {
  for (const tier of tiers) {
    const gate = gateError(
      tier.minCompliancePercent,
      'A tier minimum compliance rate',
    );
    if (gate) return gate;
  }
  return levelsError(
    tiers.map((tier) => ({
      thresholdPremium: tier.thresholdPremium,
      amount: tier.bonusAmount,
    })),
    options.stackable,
    {
      noun: 'tier',
      owner: 'A structure',
      threshold: 'A tier threshold',
      amount: 'A tier bonus',
    },
  );
}

/** Why a hat-trick rule cannot be stored, or `null` when it can. */
export function hatTrickError(rule: HatTrickRule): string | null {
  if (
    !Number.isInteger(rule.dealsPerDay) ||
    rule.dealsPerDay < MIN_HAT_TRICK_DEALS ||
    rule.dealsPerDay > MAX_HAT_TRICK_DEALS
  ) {
    return `Sales in a day must be a whole number from ${MIN_HAT_TRICK_DEALS} to ${MAX_HAT_TRICK_DEALS}.`;
  }
  return amountError(rule.bonusAmount, 'The hat-trick bonus');
}

/** Why the team pool's split cannot be stored, or `null` when it can. */
export function teamSplitError(
  csrSharePercent: number,
  producerSharePercent: number,
): string | null {
  const csr = percentError(csrSharePercent, 'The CSR share');
  if (csr) return csr;
  const producer = percentError(producerSharePercent, 'The producer share');
  if (producer) return producer;
  if (Math.round((csrSharePercent + producerSharePercent) * 100) !== 10_000) {
    return 'The CSR and producer shares must add up to 100%.';
  }
  return null;
}

/** Why the team bonus's levels cannot be stored, or `null` when they can. */
export function teamLevelsError(
  levels: readonly TeamBonusLevel[],
  options: { stackable: boolean; enabled: boolean },
): string | null {
  if (options.enabled && levels.length === 0) {
    return 'Add at least one team bonus level.';
  }
  return levelsError(
    levels.map((level) => ({
      thresholdPremium: level.thresholdPremium,
      amount: level.poolAmount,
    })),
    options.stackable,
    {
      noun: 'level',
      owner: 'The team bonus',
      threshold: 'A level threshold',
      amount: 'A level pool',
    },
  );
}

/** Why team-bonus settings cannot be stored, or `null` when they can. */
export function teamBonusError(settings: TeamBonusSettings): string | null {
  return (
    teamLevelsError(settings.levels, {
      stackable: settings.stackable,
      enabled: settings.enabled,
    }) ??
    teamSplitError(settings.csrSharePercent, settings.producerSharePercent)
  );
}

// ── 2026 comp plans: validators ─────────────────────────────────────────

const isWholeIn = (value: number, min: number, max: number) =>
  Number.isInteger(value) && value >= min && value <= max;

/** Why a structure's base pay cannot be stored, or `null` when it can. */
export function basePayError(basePay: number): string | null {
  return amountError(basePay, 'Base pay');
}

/** Why a stipend schedule cannot be stored, or `null` when it can. */
export function stipendError(amounts: readonly number[]): string | null {
  if (amounts.length > MAX_STIPEND_MONTHS) {
    return `A stipend runs for at most ${MAX_STIPEND_MONTHS} months.`;
  }
  for (const [index, amount] of amounts.entries()) {
    const error = amountError(amount, `The month ${index + 1} stipend`);
    if (error) return error;
  }
  return null;
}

/** Why members' start months cannot be stored, or `null` when they can. */
export function memberStartsError(
  starts: readonly MemberStart[],
): string | null {
  const seen = new Set<string>();
  for (const start of starts) {
    if (!PAYOUT_MONTH_PATTERN.test(start.startMonth)) {
      return 'A start month must be in YYYY-MM form.';
    }
    const key = start.userId.trim().toLowerCase();
    if (!key) return 'A start month needs a person.';
    if (seen.has(key)) return 'A person has two start months.';
    seen.add(key);
  }
  return null;
}

/** Why a compliance floor cannot be stored, or `null` when it can (or is off). */
export function complianceFloorError(
  floor: ComplianceFloor | null | undefined,
): string | null {
  if (!floor) return null;
  return (
    gateError(floor.minimumPercent, 'The minimum compliance rate') ??
    percentError(floor.reductionPercent, 'The pay reduction')
  );
}

/** Why a structure's overrides cannot be stored, or `null` when they can. */
export function overridesError(
  overrides: readonly OverrideRule[],
): string | null {
  if (overrides.length > MAX_OVERRIDE_RULES) {
    return `A structure has at most ${MAX_OVERRIDE_RULES} overrides.`;
  }
  const seen = new Set<string>();
  for (const [index, rule] of overrides.entries()) {
    const label = `Override ${index + 1}`;
    if (!(OVERRIDE_BASES as readonly string[]).includes(rule.basis)) {
      return `${label} must be on agency premium or a lead source.`;
    }
    const source = rule.leadSourceId ? leadSourceKey(rule.leadSourceId) : '';
    if (rule.basis === 'lead_source' && !source) {
      return `${label} needs a lead source.`;
    }
    if (rule.basis === 'agency' && source) {
      return `${label} is on agency premium, so it takes no lead source.`;
    }
    const carrier = rateRuleKey(rule.carrier);
    if (!carrier) return `${label} needs a carrier.`;
    const error = percentError(rule.ratePercent, `${label}'s rate`);
    if (error) return error;
    const key = `${rule.basis}|${source}|${carrier}`;
    if (seen.has(key)) return `${label} repeats an earlier override.`;
    seen.add(key);
  }
  return null;
}

/** Why agency-premium tiers cannot be stored, or `null` when they can. */
export function agencyTiersError(tiers: readonly BonusTier[]): string | null {
  return levelsError(
    tiers.map((tier) => ({
      thresholdPremium: tier.thresholdPremium,
      amount: tier.bonusAmount,
    })),
    false,
    {
      noun: 'agency tier',
      owner: 'A structure',
      threshold: 'An agency tier threshold',
      amount: 'An agency tier bonus',
    },
  );
}

/** Why team-bonus requirements cannot be stored, or `null` when they can. */
export function teamRequirementsError(
  requirements: TeamRequirements,
): string | null {
  const days = requirements.soldLogWithinDays;
  if (days !== null && !isWholeIn(days, 0, MAX_SOLD_LOG_DAYS)) {
    return `Days to enter a sale must be a whole number from 0 to ${MAX_SOLD_LOG_DAYS}.`;
  }
  return null;
}

/** Why a referral rule cannot be stored, or `null` when it can (or is off). */
export function referralRuleError(
  rule: ReferralRule | null | undefined,
): string | null {
  if (!rule) return null;
  if (!isWholeIn(rule.minimum, 0, MAX_REFERRAL_COUNT)) {
    return `The referral minimum must be a whole number from 0 to ${MAX_REFERRAL_COUNT}.`;
  }
  const deduction = amountError(
    rule.shortfallDeduction,
    'The shortfall deduction',
  );
  if (deduction) return deduction;
  if (rule.bonusThreshold !== null) {
    if (!isWholeIn(rule.bonusThreshold, 1, MAX_REFERRAL_COUNT)) {
      return `The referral bonus threshold must be a whole number from 1 to ${MAX_REFERRAL_COUNT}.`;
    }
    if (rule.bonusThreshold <= rule.minimum) {
      return 'The referral bonus threshold must be above the minimum.';
    }
  }
  return amountError(rule.bonusAmount, 'The referral bonus');
}

/** Why a chargeback window cannot be stored, or `null` when it can (or is off). */
export function chargebackWindowError(
  months: number | null | undefined,
): string | null {
  if (months === null || months === undefined) return null;
  return isWholeIn(months, 1, MAX_CHARGEBACK_WINDOW_MONTHS)
    ? null
    : `The chargeback window must be a whole number of months from 1 to ${MAX_CHARGEBACK_WINDOW_MONTHS}.`;
}

/** Why a statement's entered figures cannot be stored, or `null` when they can. */
export function statementInputsError(inputs: StatementInputs): string | null {
  if (inputs.compliancePercent !== null) {
    const error = percentError(inputs.compliancePercent, 'The compliance rate');
    if (error) return error;
  }
  if (inputs.retentionPercent !== null) {
    const error = percentError(inputs.retentionPercent, 'Retention');
    if (error) return error;
  }
  if (
    inputs.lifeReferrals !== null &&
    !isWholeIn(inputs.lifeReferrals, 0, MAX_REFERRAL_COUNT)
  ) {
    return `Life referrals must be a whole number from 0 to ${MAX_REFERRAL_COUNT}.`;
  }
  return null;
}

/**
 * The three amounts a reviewer types onto a statement (owner, 10 Nov 2026),
 * worked out outside the app. Each is a positive amount, or `null` for
 * none: Other bonuses / SPIFFs are **added**, the compliance adjustment and
 * other adjustments **deducted**.
 *
 * Stored as the statement's adjustments of kind `spiff`, `compliance` and
 * `manual` — the two deductions as negative amounts, which is how the engine
 * sums them into `totals.spiffs`, `complianceAdjustment` and
 * `otherAdjustments`. A recalculation keeps them.
 */
export interface StatementEnteredAdjustments {
  spiffs: number | null;
  complianceAdjustment: number | null;
  otherAdjustments: number | null;
}

export const EMPTY_STATEMENT_ENTERED_ADJUSTMENTS: StatementEnteredAdjustments =
  { spiffs: null, complianceAdjustment: null, otherAdjustments: null };

/** Each entered amount's adjustment kind, the sign it is stored with, and its label. */
export const ENTERED_ADJUSTMENTS = {
  spiffs: { kind: 'spiff', sign: 1, label: 'Other bonuses / SPIFFs' },
  complianceAdjustment: {
    kind: 'compliance',
    sign: -1,
    label: 'The compliance adjustment',
  },
  otherAdjustments: { kind: 'manual', sign: -1, label: 'Other adjustments' },
} as const satisfies Record<
  keyof StatementEnteredAdjustments,
  { kind: StatementAdjustmentKind; sign: 1 | -1; label: string }
>;

export const ENTERED_ADJUSTMENT_KEYS = Object.keys(
  ENTERED_ADJUSTMENTS,
) as (keyof StatementEnteredAdjustments)[];

/** Why the entered amounts cannot be stored, or `null` when they can. */
export function statementEnteredAdjustmentsError(
  value: StatementEnteredAdjustments,
): string | null {
  for (const key of ENTERED_ADJUSTMENT_KEYS) {
    const amount = value[key];
    if (amount === null) continue;
    const error = amountError(amount, ENTERED_ADJUSTMENTS[key].label);
    if (error) return error;
  }
  return null;
}

/**
 * The entered amounts as a statement stores them, read back as typed:
 * positive, `null` where there is none.
 */
export function enteredAdjustmentsOf(
  adjustments: readonly {
    kind: StatementAdjustmentKind;
    amount: number | null;
  }[],
): StatementEnteredAdjustments {
  const result = { ...EMPTY_STATEMENT_ENTERED_ADJUSTMENTS };
  for (const key of ENTERED_ADJUSTMENT_KEYS) {
    const { kind, sign } = ENTERED_ADJUSTMENTS[key];
    const rows = adjustments.filter(
      (row) => row.kind === kind && row.amount !== null,
    );
    if (rows.length === 0) continue;
    const cents = rows.reduce(
      (sum, row) => sum + Math.round((row.amount as number) * 100),
      0,
    );
    result[key] = (sign * cents) / 100;
  }
  return result;
}

/** Why Producer of the Year settings cannot be stored, or `null` when they can. */
export function producerOfYearError(
  settings: ProducerOfYearSettings,
): string | null {
  const amount = amountError(settings.bonusAmount, 'The bonus');
  if (amount) return amount;
  if (!isWholeIn(settings.minCompliantMonths, 0, 12)) {
    return 'Compliant months must be a whole number from 0 to 12.';
  }
  return percentError(
    settings.minCompliancePercent,
    'The compliance rate that counts a month',
  );
}

/**
 * The comp-plan parts of a structure, defaults filled in: what a write
 * stores when a client leaves a part out, and what a read returns for a
 * structure saved before the parts existed.
 */
export function structurePlanDefaults(input: {
  basePay?: number;
  stipendAmounts?: readonly number[];
  memberStarts?: readonly MemberStart[];
  complianceFloor?: ComplianceFloor | null;
  overrides?: readonly OverrideRule[];
  agencyTiers?: readonly BonusTier[];
  agencyTiersCarrier?: string;
  teamRequirements?: TeamRequirements | null;
  referralRule?: ReferralRule | null;
  chargebackWindowMonths?: number | null;
}) {
  return {
    basePay: input.basePay ?? 0,
    stipendAmounts: [...(input.stipendAmounts ?? [])],
    memberStarts: (input.memberStarts ?? []).map((start) => ({
      userId: start.userId,
      startMonth: start.startMonth,
    })),
    complianceFloor: input.complianceFloor
      ? {
          minimumPercent: input.complianceFloor.minimumPercent,
          reductionPercent: input.complianceFloor.reductionPercent,
        }
      : null,
    overrides: normalizeOverrides(input.overrides ?? []),
    agencyTiers: sortBonusTiers(input.agencyTiers ?? []).map((tier) => ({
      thresholdPremium: tier.thresholdPremium,
      bonusAmount: tier.bonusAmount,
    })),
    agencyTiersCarrier: storedCarrier(input.agencyTiersCarrier ?? ANY_CARRIER),
    teamRequirements: {
      soldLogWithinDays: input.teamRequirements?.soldLogWithinDays ?? null,
      meetingAttendance: input.teamRequirements?.meetingAttendance ?? false,
    },
    referralRule: input.referralRule
      ? {
          minimum: input.referralRule.minimum,
          shortfallDeduction: input.referralRule.shortfallDeduction,
          bonusThreshold: input.referralRule.bonusThreshold ?? null,
          bonusAmount: input.referralRule.bonusAmount,
        }
      : null,
    chargebackWindowMonths: input.chargebackWindowMonths ?? null,
  };
}

/** Overrides as stored: carriers canonical, ids lower-cased, agency ones first. */
export function normalizeOverrides(
  overrides: readonly OverrideRule[],
): OverrideRule[] {
  return overrides
    .map((rule) => ({
      basis: rule.basis,
      leadSourceId:
        rule.basis === 'lead_source' && rule.leadSourceId
          ? leadSourceKey(rule.leadSourceId)
          : null,
      carrier: storedCarrier(rule.carrier),
      ratePercent: rule.ratePercent,
    }))
    .sort(
      (a, b) =>
        a.basis.localeCompare(b.basis) ||
        (a.leadSourceId ?? '').localeCompare(b.leadSourceId ?? '') ||
        compareRuleCarriers(a.carrier, b.carrier),
    );
}

/** The figures a structure asks the manager for on each statement. */
export function statementInputsNeeded(structure: {
  rules: readonly RateRule[];
  individualTiers: readonly BonusTier[];
  complianceFloor?: ComplianceFloor | null;
  referralRule?: ReferralRule | null;
  teamRequirements?: TeamRequirements | null;
  teamBonusEligible: boolean;
}): StatementInputsNeeded {
  const stepped = structure.rules.filter((rule) => rule.steps?.length);
  return {
    compliance:
      Boolean(structure.complianceFloor) ||
      structure.individualTiers.some(
        (tier) => tier.minCompliancePercent != null,
      ) ||
      stepped.some((rule) =>
        (rule.steps ?? []).some((step) => step.minCompliancePercent !== null),
      ),
    retention: stepped.some((rule) => rule.stepBasis === 'retention'),
    referrals: Boolean(structure.referralRule),
    attendance:
      structure.teamBonusEligible &&
      Boolean(structure.teamRequirements?.meetingAttendance),
  };
}

/** Tiers or levels lowest threshold first — the order they are stored and shown in. */
export function sortBonusTiers<T extends { thresholdPremium: number }>(
  tiers: readonly T[],
): T[] {
  return [...tiers].sort((a, b) => a.thresholdPremium - b.thresholdPremium);
}

/**
 * What a list of levels pays for `reached` (premium sold): **stackable**, the
 * sum of every level whose threshold is reached; otherwise the amount of the
 * highest one reached. `levels` lists the ones that count, lowest first —
 * all reached when stacking, the single highest otherwise, none below the
 * first threshold.
 */
export function levelsReached<T extends { thresholdPremium: number }>(
  levels: readonly T[],
  reached: number,
  stackable: boolean,
  amountOf: (level: T) => number,
): { amount: number; levels: T[] } {
  const hit = sortBonusTiers(levels).filter(
    (level) => level.thresholdPremium <= reached,
  );
  const counted = stackable ? hit : hit.slice(-1);
  // Summed in cents: every amount has at most two decimals, so this is exact.
  const cents = counted.reduce(
    (sum, level) => sum + Math.round(amountOf(level) * 100),
    0,
  );
  return { amount: cents / 100, levels: counted };
}

/** A person's monthly tier bonus for `grossPremium` sold in the month. */
export function tierBonusFor(
  tiers: readonly BonusTier[],
  stackable: boolean,
  grossPremium: number,
): number {
  return levelsReached(tiers, grossPremium, stackable, (t) => t.bonusAmount)
    .amount;
}

/**
 * The team pool for `agencyGross` sold in the month — `0` when the bonus is
 * off or no level is reached. Split between CSRs and producers afterwards.
 */
export function teamPoolFor(
  settings: TeamBonusSettings,
  agencyGross: number,
): number {
  if (!settings.enabled) return 0;
  return levelsReached(
    settings.levels,
    agencyGross,
    settings.stackable,
    (level) => level.poolAmount,
  ).amount;
}

/** A rule's carrier as stored: canonical and trimmed, or {@link ANY_CARRIER}. */
function storedCarrier(carrier: string): string {
  const trimmed = carrier.trim();
  return trimmed === ANY_CARRIER ? ANY_CARRIER : normalizeCarrier(trimmed);
}

/** Carriers by name, {@link ANY_CARRIER} last — the order rules are stored and shown in. */
export function compareRuleCarriers(a: string, b: string): number {
  if (a === b) return 0;
  if (a === ANY_CARRIER) return 1;
  if (b === ANY_CARRIER) return -1;
  return a.localeCompare(b);
}

/**
 * Rate rules as stored: carrier names canonical and trimmed, carriers by
 * name, the "any other carrier" rule last, and the minimum bundle rate
 * always present (`null` when not enforced).
 */
export function normalizeRateRules(
  rules: readonly RateRule[],
): Required<RateRule>[] {
  return rules
    .map((rule) => ({
      carrier: storedCarrier(rule.carrier),
      ratePercent: rule.ratePercent,
      minBundleRatePercent: rule.minBundleRatePercent ?? null,
      stepBasis: rule.stepBasis ?? 'premium',
      steps: [...(rule.steps ?? [])]
        .sort((a, b) => a.threshold - b.threshold)
        .map((step) => ({
          threshold: step.threshold,
          ratePercent: step.ratePercent,
          bonusAmount: step.bonusAmount ?? 0,
          minCompliancePercent: step.minCompliancePercent ?? null,
          minBundleRatePercent: step.minBundleRatePercent ?? null,
        })),
    }))
    .sort((a, b) => compareRuleCarriers(a.carrier, b.carrier));
}

/**
 * The minimum bundle rate a person must keep on `carrier`'s sales: the
 * carrier's own rule's, else the "any other carrier" rule's, else `null`
 * (nothing to check). Mirrors {@link rateForCarrier} — a carrier with a rule
 * of its own and no minimum is **not** checked, even if the catch-all has
 * one. A lead-source rate does not change it: a sale paid at JYA's rate on
 * Allstate still counts toward, and is flagged with, Allstate's minimum
 * (owner, 5 Nov 2026).
 */
export function bundleMinimumFor(
  rules: readonly RateRule[],
  carrier: string | null | undefined,
): number | null {
  const key = carrier ? rateRuleKey(carrier) : '';
  if (key && key !== ANY_CARRIER) {
    const own = rules.find((rule) => rateRuleKey(rule.carrier) === key);
    if (own) return own.minBundleRatePercent ?? null;
  }
  const any = rules.find((rule) => rule.carrier.trim() === ANY_CARRIER);
  return any?.minBundleRatePercent ?? null;
}

/**
 * Lead-source rules as stored: ids trimmed and lower-cased, carriers as
 * {@link normalizeRateRules} stores them, grouped by source id and, within a
 * source, carriers by name with "any carrier" last. (Names are not stored,
 * so storage cannot sort by them; the API's view re-sorts by name.)
 */
export function normalizeLeadSourceRules(
  rules: readonly LeadSourceRateRule[],
): LeadSourceRateRule[] {
  return rules
    .map((rule) => ({
      leadSourceId: leadSourceKey(rule.leadSourceId),
      carrier: storedCarrier(rule.carrier),
      ratePercent: rule.ratePercent,
    }))
    .sort(
      (a, b) =>
        a.leadSourceId.localeCompare(b.leadSourceId) ||
        compareRuleCarriers(a.carrier, b.carrier),
    );
}

/**
 * The rate a carrier's premium is paid at under `rules`: its own rule, else
 * the "any other carrier" rule, else `null` (no rate — the statement pays 0%
 * and says so). {@link rateFor} without lead-source rules.
 */
export function rateForCarrier(
  rules: readonly RateRule[],
  carrier: string | null | undefined,
): (ResolvedRate & { source: 'carrier' | 'any' }) | null {
  const key = carrier ? rateRuleKey(carrier) : '';
  if (key && key !== ANY_CARRIER) {
    const own = rules.find((rule) => rateRuleKey(rule.carrier) === key);
    if (own) return { ratePercent: own.ratePercent, source: 'carrier' };
  }
  const any = rules.find((rule) => rule.carrier.trim() === ANY_CARRIER);
  return any ? { ratePercent: any.ratePercent, source: 'any' } : null;
}

/**
 * The rate one sale's premium is paid at. Most specific wins:
 *
 * 1. a lead-source rule for the sale's source **and** carrier,
 * 2. a lead-source rule for the sale's source and any carrier,
 * 3. the carrier's own rate,
 * 4. the "any other carrier" rate,
 *
 * else `null` (no rate). A sale with no lead source, or from a source with no
 * rule, is paid exactly as {@link rateForCarrier} says; so is a sale from a
 * source whose rules all name other carriers.
 */
export function rateFor(
  rules: readonly RateRule[],
  leadSourceRules: readonly LeadSourceRateRule[],
  sale: {
    carrier: string | null | undefined;
    leadSourceId: string | null | undefined;
  },
): ResolvedRate | null {
  const source = sale.leadSourceId ? leadSourceKey(sale.leadSourceId) : '';
  if (source) {
    const fromSource = leadSourceRules.filter(
      (rule) => leadSourceKey(rule.leadSourceId) === source,
    );
    const key = sale.carrier ? rateRuleKey(sale.carrier) : '';
    if (key && key !== ANY_CARRIER) {
      const own = fromSource.find((rule) => rateRuleKey(rule.carrier) === key);
      if (own) {
        return { ratePercent: own.ratePercent, source: 'lead_source_carrier' };
      }
    }
    const any = fromSource.find((rule) => rule.carrier.trim() === ANY_CARRIER);
    if (any) return { ratePercent: any.ratePercent, source: 'lead_source' };
  }
  return rateForCarrier(rules, sale.carrier);
}

/** "any other carrier" for {@link ANY_CARRIER}, else the carrier's name. */
export function rateRuleCarrierLabel(carrier: string): string {
  return carrier.trim() === ANY_CARRIER
    ? 'Any other carrier'
    : normalizeCarrier(carrier);
}

/**
 * A lead-source rule's carrier as read: "Any carrier" for
 * {@link ANY_CARRIER} (there is no "other" — the rule covers every carrier
 * from that source), else the carrier's name.
 */
export function leadSourceRuleCarrierLabel(carrier: string): string {
  return carrier.trim() === ANY_CARRIER
    ? 'Any carrier'
    : normalizeCarrier(carrier);
}

// ── Statements (PAC-178) ────────────────────────────────────────────────
//
// A **pay statement** is one person's commission for one month: what they
// sold, what was charged back, the rate each part was paid at, the bonuses
// and the net. A **run** is one agency's month: the job that drafts the
// statements on the 1st (or the owner's Generate), and the agency-wide facts
// every statement shares — the agency's premium against the team threshold,
// the team pools, the Salesperson of the Month. The math is
// `domain/payout-math.ts`; this is its vocabulary and wire shape.

/** A pay month on the agency's calendar, `YYYY-MM`. */
export const PAYOUT_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * `draft` → `sent` → `accepted` (final), or `sent` → `rejected` (disputed)
 * → `sent` again as the next version. A sent statement may be reopened
 * (`sent` → `draft`) until the employee answers. PAC-181 writes `sent` and
 * the reopen; sign-off (`accepted` / `rejected`) arrives with PAC-182.
 */
export const PAY_STATEMENT_STATUSES = [
  'draft',
  'sent',
  'accepted',
  'rejected',
] as const;
export type PayStatementStatus = (typeof PAY_STATEMENT_STATUSES)[number];

/**
 * The statements a recalculation may rewrite. A sent or accepted statement is
 * what the employee was shown, so it is never changed underneath them; a
 * disputed one is waiting for the manager's correction.
 */
export const EDITABLE_PAY_STATEMENT_STATUSES = [
  'draft',
  'rejected',
] as const satisfies readonly PayStatementStatus[];

export function isEditableStatementStatus(status: PayStatementStatus): boolean {
  return (EDITABLE_PAY_STATEMENT_STATUSES as readonly string[]).includes(
    status,
  );
}

export const PAYOUT_RUN_STATUSES = ['generating', 'ready', 'failed'] as const;
export type PayoutRunStatus = (typeof PAYOUT_RUN_STATUSES)[number];

/** `cron` — the 1st-of-month job; `manual` — the owner's Generate / Recalculate. */
export const PAYOUT_RUN_TRIGGERS = ['cron', 'manual'] as const;
export type PayoutRunTrigger = (typeof PAYOUT_RUN_TRIGGERS)[number];

/**
 * A run still `generating` after this long is taken to have died (a worker
 * restart mid-run) and may be claimed again.
 */
export const STALE_PAYOUT_RUN_MINUTES = 30;

/** 409 when a month is already being generated. */
export const PAYOUT_RUN_GENERATING = 'PAYOUT_RUN_GENERATING';

/** 409 when a statement that is not draft or disputed is asked to change. */
export const PAYOUT_STATEMENT_NOT_EDITABLE = 'PAYOUT_STATEMENT_NOT_EDITABLE';
/**
 * 403: the figures on a statement (compliance rate, retention, …) decide the
 * person's pay, so they are entered by someone else — a reviewer cannot
 * enter them on their own statement unless they hold `agency:payouts:admin`.
 */
export const PAYOUT_STATEMENT_OWN_INPUTS = 'PAYOUT_STATEMENT_OWN_INPUTS';

/** 409: only a sent statement can be reopened (PAC-181). */
export const PAYOUT_STATEMENT_NOT_SENT = 'PAYOUT_STATEMENT_NOT_SENT';

/**
 * 403: a reviewer may not send, reopen or recalculate their own statement
 * unless they hold `agency:payouts:admin` (PAC-181 review fixes) — the
 * same rule as `PAYOUT_STATEMENT_OWN_INPUTS`, for the actions that issue it.
 * Send all leaves such a reviewer's own draft out instead of refusing.
 */
export const PAYOUT_STATEMENT_OWN_STATEMENT = 'PAYOUT_STATEMENT_OWN_STATEMENT';

/**
 * 409: the statement changed (new figures, a recalculation) while it was
 * being sent or reopened, so what was rendered is no longer what it holds.
 * It is still editable: review it and send again (PAC-181 review fixes).
 */
export const PAYOUT_STATEMENT_CHANGED = 'PAYOUT_STATEMENT_CHANGED';

/**
 * Why an issued version of a statement is no longer the current one
 * (PAC-181). `reopened` — a reviewer took a sent statement back to draft;
 * `superseded` — a disputed statement was sent again as the next version.
 *
 * **`version === history.length + 1`, always.** Every issued version that is
 * no longer current has exactly one row, written in the same update that
 * bumps `version`: reopening does both, and so does re-sending a disputed
 * statement. A first send writes no row. A rejection (PAC-182) is not an
 * outcome — the disputed statement is still the current version, and leaves
 * history only when it is superseded.
 */
export const STATEMENT_HISTORY_OUTCOMES = ['reopened', 'superseded'] as const;
export type StatementHistoryOutcome =
  (typeof STATEMENT_HISTORY_OUTCOMES)[number];

/** The file name an issued statement is stored and downloaded under. */
export function statementPdfFilename(month: string, version: number): string {
  return `commission-statement-${month}-v${version}.pdf`;
}

/**
 * Which half of the team pool a person shares in. CSRs are licensed and sell
 * (owner, 4 Nov 2026), so both earn the same way; only the pool split is by
 * role.
 */
export const PAYOUT_POOLS = ['csr', 'producer'] as const;
export type PayoutPool = (typeof PAYOUT_POOLS)[number];

/** A CSR role (slug `csr`) puts a person in the CSR pool; anyone else is a producer. */
export function payoutPoolFor(roleSlugs: readonly string[]): PayoutPool {
  return roleSlugs.includes('csr') ? 'csr' : 'producer';
}

/**
 * The manager's corrections to a statement (PAC-182 adds the endpoints; the
 * math applies them already): leave a chargeback out, add one, a SPIFF
 * (≥ 0), a compliance adjustment (≤ 0), or any other line (±).
 */
export const STATEMENT_ADJUSTMENT_KINDS = [
  'exclude_chargeback',
  'add_chargeback',
  'spiff',
  'compliance',
  'manual',
] as const;
export type StatementAdjustmentKind =
  (typeof STATEMENT_ADJUSTMENT_KINDS)[number];

/** Where a statement line's rate came from; `none` — no rule covers it, paid 0%. */
export const STATEMENT_RATE_SOURCES = [...RATE_SOURCES, 'none'] as const;
export type StatementRateSource = (typeof STATEMENT_RATE_SOURCES)[number];

/** The carrier of a policy that records none, and of a sale with no policies. */
export const PAYOUT_NO_CARRIER = '(no carrier)';

export const PAY_STATEMENTS_PAGE_SIZE = 25;
export const MAX_PAY_STATEMENTS_PAGE_SIZE = 100;

export const SOM_STATUSES = ['winner', 'none', 'off'] as const;
export type SomStatus = (typeof SOM_STATUSES)[number];

export const COMPLIANCE_STATUSES = ['compliant', 'non_compliant'] as const;
export type ComplianceStatus = (typeof COMPLIANCE_STATUSES)[number];

/**
 * One row of the Commission Statement's carrier production table.
 *
 * Premium is bucketed by carrier and, where a lead-source rate applies, by
 * lead source too: a bucket paid a lead-source rate is a line of its own
 * ("Allstate · JYA leads"); every other sale on the carrier is on the
 * carrier's line (`leadSourceId: null`). Chargebacks land on the line of the
 * sale they reverse.
 */
export interface PremiumLineView {
  /** A carrier's display name, or {@link PAYOUT_NO_CARRIER}. */
  carrier: string;
  /** Set only on a lead-source-rate line. */
  leadSourceId: string | null;
  leadSourceName: string | null;
  /** One of the agency's carrier appointments (listed even with no sales). */
  appointed: boolean;
  grossPremium: number;
  /** Premium charged back (left-out chargebacks excluded). */
  chargebacks: number;
  netPremium: number;
  ratePercent: number;
  rateSource: StatementRateSource;
  /**
   * The line's commission: the rate on net premium (sold less charged back).
   * Equal to `netCommission` since 10 Nov 2026; on a statement calculated
   * before, it was the rate on sold premium, less `chargebackImpact`.
   */
  grossCommission: number;
  /**
   * Only on statements calculated before 10 Nov 2026: the commission given
   * back on the chargebacks, then deducted from `grossCommission`. Commission
   * is now the rate on net premium, so nothing is deducted a second time.
   */
  chargebackImpact?: number;
  netCommission: number;
  /**
   * The person's bundle rate on this carrier for the month (`null` with no
   * sales on it), the minimum the structure asks for (`null` = not
   * enforced), and whether it fell short. The same on every line of a
   * carrier — a lead-source line is flagged with its carrier.
   */
  bundleRate: number | null;
  minBundleRatePercent: number | null;
  bundleShortfall: boolean;
  /**
   * The step of a stepped rate this line was paid at (1-based), `null` at
   * the base rate. Absent on statements computed before steps existed.
   */
  rateStep?: number | null;
}

/** One sale, as a statement and the activity view list it. */
export interface StatementDealView {
  dealId: string;
  /** ISO-8601 instant. */
  soldDate: string;
  /** The agency-local day, `YYYY-MM-DD` — what the hat trick counts by. */
  soldDay: string;
  clientName: string;
  policyTypes: string[];
  /** Display names, sorted; empty for a sale with no carrier recorded. */
  carriers: string[];
  policyCount: number;
  premium: number;
  leadSourceId: string | null;
  leadSourceName: string | null;
  /** Two or more policies ({@link PAYOUT_BUNDLE_MIN_POLICIES}). */
  isBundle: boolean;
  /**
   * The client's household — what the Activity tab opens. `null` for a sale
   * with none; absent on statements stored before 10 Nov 2026.
   */
  householdId?: string | null;
}

/** One chargeback ledger row, as the activity view lists it. */
export interface PayoutActivityChargebackView {
  chargebackId: string;
  policyId: string | null;
  /**
   * The client's household (the row's own, else its policy's or deal's) —
   * what the Activity tab opens. Absent on statements stored before 10 Nov 2026.
   */
  householdId?: string | null;
  policyNumber: string | null;
  policyType: string | null;
  carrier: string;
  customerName: string | null;
  /** Premium dollars, positive. */
  amount: number;
  /** ISO-8601 instant. */
  occurredAt: string;
  /** The agency-local day, `YYYY-MM-DD`. */
  occurredDay: string;
  reason: ChargebackReason;
  source: ChargebackSource;
}

/** A chargeback on a statement: the activity row, the line it is taken off and its rate. */
export interface StatementChargebackView extends PayoutActivityChargebackView {
  /** Set when it reverses a sale paid a lead-source rate. */
  leadSourceId: string | null;
  ratePercent: number;
  /**
   * Only on statements calculated before 10 Nov 2026: the commission this
   * chargeback cost, deducted on its own. It now comes off the line's premium.
   */
  commissionDeduction?: number;
  /** Left out by the manager (an `exclude_chargeback` adjustment). */
  excluded: boolean;
  excludedNote: string | null;
}

export interface StatementBonusesView {
  hatTrick: {
    enabled: boolean;
    dealsPerDay: number;
    bonusAmount: number;
    /** The agency-local days that qualified, `YYYY-MM-DD`. */
    days: string[];
    amount: number;
  };
  individual: {
    stackable: boolean;
    /** The tiers that pay: every one reached when stacking, else the highest. */
    reached: BonusTier[];
    amount: number;
  };
  team: {
    /** The structure takes part in the team bonus. */
    eligible: boolean;
    /** The agency reached the first level. */
    met: boolean;
    /** The whole team pool for the month. */
    poolAmount: number;
    pool: PayoutPool;
    /** This person's half of the pool (the CSR or the producer share). */
    groupPool: number;
    /** That half's sold premium — what the person's share is a share of. */
    groupPremium: number;
    amount: number;
  };
  salespersonOfMonth: { enabled: boolean; winner: boolean; amount: number };
  // The 2026 comp-plan parts. Absent on statements computed before them.
  /** Bonuses paid by the step a stepped rate reached. */
  rateSteps?: {
    carrier: string;
    step: number;
    threshold: number;
    ratePercent: number;
    bonusAmount: number;
  }[];
  /** The personal bonus on the agency's premium (Office Manager). */
  agency?: {
    carrier: string;
    premium: number;
    reached: BonusTier | null;
    amount: number;
  } | null;
  overrides?: {
    basis: OverrideBasis;
    leadSourceId: string | null;
    leadSourceName: string | null;
    carrier: string;
    premium: number;
    ratePercent: number;
    amount: number;
  }[];
  referrals?: {
    count: number | null;
    minimum: number;
    bonusThreshold: number | null;
    amount: number;
  } | null;
  producerOfYear?: { enabled: boolean; winner: boolean; amount: number };
  /** Why the person has no share of the team pool, when they have none. */
  teamBlocked?: string[];
  compliance?: {
    percent: number | null;
    floor: ComplianceFloor | null;
    belowFloor: boolean;
    /** Negative: the share of variable pay taken off. */
    reduction: number;
  };
}

export interface StatementIndicatorsView {
  /** The highest monthly tier reached (1-based), stacking or not. */
  tier: { level: number; thresholdPremium: number } | null;
  /** Sales with 2+ policies ÷ sales; `null` with no sales. */
  bundleRate: number | null;
  /** Qualifying days; `null` when the structure has no hat trick. */
  hatTricks: number | null;
  somStatus: SomStatus;
  complianceStatus: ComplianceStatus;
  /** The month's sales whose deal audit failed. */
  failedAudits: number;
  /** The compliance rate the manager entered; `null` = not entered. */
  compliancePercent?: number | null;
}

/** The Commission Statement's summary grid. */
export interface StatementTotalsView {
  grossPremium: number;
  chargebackTotal: number;
  netPremium: number;
  /** The lines' commission — on net premium since 10 Nov 2026 (see `PremiumLineView`). */
  grossCommission: number;
  /**
   * Only on statements calculated before 10 Nov 2026, deducted from
   * `grossCommission` there. Read it as 0 when absent.
   */
  chargebackImpact?: number;
  tierBonus: number;
  teamBonus: number;
  somBonus: number;
  hatTrickBonus: number;
  /** Other Bonuses / SPIFFs. */
  spiffs: number;
  complianceAdjustment: number;
  otherAdjustments: number;
  /** Commission, bonuses and every adjustment — everything but base pay and stipend. */
  netCommission: number;
  // The 2026 comp-plan lines (6 Nov 2026). Absent on statements computed
  // before them: read them as 0, and net pay as net commission.
  basePay?: number;
  stipend?: number;
  rateStepBonus?: number;
  overrideCommission?: number;
  agencyBonus?: number;
  producerOfYearBonus?: number;
  /** Negative: the compliance floor's reduction of variable pay. */
  complianceReduction?: number;
  /** The referral bonus (positive) or shortfall deduction (negative). */
  referralAdjustment?: number;
  /** Base pay + stipend + net commission: what the person is paid. */
  netPay?: number;
}

/** A statement's net pay; net commission for one computed before base pay existed. */
export function statementNetPay(totals: StatementTotalsView): number {
  return totals.netPay ?? totals.netCommission;
}

export interface StatementAdjustmentView {
  id: string;
  kind: StatementAdjustmentKind;
  chargebackId: string | null;
  amount: number | null;
  note: string;
  createdBy: string | null;
  /** ISO-8601. */
  createdAt: string;
}

/** The structure a statement was computed with, frozen on it. */
export interface StatementStructureSnapshot {
  id: string;
  name: string;
  rules: Required<RateRule>[];
  leadSourceRules: LeadSourceRateRuleView[];
  hatTrick: HatTrickRule;
  individualTiers: BonusTier[];
  tiersStackable: boolean;
  teamBonusEligible: boolean;
  // The 2026 comp-plan parts; absent on snapshots taken before them.
  basePay?: number;
  stipendAmounts?: number[];
  complianceFloor?: ComplianceFloor | null;
  overrides?: OverrideRuleView[];
  agencyTiers?: BonusTier[];
  agencyTiersCarrier?: string;
  teamRequirements?: TeamRequirements;
  referralRule?: ReferralRule | null;
  chargebackWindowMonths?: number | null;
  /** The member's start month, for the stipend. */
  startMonth?: string | null;
}

export interface PayStatementSummary {
  id: string;
  runId: string;
  month: string;
  userId: string;
  userName: string;
  /** Role names, for display. */
  roleNames: string[];
  pool: PayoutPool;
  /** The person's branch when the statement was computed. */
  branchId: string | null;
  branchName: string | null;
  structureId: string;
  structureName: string;
  status: PayStatementStatus;
  version: number;
  totals: StatementTotalsView;
  warningCount: number;
  /** ISO-8601. */
  computedAt: string;
  /** When the current version was sent (ISO-8601); `null` while a draft. */
  sentAt: string | null;
}

export interface PayStatementView extends PayStatementSummary {
  /** The Allstate Bind ID (the "SOK number"), the statement's Producer ID. */
  allstateBindId: string | null;
  timeZone: string;
  structure: StatementStructureSnapshot;
  premiumLines: PremiumLineView[];
  deals: StatementDealView[];
  chargebacks: StatementChargebackView[];
  bonuses: StatementBonusesView;
  indicators: StatementIndicatorsView;
  adjustments: StatementAdjustmentView[];
  /** The figures the manager entered. */
  inputs: StatementInputs;
  /** Which of them this statement's structure reads. */
  inputsNeeded: StatementInputsNeeded;
  warnings: string[];
  /** The issued PDF of the current version; `null` until it is sent. */
  pdf: PayStatementPdfView | null;
  /** Who sent the current version; `null` while a draft. */
  sentBy: { id: string; name: string } | null;
  /** The earlier issued versions, oldest first (see {@link STATEMENT_HISTORY_OUTCOMES}). */
  history: StatementHistoryEntryView[];
}

/**
 * An issued Commission Statement PDF (PAC-181). The storage key never leaves
 * the API: the file is reached through `GET /payouts/statements/:id/pdf`,
 * which mints a short-lived link per read.
 */
export interface PayStatementPdfView {
  /** SHA-256 of the file, hex — what a signed copy (PAC-182) will cite. */
  sha256: string;
  size: number;
  /** ISO-8601. */
  renderedAt: string;
}

/** An issued version that is no longer the current one. */
export interface StatementHistoryEntryView {
  version: number;
  outcome: StatementHistoryOutcome;
  pdf: PayStatementPdfView | null;
  /** ISO-8601. */
  sentAt: string | null;
  sentBy: { id: string; name: string } | null;
  /** When it stopped being current (ISO-8601). */
  at: string;
}

/**
 * `GET /payouts/statements/:id/pdf` — a presigned inline link to the file,
 * minted for this read and never stored; it expires after `expiresIn`
 * seconds.
 */
export interface PayStatementPdfLinkResponse {
  url: string;
  filename: string;
  expiresIn: number;
}

/**
 * `POST /payouts/runs/:id/send-all`. `skipped` — drafts that were no longer
 * drafts when their turn came (sent or recalculated meanwhile); `failed` —
 * drafts that could not be sent, with why.
 */
export interface SendAllDraftsResponse {
  sent: number;
  skipped: number;
  failed: { statementId: string; userName: string; message: string }[];
}

/**
 * `PATCH /payouts/statements/:id/inputs`: the figures, whole. The statement
 * is recalculated with them, against the month's stored team split and
 * Salesperson of the Month (as Recalculate does).
 */
export type UpdateStatementInputsInput = StatementInputs;
export type UpdateStatementAdjustmentsInput = StatementEnteredAdjustments;

export interface PayStatementsResponse {
  statements: PayStatementSummary[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** The agency-wide facts of a month, shared by every statement in it. */
export interface PayoutRunTeamBonusView {
  enabled: boolean;
  stackable: boolean;
  levels: TeamBonusLevel[];
  /** The agency reached the first level. */
  met: boolean;
  poolAmount: number;
  csrSharePercent: number;
  producerSharePercent: number;
  csrPool: number;
  producerPool: number;
  /** Sold premium of the team-eligible CSRs / producers. */
  csrPremium: number;
  producerPremium: number;
}

export interface PayoutRunView {
  id: string;
  month: string;
  status: PayoutRunStatus;
  trigger: PayoutRunTrigger;
  timeZone: string;
  /** The month's first instant and the next month's, on the agency's clock. */
  window: { from: string; to: string };
  /** Every producer's sold premium in the month — the team threshold's figure. */
  agencyGrossPremium: number;
  teamBonus: PayoutRunTeamBonusView;
  salespersonOfMonth: {
    enabled: boolean;
    bonusAmount: number;
    topGrossPremium: number | null;
    winners: { userId: string; name: string }[];
  };
  /** The statements the caller may see. */
  counts: {
    statements: number;
    draft: number;
    sent: number;
    accepted: number;
    rejected: number;
  };
  /** Over the statements the caller may see. */
  totals: { grossPremium: number; netCommission: number; netPay: number };
  /** Paid on December's run only; `null` in other months. */
  producerOfYear: {
    enabled: boolean;
    bonusAmount: number;
    topGrossPremium: number | null;
    winners: { userId: string; name: string }[];
  } | null;
  warnings: string[];
  /** ISO-8601. */
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
}

/** `GET /payouts/runs?month`: the month's run, or `null` before one exists. */
export interface PayoutRunResponse {
  month: string;
  /** The agency's current month — a run for it is partial. */
  currentMonth: string;
  run: PayoutRunView | null;
}

/** `POST /payouts/runs`. */
export interface GeneratePayoutRunInput {
  month: string;
}

/** Someone whose activity a manager may open. */
export interface PayoutActivityPerson {
  id: string;
  name: string;
  roles: string[];
  status: PayoutPersonStatus;
  branchName: string | null;
}

export interface PayoutActivityPeopleResponse {
  people: PayoutActivityPerson[];
}

/**
 * `GET /payouts/activity` (PAC-179): everything one person sold and had
 * charged back in a month, statement or not.
 */
export interface PayoutActivityView {
  userId: string;
  userName: string;
  month: string;
  /** The person's statement for the month, when the caller may open it. */
  statementId: string | null;
  deals: StatementDealView[];
  chargebacks: PayoutActivityChargebackView[];
  totals: {
    deals: number;
    policies: number;
    premium: number;
    bundles: number;
    chargebacks: number;
    chargebackTotal: number;
  };
}

// ── Chargeback report import (PAC-180) ──────────────────────────────────
//
// The owner uploads the month's chargeback report (.xlsx or .csv); each line
// is matched to a person and, where the app holds it, a policy. The owner
// previews the result, resolves what matched nobody, and commits: one
// `chargebacks` row per charged line (`source: 'carrier_statement'`, counted
// in the import's month), then the month's draft and disputed statements are
// recalculated.
//
// **A policy is charged back once** (owner, 6 Nov 2026). A line whose policy
// already has a chargeback — any month, any source — or that repeats an
// earlier line of the same file is a `duplicate`: the original stands, the
// line says which it is, and it is never charged.

/** `preview` until committed (or discarded, which frees the file's hash). */
export const CHARGEBACK_IMPORT_STATUSES = [
  'preview',
  'committed',
  'discarded',
] as const;
export type ChargebackImportStatus =
  (typeof CHARGEBACK_IMPORT_STATUSES)[number];

/**
 * What becomes of a report line.
 *
 * - `matched` — the app found who to charge.
 * - `assigned` — the owner chose who to charge.
 * - `unmatched` — needs a person; a commit is refused while any line is.
 * - `skipped` — left out: by the owner, or because its amount has the
 *   opposite sign to the rest of the report (a reversal, not a chargeback).
 * - `duplicate` — the policy has already been charged back, or an earlier
 *   line of the file charges it. Never charged, and the owner cannot change it.
 */
export const IMPORT_ROW_RESOLUTIONS = [
  'matched',
  'assigned',
  'unmatched',
  'skipped',
  'duplicate',
] as const;
export type ImportRowResolution = (typeof IMPORT_ROW_RESOLUTIONS)[number];

/** The lines a commit writes to the ledger. */
export const CHARGED_IMPORT_ROW_RESOLUTIONS = [
  'matched',
  'assigned',
] as const satisfies readonly ImportRowResolution[];

export function isChargedResolution(resolution: ImportRowResolution): boolean {
  return (CHARGED_IMPORT_ROW_RESOLUTIONS as readonly string[]).includes(
    resolution,
  );
}

/**
 * Why a line matched the way it did, for the preview. The names involved
 * travel on the row (`candidates`, `chargedTo`); a note is the reason.
 */
export const IMPORT_ROW_NOTES = [
  'sok_unknown',
  'name_unknown',
  'name_ambiguous',
  'name_seller_differ',
  'sok_seller_differ',
  'seller_used',
  'policy_not_found',
  'policy_no_sale',
  'no_structure',
  'already_charged',
  'repeated_in_file',
  'opposite_sign',
] as const;
export type ImportRowNote = (typeof IMPORT_ROW_NOTES)[number];

export const IMPORT_ROW_NOTE_LABELS: Record<ImportRowNote, string> = {
  sok_unknown: 'The SOK number is not on any user.',
  name_unknown: 'The producer named in the file is not a user.',
  name_ambiguous: 'More than one user has the name in the file.',
  name_seller_differ:
    "The file names one person and the app's sale another — choose who to charge.",
  sok_seller_differ: "The app's sale is someone else's.",
  seller_used: 'Charged to the person who sold the policy in the app.',
  policy_not_found: 'The policy number is not in the app.',
  policy_no_sale: 'The policy has no sale in the app.',
  no_structure: 'Not on a payment structure, so no statement shows it.',
  already_charged:
    'This policy has already been charged back, so it is not charged again.',
  repeated_in_file:
    'An earlier line of this report charges the same policy, so this one is not charged.',
  opposite_sign:
    'The amount has the opposite sign to the rest of the report — a reversal? Left out; charge it only if it is a chargeback.',
};

/** How a candidate person was found: SOK number, the file's name, the app's sale. */
export const IMPORT_MATCH_SIGNALS = ['sok', 'name', 'policy'] as const;
export type ImportMatchSignal = (typeof IMPORT_MATCH_SIGNALS)[number];

/** The report may be a spreadsheet or a CSV export of one. */
export const PAYOUT_IMPORT_FILE_EXTENSIONS = ['.xlsx', '.csv'] as const;
export const MAX_PAYOUT_IMPORT_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_PAYOUT_IMPORT_ROWS = 5_000;

/** 409: these exact bytes were already imported (the body names the import). */
export const PAYOUT_IMPORT_DUPLICATE_FILE = 'PAYOUT_IMPORT_DUPLICATE_FILE';
/** 422: the file could not be read as a chargeback report (`reason` says why). */
export const PAYOUT_IMPORT_UNREADABLE_FILE = 'PAYOUT_IMPORT_UNREADABLE_FILE';
/** 400: a commit while some line still needs a person. */
export const PAYOUT_IMPORT_UNRESOLVED_ROWS = 'PAYOUT_IMPORT_UNRESOLVED_ROWS';
/** 409: the import was already committed or discarded. */
export const PAYOUT_IMPORT_NOT_EDITABLE = 'PAYOUT_IMPORT_NOT_EDITABLE';
/**
 * 409: since the preview was made, some of its lines' policies were charged
 * back (another import, or the app). Those lines are now duplicates; the body
 * lists their `rowNumbers`. Review them and commit again.
 */
export const PAYOUT_IMPORT_CHARGED_SINCE = 'PAYOUT_IMPORT_CHARGED_SINCE';
/** 400: a duplicate line cannot be charged — its policy is charged once. */
export const PAYOUT_IMPORT_ALREADY_CHARGED = 'PAYOUT_IMPORT_ALREADY_CHARGED';

/** Why a file was refused (`PAYOUT_IMPORT_UNREADABLE_FILE`). */
export const CHARGEBACK_FILE_ERROR_REASONS = [
  'unreadable',
  'no_header',
  'missing_columns',
  'no_rows',
  'too_many_rows',
] as const;
export type ChargebackFileErrorReason =
  (typeof CHARGEBACK_FILE_ERROR_REASONS)[number];

export interface ImportRowPersonView {
  userId: string;
  name: string;
  status: PayoutPersonStatus;
}

export interface ImportRowCandidateView extends ImportRowPersonView {
  via: ImportMatchSignal;
}

/** One line of the report, as read and as matched. */
export interface ChargebackImportRowView {
  /** The line's row in the sheet, 1-based — what the owner sees in Excel. */
  rowNumber: number;
  /** As the file says. */
  bindId: string | null;
  producerName: string | null;
  policyNumber: string | null;
  customerName: string | null;
  policyType: string | null;
  /** The policy's carrier when the app holds it, else the file's or the import's. */
  carrier: string;
  /** `YYYY-MM-DD`, when the file has the column. */
  soldDay: string | null;
  occurredDay: string | null;
  terminationReason: string | null;
  /** Premium dollars, positive. */
  amount: number;
  /** The app's policy with that number, when there is one. */
  policy: {
    id: string;
    policyNumber: string;
    policyType: string | null;
    householdId: string | null;
  } | null;
  /** The people the signals point at (one per signal that found someone). */
  candidates: ImportRowCandidateView[];
  /** Who a commit charges: the owner's choice, else the match. */
  chargedTo: ImportRowPersonView | null;
  /** What matching decided, and what `reset` returns to. */
  autoResolution: ImportRowResolution;
  resolution: ImportRowResolution;
  notes: ImportRowNote[];
  /** The chargeback already on this policy — the original a duplicate keeps. */
  existingChargeback: ImportExistingChargebackView | null;
  /** The earlier line of this file that charges the same policy. */
  repeatOfRow: number | null;
  /** The ledger row a commit wrote. */
  chargebackId: string | null;
}

/** The original chargeback a duplicate line leaves standing. */
export interface ImportExistingChargebackView {
  id: string;
  reason: ChargebackReason;
  source: ChargebackSource;
  /** Premium dollars, positive. */
  amount: number;
  /** ISO-8601. */
  occurredAt: string;
  /** The pay month it counts in, `YYYY-MM` (report and manual rows only). */
  statementMonth: string | null;
  producerName: string;
}

export interface ImportRowCounts {
  rows: number;
  matched: number;
  assigned: number;
  unmatched: number;
  skipped: number;
  duplicate: number;
  /** Lines a commit writes, and their premium total. */
  toCharge: number;
  amountToCharge: number;
}

/** Tallies the lines by resolution; the amount is summed in cents. */
export function importRowCounts(
  rows: readonly { resolution: ImportRowResolution; amount: number }[],
): ImportRowCounts {
  const counts: ImportRowCounts = {
    rows: rows.length,
    matched: 0,
    assigned: 0,
    unmatched: 0,
    skipped: 0,
    duplicate: 0,
    toCharge: 0,
    amountToCharge: 0,
  };
  let cents = 0;
  for (const row of rows) {
    counts[row.resolution] += 1;
    if (isChargedResolution(row.resolution)) {
      counts.toCharge += 1;
      cents += Math.round(row.amount * 100);
    }
  }
  counts.amountToCharge = cents / 100;
  return counts;
}

/**
 * What a commit did. It writes the ledger rows, then recalculates the month
 * when it has been calculated: `no_run` — not yet (the chargebacks are picked
 * up when it is); `busy` — a calculation was running; `failed` — it threw
 * (the chargebacks stand; Recalculate from the Payouts page).
 */
export const IMPORT_RECALCULATION_OUTCOMES = [
  'recalculated',
  'no_run',
  'busy',
  'failed',
] as const;
export type ImportRecalculationOutcome =
  (typeof IMPORT_RECALCULATION_OUTCOMES)[number];

export interface ChargebackImportCommitResult {
  written: number;
  amount: number;
  recalculation: ImportRecalculationOutcome;
  runId: string | null;
  /** Draft and disputed statements rewritten. */
  recalculated: number;
  /**
   * Sent or accepted statements of people charged here, left as they were —
   * the owner reopens any that must change.
   */
  untouched: {
    statementId: string;
    userName: string;
    status: PayStatementStatus;
  }[];
}

export interface ChargebackImportSummary {
  id: string;
  carrier: string;
  /** The pay month the chargebacks count in, `YYYY-MM`. */
  month: string;
  status: ChargebackImportStatus;
  filename: string;
  format: 'xlsx' | 'csv';
  counts: ImportRowCounts;
  /** Lines left out while reading (no amount, …). */
  warnings: string[];
  /** ISO-8601. */
  createdAt: string;
  createdByName: string | null;
  committedAt: string | null;
  discardedAt: string | null;
  result: ChargebackImportCommitResult | null;
}

export interface ChargebackImportView extends ChargebackImportSummary {
  sheetName: string | null;
  headerRowNumber: number;
  /** Each field read, and the file's header it was read from. */
  columns: { field: string; header: string }[];
  rows: ChargebackImportRowView[];
}

export interface ChargebackImportsResponse {
  imports: ChargebackImportSummary[];
}

/** `POST /payouts/imports/presign`. */
export interface ChargebackImportPresignResponse {
  key: string;
  uploadUrl: string;
  requiredHeaders: Record<string, string>;
  expiresIn: number;
}

/** `POST /payouts/imports`. */
export interface CreateChargebackImportInput {
  storageKey: string;
  uploadedFilename: string;
  size: number;
  /** For lines that name no carrier and match no policy. */
  carrier: string;
  month: string;
}

/**
 * `PATCH /payouts/imports/:id/rows/:rowNumber`. A duplicate line takes none:
 * its policy is charged once (400 `PAYOUT_IMPORT_ALREADY_CHARGED`).
 */
export type ImportRowAction =
  | { action: 'assign'; userId: string }
  | { action: 'skip' }
  | { action: 'reset' };

export interface UpdateImportRowResponse {
  row: ChargebackImportRowView;
  counts: ImportRowCounts;
}

export interface ChargebackImportCommitResponse {
  import: ChargebackImportView;
  result: ChargebackImportCommitResult;
}

/** Anyone a line may be charged to, people who have left included. */
export interface ImportPersonOption {
  id: string;
  name: string;
  status: PayoutPersonStatus;
  branchName: string | null;
  allstateBindId: string | null;
}

export interface ImportPeopleResponse {
  people: ImportPersonOption[];
}
