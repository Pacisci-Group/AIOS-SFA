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
}

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
}

/** Either section may be sent alone; a section that is sent is sent whole. */
export interface UpdatePayoutSettingsInput {
  teamBonus?: TeamBonusSettings;
  salespersonOfMonth?: SalespersonOfMonthSettings;
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
 * → `sent` again as the next version. Only PAC-178's `draft` is written
 * today; sending and sign-off arrive with PAC-181/182.
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
  grossCommission: number;
  /** The commission given back on the chargebacks. */
  chargebackImpact: number;
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
}

/** One chargeback ledger row, as the activity view lists it. */
export interface PayoutActivityChargebackView {
  chargebackId: string;
  policyId: string | null;
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

/** A chargeback on a statement: the activity row plus what it cost in commission. */
export interface StatementChargebackView extends PayoutActivityChargebackView {
  /** Set when it reverses a sale paid a lead-source rate. */
  leadSourceId: string | null;
  ratePercent: number;
  commissionDeduction: number;
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
}

/** The Commission Statement's summary grid. */
export interface StatementTotalsView {
  grossPremium: number;
  chargebackTotal: number;
  netPremium: number;
  grossCommission: number;
  chargebackImpact: number;
  tierBonus: number;
  teamBonus: number;
  somBonus: number;
  hatTrickBonus: number;
  /** Other Bonuses / SPIFFs. */
  spiffs: number;
  complianceAdjustment: number;
  otherAdjustments: number;
  netCommission: number;
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
  warnings: string[];
}

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
  totals: { grossPremium: number; netCommission: number };
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
