import { carrierSlug, normalizeCarrier } from './carrier';
import type { ChargebackReason, ChargebackSource } from './chargeback';
import {
  ANY_CARRIER,
  bundleMinimumFor,
  levelsReached,
  PAYOUT_BUNDLE_MIN_POLICIES,
  PAYOUT_NO_CARRIER,
  rateFor,
  rateForCarrier,
  rateRuleCarrierLabel,
  rateRuleKey,
  sortBonusTiers,
  teamPoolFor,
  type BonusTier,
  type ComplianceFloor,
  type HatTrickRule,
  type LeadSourceRateRule,
  type OverrideRule,
  type PayoutPool,
  type ReferralRule,
  type StatementInputs,
  type TeamRequirements,
  type PayoutRunTeamBonusView,
  type PremiumLineView,
  type RateRule,
  type SalespersonOfMonthSettings,
  type StatementAdjustmentKind,
  type StatementBonusesView,
  type StatementChargebackView,
  type StatementDealView,
  type StatementIndicatorsView,
  type StatementRateSource,
  type StatementTotalsView,
  type TeamBonusSettings,
} from './payouts';
import { normalizePolicyType } from './policy-type';

/**
 * The commission statement engine (PAC-178): pure functions from one
 * person's month — sales, chargebacks, the structure, the agency-wide team
 * context, the manager's adjustments — to the statement's lines, bonuses,
 * indicators and totals. No dates, no database: the API's loaders
 * (`common/payouts/`) gather the inputs and the job and the endpoints store
 * what this returns, so the 1st-of-month draft and a Recalculate compute the
 * same way.
 *
 * ## The rules, in one place (PAC-176 epic, plan §3, §12, §13)
 *
 * - **Premium is bucketed** by carrier and, where a lead-source rate applies,
 *   by lead source; each bucket is paid at its own rate ({@link rateFor}). A
 *   bucket that is not paid a lead-source rate **folds into its carrier's
 *   line** (owner's choice, 5 Nov 2026) — the totals are the same either way,
 *   and a structure with no overrides prints the plain carrier table.
 * - **Chargebacks** are premium dollars taken off the bucket of the sale they
 *   reverse; each costs its amount at that bucket's rate. A bucket may go
 *   negative — there is no floor.
 * - **Thresholds use gross premium** (tiers, the team levels, Salesperson of
 *   the Month); the rate applies to net. Gross commission minus the
 *   chargebacks' commission is the same thing as the rate on net premium,
 *   line by line — the PDF prints it that way round.
 * - **A bundle is a sale with two or more policies**
 *   ({@link PAYOUT_BUNDLE_MIN_POLICIES}), not `Deal.isBundle`. A carrier's
 *   minimum bundle rate only **flags** the statement.
 *
 * ## Money
 *
 * Every input amount has at most two decimals, so the engine works in whole
 * cents: sums are exact, a rate is applied in integers (cents × basis points)
 * and rounded half away from zero once, per line, and a pool is split by
 * largest remainder so the shares add up to the pool exactly.
 */

// ── Money ───────────────────────────────────────────────────────────────

/** Dollars with at most two decimals → whole cents. */
export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

function fromCents(cents: number): number {
  return cents / 100;
}

/** Any amount to the cent, half away from zero. */
export function roundToCents(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const sign = value < 0 ? -1 : 1;
  return (sign * Math.round(Math.abs(value) * 100 + 1e-7)) / 100;
}

/**
 * `ratePercent` % of `cents`, in cents: cents × basis points is an exact
 * integer, divided once and rounded half away from zero.
 */
function percentOfCents(cents: number, ratePercent: number): number {
  const product = cents * Math.round(ratePercent * 100);
  if (product === 0) return 0;
  const sign = product < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(product) / 10_000);
}

/** `ratePercent` % of `amount`, to the cent. */
export function percentOf(amount: number, ratePercent: number): number {
  return fromCents(percentOfCents(toCents(amount), ratePercent));
}

function sumCents(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + toCents(value), 0);
}

/** `part / whole` as a percentage to two decimals; `null` when `whole` is 0. */
function ratioPercent(part: number, whole: number): number | null {
  return whole > 0 ? roundToCents((part / whole) * 100) : null;
}

/** "$1,234.5" → "$1,234.50"; whole dollars without cents. For warnings. */
function moneyText(amount: number): string {
  const whole = Number.isInteger(amount);
  return `${amount < 0 ? '-' : ''}$${Math.abs(amount).toLocaleString('en-US', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Largest-remainder allocation of `amount` by `weights` (dollars), to the
 * cent: every share is the floor of its exact cents and the cents left over
 * go to the largest remainders (ties: the larger weight, then the id), so
 * the shares sum to `amount` exactly. A zero or negative weight gets 0; with
 * no positive weight nothing is allocated.
 */
export function allocatePool(
  amount: number,
  weights: readonly { id: string; weight: number }[],
): Map<string, number> {
  const totalCents = toCents(amount);
  const shares = new Map<string, number>(weights.map((w) => [w.id, 0]));
  const positive = weights
    .map((w) => ({ id: w.id, cents: toCents(w.weight) }))
    .filter((w) => w.cents > 0);
  const totalWeight = positive.reduce((sum, w) => sum + w.cents, 0);
  if (totalCents <= 0 || totalWeight <= 0) return shares;

  const exact = positive.map((w) => {
    const raw = (totalCents * w.cents) / totalWeight;
    const floor = Math.floor(raw);
    return { ...w, floor, remainder: raw - floor };
  });
  let leftover = totalCents - exact.reduce((sum, w) => sum + w.floor, 0);
  const order = [...exact].sort(
    (a, b) =>
      b.remainder - a.remainder ||
      b.cents - a.cents ||
      a.id.localeCompare(b.id),
  );
  const extra = new Map<string, number>();
  for (const w of order) {
    if (leftover <= 0) break;
    extra.set(w.id, 1);
    leftover -= 1;
  }
  for (const w of exact) {
    shares.set(w.id, fromCents(w.floor + (extra.get(w.id) ?? 0)));
  }
  return shares;
}

// ── Carriers ────────────────────────────────────────────────────────────

/** A stored carrier as a statement shows it: canonical, or {@link PAYOUT_NO_CARRIER}. */
export function payoutCarrierName(raw: string | null | undefined): string {
  return normalizeCarrier(raw) || PAYOUT_NO_CARRIER;
}

/** Grouping key: `B4tEH`, `Allstate` and ` allstate ` are one carrier. */
function carrierKey(name: string): string {
  return name === PAYOUT_NO_CARRIER ? '' : carrierSlug(name);
}

// ── Inputs ──────────────────────────────────────────────────────────────

/** One policy line of a sale, as `linesPrefix` builds it. */
export interface PayoutSaleLine {
  carrier: string | null;
  policyType: string | null;
  premium: number;
  /** `false` for the one line standing in for a sale with no policies. */
  typed: boolean;
}

export interface PayoutSale {
  dealId: string;
  /** ISO-8601 instant. */
  soldDate: string;
  /** The agency-local day, `YYYY-MM-DD`. */
  soldDay: string;
  clientName: string;
  /** The deal's own policy types — what a sale with no policies shows. */
  policyTypes: readonly string[];
  /** The lead's source, the deal's own as the fallback (`sourceStages`). */
  leadSourceId: string | null;
  lines: readonly PayoutSaleLine[];
  /**
   * The agency-local day the sale was entered in the app (`Deal.createdAt`),
   * `YYYY-MM-DD` — what the Sold Log requirement compares with `soldDay`.
   */
  enteredDay?: string | null;
}

/**
 * One slice of the agency's sold premium for the month: everyone's sales,
 * on a structure or not, by seller, lead source and carrier. What overrides
 * and agency-premium tiers are measured on.
 */
export interface AgencySaleLine {
  producerId: string;
  leadSourceId: string | null;
  carrier: string | null;
  premium: number;
}

export interface PayoutChargeback {
  chargebackId: string;
  policyId: string | null;
  policyNumber: string | null;
  policyType: string | null;
  /** The policy's carrier as stored. */
  carrier: string | null;
  /** The source of the sale it reverses; `null` with no deal. */
  leadSourceId: string | null;
  customerName: string | null;
  amount: number;
  occurredAt: string;
  occurredDay: string;
  reason: ChargebackReason;
  source: ChargebackSource;
}

export interface PayoutAdjustment {
  id: string;
  kind: StatementAdjustmentKind;
  chargebackId: string | null;
  amount: number | null;
  note: string;
}

/** The parts of a payment structure the math reads. */
export interface StatementRules {
  rules: readonly RateRule[];
  leadSourceRules: readonly LeadSourceRateRule[];
  hatTrick: HatTrickRule;
  individualTiers: readonly BonusTier[];
  tiersStackable: boolean;
  teamBonusEligible: boolean;
  basePay: number;
  stipendAmounts: readonly number[];
  complianceFloor: ComplianceFloor | null;
  overrides: readonly OverrideRule[];
  agencyTiers: readonly BonusTier[];
  agencyTiersCarrier: string;
  teamRequirements: TeamRequirements;
  referralRule: ReferralRule | null;
  chargebackWindowMonths: number | null;
}

export interface ComputeStatementInput {
  /** The pay month, `YYYY-MM`. */
  month: string;
  /** Whose statement — what a lead-source override leaves out. */
  userId: string;
  structure: StatementRules;
  /** The figures the manager entered on the statement. */
  inputs: StatementInputs;
  /** The member's start month, for the stipend; `null` = not set. */
  startMonth: string | null;
  /** `false` for someone no longer active: their base pay is left off. */
  basePayApplies: boolean;
  /** The whole agency's sales for the month (overrides, agency tiers). */
  agencySales: readonly AgencySaleLine[];
  producerOfYear: { enabled: boolean; bonusAmount: number; winner: boolean };
  sales: readonly PayoutSale[];
  chargebacks: readonly PayoutChargeback[];
  adjustments: readonly PayoutAdjustment[];
  /** The agency's appointed carriers' names: listed even with no activity. */
  appointedCarriers: readonly string[];
  /** Lead-source id → name, archived sources included. */
  leadSourceNames: ReadonlyMap<string, string>;
  /** The month's sales whose deal audit failed. */
  failedAudits: number;
  /** This person's part of the team bonus ({@link teamBonusFor}). */
  team: StatementBonusesView['team'];
  salespersonOfMonth: {
    enabled: boolean;
    bonusAmount: number;
    winner: boolean;
  };
}

export interface StatementComputation {
  premiumLines: PremiumLineView[];
  deals: StatementDealView[];
  chargebacks: StatementChargebackView[];
  bonuses: StatementBonusesView;
  indicators: StatementIndicatorsView;
  totals: StatementTotalsView;
  warnings: string[];
}

// ── Sales ───────────────────────────────────────────────────────────────

/** A sale as the statement and the activity view list it. */
export function toDealView(
  sale: PayoutSale,
  leadSourceNames: ReadonlyMap<string, string>,
): StatementDealView {
  const typed = sale.lines.filter((line) => line.typed);
  const carriers = [
    ...new Set(
      typed
        .map((line) => normalizeCarrier(line.carrier))
        .filter((name) => name.length > 0),
    ),
  ].sort((a, b) => a.localeCompare(b));
  const types = typed.length
    ? typed.map((line) => normalizePolicyType(line.policyType))
    : sale.policyTypes.map((type) => normalizePolicyType(type));
  return {
    dealId: sale.dealId,
    soldDate: sale.soldDate,
    soldDay: sale.soldDay,
    clientName: sale.clientName,
    policyTypes: [...new Set(types.filter((type) => type.length > 0))],
    carriers,
    policyCount: typed.length,
    premium: fromCents(sumCents(sale.lines.map((line) => line.premium))),
    leadSourceId: sale.leadSourceId,
    leadSourceName: sale.leadSourceId
      ? (leadSourceNames.get(sale.leadSourceId) ?? null)
      : null,
    isBundle: typed.length >= PAYOUT_BUNDLE_MIN_POLICIES,
  };
}

/** The agency-local days on which at least `dealsPerDay` sales were booked. */
export function hatTrickDays(
  sales: readonly Pick<PayoutSale, 'soldDay'>[],
  dealsPerDay: number,
): string[] {
  const perDay = new Map<string, number>();
  for (const sale of sales) {
    perDay.set(sale.soldDay, (perDay.get(sale.soldDay) ?? 0) + 1);
  }
  return [...perDay.entries()]
    .filter(([, count]) => count >= dealsPerDay)
    .map(([day]) => day)
    .sort();
}

// ── The 2026 comp plans: steps, gates, floor ────────────────────────────

/** Months from `from` to `to`, both `YYYY-MM`: `2026-01` → `2026-03` is 2. */
export function monthsBetween(from: string, to: string): number {
  const index = (month: string) => {
    const [year, mon] = month.split('-').map(Number);
    return year * 12 + (mon - 1);
  };
  return index(to) - index(from);
}

/** Days from `from` to `to`, both `YYYY-MM-DD`. */
function daysBetween(from: string, to: string): number {
  const at = (day: string) => {
    const [year, month, date] = day.split('-').map(Number);
    return Date.UTC(year, month - 1, date);
  };
  return Math.round((at(to) - at(from)) / 86_400_000);
}

/** Below the structure's compliance floor — only ever on an entered rate. */
export function complianceBelowFloor(
  floor: ComplianceFloor | null,
  inputs: Pick<StatementInputs, 'compliancePercent'>,
): boolean {
  return (
    floor !== null &&
    inputs.compliancePercent !== null &&
    inputs.compliancePercent < floor.minimumPercent
  );
}

/** A gate is met when it is off, or the figure is known and high enough. */
function gateMet(minimum: number | null | undefined, value: number | null) {
  return minimum === null || minimum === undefined
    ? true
    : value !== null && value >= minimum;
}

const percentText = (value: number | null) =>
  value === null ? 'not entered' : `${value}%`;

/** Sales with two or more policies ÷ sales, all carriers; `null` with none. */
export function salesBundleRate(sales: readonly PayoutSale[]): number | null {
  const bundled = sales.filter(
    (sale) =>
      sale.lines.filter((line) => line.typed).length >=
      PAYOUT_BUNDLE_MIN_POLICIES,
  ).length;
  return ratioPercent(bundled, sales.length);
}

export interface AppliedRate {
  ratePercent: number;
  /** 1-based, `null` at the base rate. */
  step: number | null;
  threshold: number | null;
  bonusAmount: number;
  /** Why a step reached was not paid, or the measure was missing. */
  notes: string[];
}

/**
 * The rate a rule pays this month: the highest step reached whose gates are
 * met, else the base rate. Below the compliance floor, always the base
 * rate (the 2026 plan: "paid at base commission tier only").
 */
export function appliedRate(
  rule: RateRule,
  month: {
    premium: number;
    retentionPercent: number | null;
    compliancePercent: number | null;
    bundleRate: number | null;
    belowFloor: boolean;
  },
): AppliedRate {
  const base: AppliedRate = {
    ratePercent: rule.ratePercent,
    step: null,
    threshold: null,
    bonusAmount: 0,
    notes: [],
  };
  const steps = [...(rule.steps ?? [])].sort(
    (a, b) => a.threshold - b.threshold,
  );
  if (!steps.length || month.belowFloor) return base;
  const label = rateRuleCarrierLabel(rule.carrier);
  const basis = rule.stepBasis ?? 'premium';
  const measure =
    basis === 'retention' ? month.retentionPercent : month.premium;
  if (measure === null) {
    base.notes.push(
      `${label}: retention is not entered, so the base rate of ` +
        `${rule.ratePercent}% applies.`,
    );
    return base;
  }
  const thresholdText = (threshold: number) =>
    basis === 'retention' ? `${threshold}% retention` : moneyText(threshold);
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (step.threshold > measure) continue;
    const missing: string[] = [];
    if (!gateMet(step.minCompliancePercent, month.compliancePercent)) {
      missing.push(
        `a ${step.minCompliancePercent}% compliance rate ` +
          `(${percentText(month.compliancePercent)})`,
      );
    }
    if (!gateMet(step.minBundleRatePercent, month.bundleRate)) {
      missing.push(
        `a ${step.minBundleRatePercent}% bundle rate ` +
          `(this month: ${percentText(month.bundleRate)})`,
      );
    }
    if (missing.length) {
      base.notes.push(
        `${label}: the ${step.ratePercent}% step at ` +
          `${thresholdText(step.threshold)} is not paid — it needs ` +
          `${missing.join(' and ')}.`,
      );
      continue;
    }
    return {
      ratePercent: step.ratePercent,
      step: index + 1,
      threshold: step.threshold,
      bonusAmount: step.bonusAmount,
      notes: base.notes,
    };
  }
  return base;
}

/**
 * Why the person takes no share of the team pool though their structure
 * takes part: below the compliance floor, a sale entered late in the Sold
 * Log, or meeting attendance not ticked. Empty = they share it.
 */
export function teamBlockReasons(
  structure: Pick<
    StatementRules,
    'complianceFloor' | 'teamRequirements' | 'teamBonusEligible'
  >,
  sales: readonly Pick<PayoutSale, 'soldDay' | 'enteredDay'>[],
  inputs: StatementInputs,
): string[] {
  if (!structure.teamBonusEligible) return [];
  const reasons: string[] = [];
  if (complianceBelowFloor(structure.complianceFloor, inputs)) {
    reasons.push(
      `The compliance rate of ${inputs.compliancePercent}% is below the ` +
        `${structure.complianceFloor?.minimumPercent}% floor.`,
    );
  }
  const days = structure.teamRequirements.soldLogWithinDays;
  if (days !== null) {
    const late = sales.filter(
      (sale) =>
        sale.enteredDay &&
        sale.soldDay &&
        daysBetween(sale.soldDay, sale.enteredDay) > days,
    ).length;
    if (late > 0) {
      reasons.push(
        `${late} ${late === 1 ? 'sale was' : 'sales were'} entered more ` +
          `than ${days} ${days === 1 ? 'day' : 'days'} after the sold date.`,
      );
    }
  }
  if (structure.teamRequirements.meetingAttendance) {
    if (inputs.meetingAttendance === null) {
      reasons.push('Sales meeting attendance is not entered.');
    } else if (!inputs.meetingAttendance) {
      reasons.push('Sales meeting attendance was not met.');
    }
  }
  return reasons;
}

/** The stipend for `month`: month 1 is the start month; `null` start = none. */
export function stipendFor(
  amounts: readonly number[],
  startMonth: string | null,
  month: string,
): number {
  if (!amounts.length || !startMonth) return 0;
  const index = monthsBetween(startMonth, month);
  return index >= 0 && index < amounts.length ? amounts[index] : 0;
}

/** What a referral count earns (+) or costs (−); `0` when not entered. */
export function referralAdjustment(
  rule: ReferralRule,
  count: number | null,
): number {
  if (count === null) return 0;
  if (count < rule.minimum) return -rule.shortfallDeduction;
  if (rule.bonusThreshold !== null && count >= rule.bonusThreshold) {
    return rule.bonusAmount;
  }
  return 0;
}

/** The agency's premium on `carrier` (any carrier: all of it). */
function agencyPremiumCents(
  lines: readonly AgencySaleLine[],
  carrier: string,
  keep: (line: AgencySaleLine) => boolean = () => true,
): number {
  const key = rateRuleKey(carrier);
  return lines
    .filter(
      (line) =>
        keep(line) &&
        (key === ANY_CARRIER || rateRuleKey(line.carrier ?? '') === key),
    )
    .reduce((sum, line) => sum + toCents(line.premium), 0);
}

// ── Lines ───────────────────────────────────────────────────────────────

interface LineAccumulator {
  key: string;
  carrier: string;
  leadSourceId: string | null;
  ratePercent: number;
  rateSource: StatementRateSource;
  rateStep: number | null;
  appointed: boolean;
  grossCents: number;
  chargebackCents: number;
  impactCents: number;
}

/**
 * The line a sale (or the chargeback reversing it) lands on, with its rate.
 * A lead-source rate gets a line of its own; anything else folds into the
 * carrier's line at the carrier's rate — the step it reached, when the rule
 * is stepped (`steps`: rule key → the rate it applies).
 */
function lineFor(
  structure: Pick<StatementRules, 'rules' | 'leadSourceRules'>,
  steps: ReadonlyMap<string, AppliedRate>,
  carrier: string,
  leadSourceId: string | null,
): Pick<
  LineAccumulator,
  'key' | 'carrier' | 'leadSourceId' | 'ratePercent' | 'rateSource' | 'rateStep'
> {
  const carrierArg = carrier === PAYOUT_NO_CARRIER ? null : carrier;
  const key = carrierKey(carrier);
  if (leadSourceId) {
    const resolved = rateFor(structure.rules, structure.leadSourceRules, {
      carrier: carrierArg,
      leadSourceId,
    });
    if (
      resolved &&
      (resolved.source === 'lead_source_carrier' ||
        resolved.source === 'lead_source')
    ) {
      return {
        key: `${key}|${leadSourceId.toLowerCase()}`,
        carrier,
        leadSourceId,
        ratePercent: resolved.ratePercent,
        rateSource: resolved.source,
        rateStep: null,
      };
    }
  }
  const base = rateForCarrier(structure.rules, carrierArg);
  const applied = base
    ? steps.get(
        base.source === 'any' ? ANY_CARRIER : rateRuleKey(carrierArg ?? ''),
      )
    : undefined;
  return {
    key: `${key}|`,
    carrier,
    leadSourceId: null,
    ratePercent: applied?.ratePercent ?? base?.ratePercent ?? 0,
    rateSource: base?.source ?? 'none',
    rateStep: applied?.step ?? null,
  };
}

/** Per carrier key: sales including it, and how many of those are bundles. */
function bundleCounts(
  deals: readonly StatementDealView[],
): Map<string, { sales: number; bundled: number }> {
  const counts = new Map<string, { sales: number; bundled: number }>();
  for (const deal of deals) {
    for (const carrier of deal.carriers) {
      const key = carrierKey(carrier);
      const entry = counts.get(key) ?? { sales: 0, bundled: 0 };
      entry.sales += 1;
      if (deal.isBundle) entry.bundled += 1;
      counts.set(key, entry);
    }
  }
  return counts;
}

// ── Team & Salesperson of the Month ─────────────────────────────────────

export interface TeamMember {
  userId: string;
  pool: PayoutPool;
  grossPremium: number;
  /** On a structure with `teamBonusEligible`. */
  eligible: boolean;
}

/** The month's team bonus for the whole agency, and every member's share. */
export interface TeamContext extends PayoutRunTeamBonusView {
  /** userId → share of their half of the pool. */
  shares: Record<string, number>;
  warnings: string[];
}

const POOL_LABELS: Record<PayoutPool, string> = {
  csr: 'CSR',
  producer: 'producer',
};

/**
 * The team bonus for a month: the pool the agency's premium earned
 * ({@link teamPoolFor} — every level reached when stacking, else the
 * highest), split `csrSharePercent` / the rest between CSRs and producers,
 * and each half shared by the eligible members of that group in proportion
 * to their gross premium ({@link allocatePool}).
 *
 * The CSR half is computed and the producer half is what remains, so the two
 * add up to the pool even where both percentages round. A half with no
 * eligible seller is not paid out, and says so.
 */
export function computeTeamContext(
  settings: TeamBonusSettings,
  agencyGrossPremium: number,
  members: readonly TeamMember[],
): TeamContext {
  const poolAmount = teamPoolFor(settings, agencyGrossPremium);
  const lowest = sortBonusTiers(settings.levels)[0];
  const met =
    settings.enabled &&
    lowest !== undefined &&
    lowest.thresholdPremium <= agencyGrossPremium;
  const poolCents = toCents(poolAmount);
  const csrCents = percentOfCents(poolCents, settings.csrSharePercent);
  const pools: Record<PayoutPool, number> = {
    csr: fromCents(csrCents),
    producer: fromCents(poolCents - csrCents),
  };

  const shares: Record<string, number> = {};
  const premium: Record<PayoutPool, number> = { csr: 0, producer: 0 };
  const warnings: string[] = [];
  for (const pool of ['csr', 'producer'] as const) {
    const group = members.filter((m) => m.eligible && m.pool === pool);
    premium[pool] = fromCents(sumCents(group.map((m) => m.grossPremium)));
    const allocated = allocatePool(
      pools[pool],
      group.map((m) => ({ id: m.userId, weight: m.grossPremium })),
    );
    for (const [userId, share] of allocated) shares[userId] = share;
    if (pools[pool] > 0 && premium[pool] <= 0) {
      warnings.push(
        `No team-eligible ${POOL_LABELS[pool]} sold this month, so the ` +
          `${POOL_LABELS[pool]} share of the team pool ` +
          `(${moneyText(pools[pool])}) is not paid out.`,
      );
    }
  }

  return {
    enabled: settings.enabled,
    stackable: settings.stackable,
    levels: sortBonusTiers(settings.levels).map((level) => ({
      thresholdPremium: level.thresholdPremium,
      poolAmount: level.poolAmount,
    })),
    met,
    poolAmount,
    csrSharePercent: settings.csrSharePercent,
    producerSharePercent: settings.producerSharePercent,
    csrPool: pools.csr,
    producerPool: pools.producer,
    csrPremium: premium.csr,
    producerPremium: premium.producer,
    shares,
    warnings,
  };
}

/** One person's part of the team bonus, as their statement shows it. */
export function teamBonusFor(
  context: Omit<TeamContext, 'warnings'>,
  member: { userId: string; pool: PayoutPool; eligible: boolean },
): StatementBonusesView['team'] {
  const groupPool =
    member.pool === 'csr' ? context.csrPool : context.producerPool;
  const groupPremium =
    member.pool === 'csr' ? context.csrPremium : context.producerPremium;
  return {
    eligible: member.eligible,
    met: context.met,
    poolAmount: context.poolAmount,
    pool: member.pool,
    groupPool,
    groupPremium,
    amount: member.eligible ? (context.shares[member.userId] ?? 0) : 0,
  };
}

/**
 * Salesperson of the Month (plan A12): the statement recipients with the
 * highest gross premium — every one of them on a tie. Nobody wins a month
 * in which nobody sold, and nobody wins while the bonus is off.
 */
export function salespersonOfMonthWinners(
  settings: SalespersonOfMonthSettings,
  people: readonly { userId: string; grossPremium: number }[],
): { topGrossPremium: number | null; winnerIds: string[] } {
  if (!settings.enabled) return { topGrossPremium: null, winnerIds: [] };
  const top = people.reduce(
    (max, person) => Math.max(max, toCents(person.grossPremium)),
    0,
  );
  if (top <= 0) return { topGrossPremium: null, winnerIds: [] };
  return {
    topGrossPremium: fromCents(top),
    winnerIds: people
      .filter((person) => toCents(person.grossPremium) === top)
      .map((person) => person.userId)
      .sort(),
  };
}

// ── The statement ───────────────────────────────────────────────────────

function compareLines(
  a: LineAccumulator,
  b: LineAccumulator,
  names: ReadonlyMap<string, string>,
): number {
  if (a.carrier !== b.carrier) {
    if (a.carrier === PAYOUT_NO_CARRIER) return 1;
    if (b.carrier === PAYOUT_NO_CARRIER) return -1;
    return a.carrier.localeCompare(b.carrier);
  }
  if (!a.leadSourceId) return b.leadSourceId ? -1 : 0;
  if (!b.leadSourceId) return 1;
  return (names.get(a.leadSourceId) ?? a.leadSourceId).localeCompare(
    names.get(b.leadSourceId) ?? b.leadSourceId,
  );
}

/** One person's statement for one month. */
export function computeStatement(
  input: ComputeStatementInput,
): StatementComputation {
  const { structure, leadSourceNames, inputs } = input;
  const warnings: string[] = [];
  const belowFloor = complianceBelowFloor(structure.complianceFloor, inputs);
  const grossPremiumIn = salesGrossPremium(input.sales);
  const overallBundleRate = salesBundleRate(input.sales);

  // Each rule's rate this month: its base, or the step it reached.
  const steps = new Map<string, AppliedRate>();
  const stepBonuses: NonNullable<StatementBonusesView['rateSteps']> = [];
  for (const rule of structure.rules) {
    const applied = appliedRate(rule, {
      premium: grossPremiumIn,
      retentionPercent: inputs.retentionPercent,
      compliancePercent: inputs.compliancePercent,
      bundleRate: overallBundleRate,
      belowFloor,
    });
    steps.set(rateRuleKey(rule.carrier), applied);
    warnings.push(...applied.notes);
    if (applied.step !== null && applied.bonusAmount > 0) {
      stepBonuses.push({
        carrier: rateRuleCarrierLabel(rule.carrier),
        step: applied.step,
        threshold: applied.threshold ?? 0,
        ratePercent: applied.ratePercent,
        bonusAmount: applied.bonusAmount,
      });
    }
  }
  const lineTarget = (carrier: string, leadSourceId: string | null) =>
    lineFor(structure, steps, carrier, leadSourceId);

  // Carrier names: the appointment's spelling wins, else the first seen.
  const appointedKeys = new Set<string>();
  const lines = new Map<string, LineAccumulator>();
  const ensureLine = (target: ReturnType<typeof lineFor>): LineAccumulator => {
    let line = lines.get(target.key);
    if (!line) {
      line = {
        ...target,
        appointed: appointedKeys.has(carrierKey(target.carrier)),
        grossCents: 0,
        chargebackCents: 0,
        impactCents: 0,
      };
      lines.set(target.key, line);
    }
    return line;
  };
  const displayName = new Map<string, string>();
  const nameOf = (raw: string | null): string => {
    const name = payoutCarrierName(raw);
    const key = carrierKey(name);
    const known = displayName.get(key);
    if (known) return known;
    displayName.set(key, name);
    return name;
  };
  for (const raw of input.appointedCarriers) {
    const name = nameOf(raw);
    if (name === PAYOUT_NO_CARRIER) continue;
    appointedKeys.add(carrierKey(name));
    ensureLine(lineTarget(name, null));
  }

  // Sales.
  const deals = input.sales
    .map((sale) => toDealView(sale, leadSourceNames))
    .sort(
      (a, b) =>
        a.soldDate.localeCompare(b.soldDate) ||
        a.clientName.localeCompare(b.clientName),
    );
  let untypedCents = 0;
  for (const sale of input.sales) {
    for (const saleLine of sale.lines) {
      const carrier = nameOf(saleLine.carrier);
      const line = ensureLine(lineTarget(carrier, sale.leadSourceId));
      line.grossCents += toCents(saleLine.premium);
      if (carrier === PAYOUT_NO_CARRIER) {
        untypedCents += toCents(saleLine.premium);
      }
    }
  }

  // Chargebacks, each on the line of the sale it reverses. One older than
  // the structure's window (months after its cancellation) is left out.
  const exclusions = new Map<string, string>();
  for (const adjustment of input.adjustments) {
    if (adjustment.kind === 'exclude_chargeback' && adjustment.chargebackId) {
      exclusions.set(adjustment.chargebackId, adjustment.note);
    }
  }
  const windowMonths = structure.chargebackWindowMonths;
  const chargebacks: StatementChargebackView[] = input.chargebacks
    .map((row) => {
      const carrier = nameOf(row.carrier);
      const target = lineTarget(carrier, row.leadSourceId);
      const line = ensureLine(target);
      const deduction = percentOf(row.amount, target.ratePercent);
      const outOfWindow =
        windowMonths !== null &&
        /^\d{4}-\d{2}/.test(row.occurredDay) &&
        monthsBetween(row.occurredDay.slice(0, 7), input.month) > windowMonths;
      const excluded = exclusions.has(row.chargebackId) || outOfWindow;
      if (!excluded) {
        line.chargebackCents += toCents(row.amount);
        line.impactCents += toCents(deduction);
      }
      return {
        chargebackId: row.chargebackId,
        policyId: row.policyId,
        policyNumber: row.policyNumber,
        policyType: row.policyType ? normalizePolicyType(row.policyType) : null,
        carrier,
        customerName: row.customerName,
        amount: row.amount,
        occurredAt: row.occurredAt,
        occurredDay: row.occurredDay,
        reason: row.reason,
        source: row.source,
        leadSourceId: target.leadSourceId,
        ratePercent: target.ratePercent,
        commissionDeduction: deduction,
        excluded,
        excludedNote: exclusions.has(row.chargebackId)
          ? (exclusions.get(row.chargebackId) ?? '')
          : outOfWindow
            ? `More than ${windowMonths} months after the cancellation, so it is not charged.`
            : null,
      };
    })
    .sort(
      (a, b) =>
        a.occurredAt.localeCompare(b.occurredAt) ||
        a.chargebackId.localeCompare(b.chargebackId),
    );

  // Bundle rates per carrier, flagged on every line of the carrier.
  const bundles = bundleCounts(deals);
  const shortfalls = new Set<string>();
  const premiumLines: PremiumLineView[] = [...lines.values()]
    .sort((a, b) => compareLines(a, b, leadSourceNames))
    .map((line) => {
      const key = carrierKey(line.carrier);
      const counts = key ? bundles.get(key) : undefined;
      const bundleRate = counts
        ? ratioPercent(counts.bundled, counts.sales)
        : null;
      const minimum =
        line.carrier === PAYOUT_NO_CARRIER
          ? null
          : bundleMinimumFor(structure.rules, line.carrier);
      const shortfall =
        bundleRate !== null && minimum !== null && bundleRate < minimum;
      if (shortfall && !shortfalls.has(key)) {
        shortfalls.add(key);
        warnings.push(
          `${line.carrier} bundle rate ${bundleRate}% is below the ` +
            `${minimum}% minimum.`,
        );
      }
      const grossCommissionCents = percentOfCents(
        line.grossCents,
        line.ratePercent,
      );
      return {
        carrier: line.carrier,
        leadSourceId: line.leadSourceId,
        leadSourceName: line.leadSourceId
          ? (leadSourceNames.get(line.leadSourceId) ?? null)
          : null,
        appointed: line.appointed,
        grossPremium: fromCents(line.grossCents),
        chargebacks: fromCents(line.chargebackCents),
        netPremium: fromCents(line.grossCents - line.chargebackCents),
        ratePercent: line.ratePercent,
        rateSource: line.rateSource,
        grossCommission: fromCents(grossCommissionCents),
        chargebackImpact: fromCents(line.impactCents),
        netCommission: fromCents(grossCommissionCents - line.impactCents),
        bundleRate,
        minBundleRatePercent: minimum,
        bundleShortfall: shortfall,
        rateStep: line.rateStep,
      };
    });

  for (const line of premiumLines) {
    if (
      line.rateSource === 'none' &&
      (line.grossPremium !== 0 || line.chargebacks !== 0)
    ) {
      warnings.push(
        `No rate on this structure covers ${line.carrier}, so its premium ` +
          `is paid at 0%.`,
      );
    }
  }
  if (untypedCents !== 0) {
    warnings.push(
      `${moneyText(fromCents(untypedCents))} of sold premium has no carrier ` +
        `recorded.`,
    );
  }

  // The compliance floor, and figures the structure needs but are missing.
  if (belowFloor) {
    warnings.push(
      `The compliance rate of ${inputs.compliancePercent}% is below the ` +
        `${structure.complianceFloor?.minimumPercent}% floor: no Sales of ` +
        `the Month, hat trick, team or tier bonuses, every rate at its base, ` +
        `and ${structure.complianceFloor?.reductionPercent}% off variable pay.`,
    );
  }

  // Bonuses.
  const grossCents = premiumLines.reduce(
    (sum, line) => sum + toCents(line.grossPremium),
    0,
  );
  const grossPremium = fromCents(grossCents);
  const hatTrick = structure.hatTrick;
  const days = hatTrick.enabled
    ? hatTrickDays(input.sales, hatTrick.dealsPerDay)
    : [];
  const hatTrickBonus = belowFloor
    ? 0
    : fromCents(days.length * toCents(hatTrick.bonusAmount));
  const payableTiers = structure.individualTiers.filter((tier) => {
    if (gateMet(tier.minCompliancePercent, inputs.compliancePercent)) {
      return true;
    }
    if (tier.thresholdPremium <= grossPremium) {
      warnings.push(
        `The ${moneyText(tier.thresholdPremium)} tier ` +
          `(${moneyText(tier.bonusAmount)}) is not paid — it needs a ` +
          `${tier.minCompliancePercent}% compliance rate ` +
          `(${percentText(inputs.compliancePercent)}).`,
      );
    }
    return false;
  });
  const tiers = belowFloor
    ? { amount: 0, levels: [] as BonusTier[] }
    : levelsReached(
        payableTiers,
        grossPremium,
        structure.tiersStackable,
        (tier) => tier.bonusAmount,
      );
  const sortedTiers = sortBonusTiers(structure.individualTiers);
  const highestIndex = sortedTiers.reduce(
    (found, tier, index) =>
      tier.thresholdPremium <= grossPremium ? index : found,
    -1,
  );
  const som = input.salespersonOfMonth;
  const somWinner = som.enabled && som.winner && !belowFloor;
  const somBonus = somWinner ? som.bonusAmount : 0;
  const teamBlocked = teamBlockReasons(structure, input.sales, inputs);
  const teamBonus =
    input.team.eligible && teamBlocked.length === 0 ? input.team.amount : 0;
  const poy = input.producerOfYear;
  const poyBonus = poy.enabled && poy.winner ? poy.bonusAmount : 0;
  const stepBonusCents = belowFloor
    ? 0
    : stepBonuses.reduce((sum, step) => sum + toCents(step.bonusAmount), 0);

  // Pay on other people's premium, and the bonus on the agency's.
  const overrides = structure.overrides.map((rule) => {
    const source = rule.leadSourceId?.toLowerCase() ?? null;
    const premiumCents = agencyPremiumCents(
      input.agencySales,
      rule.carrier,
      (line) =>
        rule.basis === 'agency' ||
        (line.producerId !== input.userId &&
          (line.leadSourceId?.toLowerCase() ?? null) === source),
    );
    return {
      basis: rule.basis,
      leadSourceId: rule.leadSourceId,
      leadSourceName: rule.leadSourceId
        ? (leadSourceNames.get(rule.leadSourceId) ?? null)
        : null,
      carrier: rateRuleCarrierLabel(rule.carrier),
      premium: fromCents(premiumCents),
      ratePercent: rule.ratePercent,
      amount: fromCents(percentOfCents(premiumCents, rule.ratePercent)),
    };
  });
  const overrideCents = overrides.reduce(
    (sum, row) => sum + toCents(row.amount),
    0,
  );
  let agency: StatementBonusesView['agency'] = null;
  if (structure.agencyTiers.length) {
    const premium = fromCents(
      agencyPremiumCents(input.agencySales, structure.agencyTiersCarrier),
    );
    const reached = levelsReached(
      structure.agencyTiers,
      premium,
      false,
      (tier) => tier.bonusAmount,
    );
    agency = {
      carrier: rateRuleCarrierLabel(structure.agencyTiersCarrier),
      premium,
      reached: reached.levels[0]
        ? {
            thresholdPremium: reached.levels[0].thresholdPremium,
            bonusAmount: reached.levels[0].bonusAmount,
          }
        : null,
      amount: reached.amount,
    };
  }
  const agencyBonus = agency?.amount ?? 0;

  // Referrals.
  let referrals: StatementBonusesView['referrals'] = null;
  if (structure.referralRule) {
    if (inputs.lifeReferrals === null) {
      warnings.push('Life referrals are not entered.');
    }
    referrals = {
      count: inputs.lifeReferrals,
      minimum: structure.referralRule.minimum,
      bonusThreshold: structure.referralRule.bonusThreshold,
      amount: referralAdjustment(structure.referralRule, inputs.lifeReferrals),
    };
  }
  if (
    inputs.compliancePercent === null &&
    (structure.complianceFloor !== null ||
      structure.individualTiers.some((t) => t.minCompliancePercent != null) ||
      structure.rules.some((r) =>
        (r.steps ?? []).some((s) => s.minCompliancePercent !== null),
      ))
  ) {
    warnings.push(
      'The compliance rate is not entered: pay that needs a minimum rate is ' +
        'held back until it is.',
    );
  }
  if (teamBlocked.length && input.team.eligible && input.team.amount > 0) {
    warnings.push(`No team bonus share: ${teamBlocked.join(' ')}`);
  }

  // Base pay and the stipend.
  let basePay = structure.basePay;
  if (basePay > 0 && !input.basePayApplies) {
    warnings.push(
      'Base pay is left off: this person is no longer active. Add any ' +
        'pay owed for the month as an adjustment.',
    );
    basePay = 0;
  }
  if (structure.stipendAmounts.length && !input.startMonth) {
    warnings.push('No start month is set, so no stipend is paid.');
  }
  const stipend = stipendFor(
    structure.stipendAmounts,
    input.startMonth,
    input.month,
  );

  // The manager's lines.
  const adjustmentCents = (kind: StatementAdjustmentKind) =>
    sumCents(
      input.adjustments
        .filter((a) => a.kind === kind && a.amount !== null)
        .map((a) => a.amount as number),
    );
  const spiffsCents = adjustmentCents('spiff');
  const complianceCents = adjustmentCents('compliance');
  const otherCents = adjustmentCents('manual');

  const chargebackCents = premiumLines.reduce(
    (sum, line) => sum + toCents(line.chargebacks),
    0,
  );
  const grossCommissionCents = premiumLines.reduce(
    (sum, line) => sum + toCents(line.grossCommission),
    0,
  );
  const impactCents = premiumLines.reduce(
    (sum, line) => sum + toCents(line.chargebackImpact),
    0,
  );
  const tierBonusCents = toCents(tiers.amount);
  // Variable pay — what the compliance floor's reduction is a share of.
  const variableCents =
    grossCommissionCents -
    impactCents +
    overrideCents +
    stepBonusCents +
    tierBonusCents +
    toCents(agencyBonus) +
    toCents(teamBonus) +
    toCents(somBonus) +
    toCents(hatTrickBonus) +
    toCents(poyBonus);
  const reductionCents =
    belowFloor && variableCents > 0
      ? -percentOfCents(
          variableCents,
          structure.complianceFloor?.reductionPercent ?? 0,
        )
      : 0;
  const referralCents = toCents(referrals?.amount ?? 0);
  const netCents =
    variableCents +
    reductionCents +
    referralCents +
    spiffsCents +
    complianceCents +
    otherCents;
  const netPayCents = toCents(basePay) + toCents(stipend) + netCents;

  const bundleTotal = deals.filter((deal) => deal.isBundle).length;

  return {
    premiumLines,
    deals,
    chargebacks,
    bonuses: {
      hatTrick: {
        enabled: hatTrick.enabled,
        dealsPerDay: hatTrick.dealsPerDay,
        bonusAmount: hatTrick.bonusAmount,
        days,
        amount: hatTrickBonus,
      },
      individual: {
        stackable: structure.tiersStackable,
        reached: tiers.levels.map((tier) => ({
          thresholdPremium: tier.thresholdPremium,
          bonusAmount: tier.bonusAmount,
        })),
        amount: tiers.amount,
      },
      team: { ...input.team, amount: teamBonus },
      salespersonOfMonth: {
        enabled: som.enabled,
        winner: somWinner,
        amount: somBonus,
      },
      rateSteps: belowFloor ? [] : stepBonuses,
      agency,
      overrides,
      referrals,
      producerOfYear: {
        enabled: poy.enabled,
        winner: poy.enabled && poy.winner,
        amount: poyBonus,
      },
      teamBlocked,
      compliance: {
        percent: inputs.compliancePercent,
        floor: structure.complianceFloor,
        belowFloor,
        reduction: fromCents(reductionCents),
      },
    },
    indicators: {
      tier:
        highestIndex >= 0
          ? {
              level: highestIndex + 1,
              thresholdPremium: sortedTiers[highestIndex].thresholdPremium,
            }
          : null,
      bundleRate: ratioPercent(bundleTotal, deals.length),
      hatTricks: hatTrick.enabled ? days.length : null,
      somStatus: !som.enabled ? 'off' : somWinner ? 'winner' : 'none',
      complianceStatus:
        belowFloor || input.failedAudits > 0 ? 'non_compliant' : 'compliant',
      failedAudits: input.failedAudits,
      compliancePercent: inputs.compliancePercent,
    },
    totals: {
      grossPremium,
      chargebackTotal: fromCents(chargebackCents),
      netPremium: fromCents(grossCents - chargebackCents),
      grossCommission: fromCents(grossCommissionCents),
      chargebackImpact: fromCents(impactCents),
      tierBonus: fromCents(tierBonusCents),
      teamBonus,
      somBonus,
      hatTrickBonus,
      spiffs: fromCents(spiffsCents),
      complianceAdjustment: fromCents(complianceCents),
      otherAdjustments: fromCents(otherCents),
      netCommission: fromCents(netCents),
      basePay,
      stipend,
      rateStepBonus: fromCents(stepBonusCents),
      overrideCommission: fromCents(overrideCents),
      agencyBonus,
      producerOfYearBonus: poyBonus,
      complianceReduction: fromCents(reductionCents),
      referralAdjustment: fromCents(referralCents),
      netPay: fromCents(netPayCents),
    },
    warnings,
  };
}

/** A month's sold premium for one person — what tiers, SOM and the team share use. */
export function salesGrossPremium(sales: readonly PayoutSale[]): number {
  return fromCents(
    sales.reduce(
      (sum, sale) => sum + sumCents(sale.lines.map((line) => line.premium)),
      0,
    ),
  );
}
