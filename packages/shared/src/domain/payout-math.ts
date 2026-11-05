import { carrierSlug, normalizeCarrier } from './carrier';
import type { ChargebackReason, ChargebackSource } from './chargeback';
import {
  bundleMinimumFor,
  levelsReached,
  PAYOUT_BUNDLE_MIN_POLICIES,
  PAYOUT_NO_CARRIER,
  rateFor,
  rateForCarrier,
  sortBonusTiers,
  teamPoolFor,
  type BonusTier,
  type HatTrickRule,
  type LeadSourceRateRule,
  type PayoutPool,
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
}

export interface ComputeStatementInput {
  structure: StatementRules;
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

// ── Lines ───────────────────────────────────────────────────────────────

interface LineAccumulator {
  key: string;
  carrier: string;
  leadSourceId: string | null;
  ratePercent: number;
  rateSource: StatementRateSource;
  appointed: boolean;
  grossCents: number;
  chargebackCents: number;
  impactCents: number;
}

/**
 * The line a sale (or the chargeback reversing it) lands on, with its rate.
 * A lead-source rate gets a line of its own; anything else folds into the
 * carrier's line at the carrier's rate.
 */
function lineFor(
  structure: StatementRules,
  carrier: string,
  leadSourceId: string | null,
): Pick<
  LineAccumulator,
  'key' | 'carrier' | 'leadSourceId' | 'ratePercent' | 'rateSource'
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
      };
    }
  }
  const base = rateForCarrier(structure.rules, carrierArg);
  return {
    key: `${key}|`,
    carrier,
    leadSourceId: null,
    ratePercent: base?.ratePercent ?? 0,
    rateSource: base?.source ?? 'none',
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
  const { structure, leadSourceNames } = input;
  const warnings: string[] = [];

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
    ensureLine(lineFor(structure, name, null));
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
      const line = ensureLine(lineFor(structure, carrier, sale.leadSourceId));
      line.grossCents += toCents(saleLine.premium);
      if (carrier === PAYOUT_NO_CARRIER) {
        untypedCents += toCents(saleLine.premium);
      }
    }
  }

  // Chargebacks, each on the line of the sale it reverses.
  const exclusions = new Map<string, string>();
  for (const adjustment of input.adjustments) {
    if (adjustment.kind === 'exclude_chargeback' && adjustment.chargebackId) {
      exclusions.set(adjustment.chargebackId, adjustment.note);
    }
  }
  const chargebacks: StatementChargebackView[] = input.chargebacks
    .map((row) => {
      const carrier = nameOf(row.carrier);
      const target = lineFor(structure, carrier, row.leadSourceId);
      const line = ensureLine(target);
      const deduction = percentOf(row.amount, target.ratePercent);
      const excluded = exclusions.has(row.chargebackId);
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
        excludedNote: excluded
          ? (exclusions.get(row.chargebackId) ?? '')
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
  const hatTrickBonus = fromCents(days.length * toCents(hatTrick.bonusAmount));
  const tiers = levelsReached(
    structure.individualTiers,
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
  const somBonus = som.enabled && som.winner ? som.bonusAmount : 0;
  const teamBonus = input.team.eligible ? input.team.amount : 0;

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
  const netCents =
    grossCommissionCents -
    impactCents +
    tierBonusCents +
    toCents(teamBonus) +
    toCents(somBonus) +
    toCents(hatTrickBonus) +
    spiffsCents +
    complianceCents +
    otherCents;

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
        winner: som.enabled && som.winner,
        amount: somBonus,
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
      somStatus: !som.enabled ? 'off' : som.winner ? 'winner' : 'none',
      complianceStatus: input.failedAudits > 0 ? 'non_compliant' : 'compliant',
      failedAudits: input.failedAudits,
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
