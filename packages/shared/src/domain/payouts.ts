import { carrierSlug, normalizeCarrier } from './carrier';

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
