import {
  complianceBelowFloor,
  computeStatement,
  computeTeamContext,
  EDITABLE_PAY_STATEMENT_STATUSES,
  EMPTY_STATEMENT_INPUTS,
  isEditableStatementStatus,
  normalizeRateRules,
  payoutPoolFor,
  salesGrossPremium,
  salespersonOfMonthWinners,
  statementInputsNeeded,
  structurePlanDefaults,
  teamBlockReasons,
  teamBonusFor,
  type PayoutAdjustment,
  type PayoutSale,
  type PayoutPool,
  type PayoutRunTeamBonusView,
  type PayoutSettingsView,
  type PayStatementStatus,
  type StatementBonusesView,
  type StatementInputs,
  type StatementInputsNeeded,
  type StatementRules,
  type StatementStructureSnapshot,
} from '@sfa/shared';
import { Types, type Model } from 'mongoose';
import type { BranchDocument } from '../../branches/schemas/branch.schema';
import type { Carrier } from '../../carriers/schemas/carrier.schema';
import type { LeadSource } from '../../lead-sources/schemas/lead-source.schema';
import type { UserRole } from '../../permissions/schemas/user-role.schema';
import type { PaymentStructure } from '../../payouts/schemas/payment-structure.schema';
import type {
  PayoutRun,
  PayoutRunSalespersonOfMonth,
} from '../../payouts/schemas/payout-run.schema';
import type { PayStatement } from '../../payouts/schemas/pay-statement.schema';
import type { Agency } from '../../platform/schemas/agency.schema';
import type { AgencyRoleDocument } from '../../roles/schemas/agency-role.schema';
import type { UserDocument } from '../../users/schemas/user.schema';
import { isDuplicateKeyError } from '../mongo/duplicate-key';
import { leadSourceLabels } from './lead-source-labels';
import {
  agencyGrossPremium,
  appointedCarrierNames,
  grossByProducer,
  loadAgencySales,
  loadRunInputs,
  type PayoutInputModels,
} from './load-run-inputs';
import { monthWindow } from './month-window';
import {
  memberStartMonth,
  storedPlan,
  storedRateRules,
  storedTiers,
} from './structure-plan';
import {
  payoutSettingsFrom,
  type StoredPayoutSettings,
} from './payout-settings';
import { loadPayoutPeople, type PayoutPerson } from './payout-people';

/**
 * Drafting a month's pay statements (PAC-178 §3): the job on the 1st and the
 * owner's Generate / Recalculate both end here, so the two cannot compute a
 * month differently.
 *
 * ## Who gets a statement
 *
 * Everyone on an active payment structure. Someone invited but not started,
 * or removed from the agency, gets one only for a month with sales or
 * chargebacks in it — a departed employee's last month is still paid, but
 * nobody is drafted an empty statement every month forever.
 *
 * ## What a recalculation may touch
 *
 * Only `draft` and `rejected` statements are rewritten (their adjustments
 * survive: they are the manager's word, not data). `sent` and `accepted`
 * ones are what the employee was shown and stay exactly as they are; if the
 * month's team split has moved since, the run says whose. A draft for
 * someone no longer on a structure is deleted; any other status is kept.
 *
 * Models in, no DI, so the worker can run it (`common/` is the shared tier).
 */

export interface PayoutModels extends PayoutInputModels {
  agency: Model<Agency>;
  carrier: Model<Carrier>;
  leadSource: Model<LeadSource>;
  paymentStructure: Model<PaymentStructure>;
  payoutRun: Model<PayoutRun>;
  payStatement: Model<PayStatement>;
  user: Model<UserDocument>;
  role: Model<AgencyRoleDocument>;
  userRole: Model<UserRole>;
  branch: Model<BranchDocument>;
}

export interface GenerateRunResult {
  runId: string;
  /** Statements in the month after the run (drafted, or left as they were). */
  statements: number;
  /** Draft and disputed statements written. */
  drafted: number;
  /** Sent or accepted statements left as they were. */
  untouched: number;
}

type LeanStructure = PaymentStructure & { _id: Types.ObjectId };

interface LeanStatement {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  userName: string;
  status: PayStatementStatus;
  runId: Types.ObjectId;
  month: string;
  structureId: Types.ObjectId;
  structureSnapshot: StatementStructureSnapshot;
  roleNames?: string[];
  roleSlugs?: string[];
  pool: PayoutPool;
  branchId?: string | null;
  branchName?: string | null;
  allstateBindId?: string | null;
  bonuses?: Partial<StatementBonusesView> | null;
  totals?: { grossPremium?: number } | null;
  inputs?: Partial<StatementInputs> | null;
  adjustments?: {
    _id: Types.ObjectId;
    kind: PayoutAdjustment['kind'];
    chargebackId?: Types.ObjectId | null;
    amount?: number | null;
    note?: string;
  }[];
}

export function peopleModels(models: PayoutModels) {
  return {
    userModel: models.user,
    roleModel: models.role,
    userRoleModel: models.userRole,
    branchModel: models.branch,
  };
}

/**
 * The structure as a statement freezes it, sources named, with the member's
 * start month (for the stipend).
 */
export function structureSnapshot(
  structure: LeanStructure,
  labels: ReadonlyMap<string, string>,
  userId: string,
): StatementStructureSnapshot {
  // Every member's start month stays on the structure; the snapshot keeps
  // only this member's (`startMonth`, below).
  const { memberStarts, ...plan } = storedPlan(structure, labels);
  void memberStarts;
  return {
    id: String(structure._id),
    name: structure.name,
    rules: storedRateRules(structure.rules),
    leadSourceRules: (structure.leadSourceRules ?? []).map((rule) => ({
      leadSourceId: String(rule.leadSourceId),
      leadSourceName: labels.get(String(rule.leadSourceId)) ?? '',
      carrier: rule.carrier,
      ratePercent: rule.ratePercent,
    })),
    hatTrick: {
      enabled: structure.hatTrick.enabled,
      dealsPerDay: structure.hatTrick.dealsPerDay,
      bonusAmount: structure.hatTrick.bonusAmount,
    },
    individualTiers: storedTiers(structure.individualTiers),
    tiersStackable: structure.tiersStackable ?? false,
    teamBonusEligible: structure.teamBonusEligible,
    ...plan,
    startMonth: memberStartMonth(structure, userId),
  };
}

/**
 * The rules a snapshot computes with. A snapshot frozen before the 2026
 * comp-plan parts existed has none of them: it reads as "none of each".
 */
export function rulesOf(snapshot: StatementStructureSnapshot): StatementRules {
  const { memberStarts, ...plan } = structurePlanDefaults(snapshot);
  void memberStarts;
  return {
    rules: normalizeRateRules(snapshot.rules),
    leadSourceRules: snapshot.leadSourceRules,
    hatTrick: snapshot.hatTrick,
    individualTiers: snapshot.individualTiers,
    tiersStackable: snapshot.tiersStackable,
    teamBonusEligible: snapshot.teamBonusEligible,
    ...plan,
  };
}

/**
 * The figures a statement asks the manager for: what its rules read, and the
 * compliance rate whenever Producer of the Year is on — it counts the
 * months with an entered rate, so every month's is needed.
 */
function inputsNeededFor(
  rules: StatementRules,
  settings: Pick<PayoutSettingsView, 'producerOfYear'>,
): StatementInputsNeeded {
  const needed = statementInputsNeeded(rules);
  return {
    ...needed,
    compliance: needed.compliance || settings.producerOfYear.enabled,
  };
}

/** The figures the manager entered; all `null` on a statement without them. */
export function inputsOf(
  statement: { inputs?: Partial<StatementInputs> | null } | undefined,
): StatementInputs {
  return { ...EMPTY_STATEMENT_INPUTS, ...(statement?.inputs ?? {}) };
}

/**
 * Takes part in the team pool: on a structure that does, and not blocked by
 * the compliance floor or the team requirements (2026 plans).
 */
function teamEligible(
  rules: StatementRules,
  sales: readonly PayoutSale[],
  inputs: StatementInputs,
): boolean {
  return (
    rules.teamBonusEligible &&
    teamBlockReasons(rules, sales, inputs).length === 0
  );
}

function adjustmentsOf(
  statement: LeanStatement | undefined,
): PayoutAdjustment[] {
  return (statement?.adjustments ?? []).map((row) => ({
    id: String(row._id),
    kind: row.kind,
    chargebackId: row.chargebackId ? String(row.chargebackId) : null,
    amount: row.amount ?? null,
    note: row.note ?? '',
  }));
}

function money(amount: number): string {
  return `$${amount.toLocaleString('en-US', {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * Compute every statement of a claimed run and mark it `ready`; on any
 * failure mark it `failed` with the reason and rethrow. The caller must hold
 * the claim (`claimRun`).
 */
export async function generateRun(
  models: PayoutModels,
  args: { runId: Types.ObjectId | string; agencyId: string; now?: Date },
): Promise<GenerateRunResult> {
  const runId = new Types.ObjectId(String(args.runId));
  try {
    return await computeRun(
      models,
      runId,
      args.agencyId,
      args.now ?? new Date(),
    );
  } catch (error) {
    await models.payoutRun.updateOne(
      { _id: runId },
      {
        $set: {
          status: 'failed',
          finishedAt: new Date(),
          error: errorMessage(error).slice(0, 500),
        },
      },
    );
    throw error;
  }
}

async function computeRun(
  models: PayoutModels,
  runId: Types.ObjectId,
  agencyId: string,
  now: Date,
): Promise<GenerateRunResult> {
  const run = await models.payoutRun
    .findOne({ _id: runId, agencyId })
    .lean<(PayoutRun & { _id: Types.ObjectId }) | null>();
  if (!run) throw new Error(`Payout run ${String(runId)} not found`);
  const timeZone = run.timeZone;
  const window = { $gte: run.window.from, $lt: run.window.to };

  const agency = await models.agency
    .findById(agencyId)
    .select({ payouts: 1, carrierAppointments: 1 })
    .lean<{
      payouts?: StoredPayoutSettings | null;
      carrierAppointments?: { carrierId?: Types.ObjectId; active?: boolean }[];
    } | null>();
  const settings = payoutSettingsFrom(agency?.payouts);

  // One active structure per person; were a person on two (a race the
  // structures' lock prevents), the first by name wins and the run says so.
  const structures = await models.paymentStructure
    .find({ agencyId, status: 'active' })
    .sort({ name: 1, _id: 1 })
    .lean<LeanStructure[]>();
  const structureOf = new Map<string, LeanStructure>();
  const warnings: string[] = [];
  for (const structure of structures) {
    for (const memberId of structure.memberIds ?? []) {
      const key = String(memberId);
      if (structureOf.has(key)) {
        warnings.push(
          `A person is on both ${structureOf.get(key)?.name} and ${structure.name}; ` +
            `their statement uses ${structureOf.get(key)?.name}.`,
        );
        continue;
      }
      structureOf.set(key, structure);
    }
  }
  const memberIds = [...structureOf.keys()];

  const [
    people,
    labels,
    inputs,
    agencyGross,
    appointed,
    existingRows,
    agencySales,
  ] = await Promise.all([
    loadPayoutPeople(peopleModels(models), agencyId, memberIds),
    leadSourceLabels(models.leadSource, agencyId),
    loadRunInputs(models, {
      agencyId,
      month: run.month,
      window,
      timeZone,
      memberIds,
    }),
    agencyGrossPremium(models.deal, agencyId, window),
    appointedCarrierNames(models.carrier, agency?.carrierAppointments),
    models.payStatement.find({ agencyId, runId }).lean<LeanStatement[]>(),
    loadAgencySales(models.deal, agencyId, window),
  ]);
  const existing = new Map(
    existingRows.map((row) => [String(row.userId), row]),
  );

  interface Recipient {
    person: PayoutPerson;
    structure: LeanStructure;
    snapshot: StatementStructureSnapshot;
    rules: StatementRules;
    /** The figures the manager entered on the month's statement, if any. */
    inputs: StatementInputs;
    sales: PayoutSale[];
    pool: PayoutPool;
    gross: number;
  }
  const recipients: Recipient[] = [];
  for (const userId of memberIds) {
    const person = people.get(userId);
    const structure = structureOf.get(userId) as LeanStructure;
    if (!person) {
      warnings.push(
        `A member of ${structure.name} is no longer in the agency and has no statement.`,
      );
      continue;
    }
    const sales = inputs.sales.get(userId) ?? [];
    const hasActivity =
      sales.length > 0 || (inputs.chargebacks.get(userId)?.length ?? 0) > 0;
    const prior = existing.get(userId);
    const issued = prior && !isEditableStatementStatus(prior.status);
    if (person.status !== 'active' && !hasActivity && !issued) continue;
    const snapshot = structureSnapshot(structure, labels, userId);
    recipients.push({
      person,
      structure,
      snapshot,
      rules: rulesOf(snapshot),
      inputs: inputsOf(prior),
      sales,
      pool: payoutPoolFor(person.roleSlugs),
      gross: salesGrossPremium(sales),
    });
  }
  if (!structures.length) warnings.push('No payment structure is active.');

  // Below the compliance floor, or short of a team requirement, a person
  // takes no share of the pool and cannot win Salesperson of the Month — so
  // the pool is split, and the month won, among the others (2026 plans).
  const teamMembers = recipients.map((r) => ({
    userId: r.person.id,
    pool: r.pool,
    grossPremium: r.gross,
    eligible: teamEligible(r.rules, r.sales, r.inputs),
  }));
  const eligibleOf = new Map(teamMembers.map((m) => [m.userId, m.eligible]));
  const team = computeTeamContext(settings.teamBonus, agencyGross, teamMembers);
  warnings.push(...team.warnings);
  const som = salespersonOfMonthWinners(
    settings.salespersonOfMonth,
    recipients
      .filter((r) => !complianceBelowFloor(r.rules.complianceFloor, r.inputs))
      .map((r) => ({ userId: r.person.id, grossPremium: r.gross })),
  );
  const poy = await producerOfYearWinners(models, {
    agencyId,
    run,
    settings,
    recipients: recipients.map((r) => ({
      userId: r.person.id,
      inputs: r.inputs,
    })),
  });

  let drafted = 0;
  let untouched = 0;
  for (const recipient of recipients) {
    const { person, structure, pool, snapshot } = recipient;
    const userId = person.id;
    const prior = existing.get(userId);
    const teamPart = teamBonusFor(team, {
      userId,
      pool,
      eligible: eligibleOf.get(userId) ?? false,
    });
    if (prior && !isEditableStatementStatus(prior.status)) {
      untouched += 1;
      const stored = prior.bonuses?.team?.amount ?? 0;
      if (Math.round(stored * 100) !== Math.round(teamPart.amount * 100)) {
        warnings.push(
          `${prior.userName}'s statement was already ${prior.status}: their team ` +
            `bonus would now be ${money(teamPart.amount)}, and it says ${money(stored)}.`,
        );
      }
      continue;
    }

    const computed = computeStatement({
      month: run.month,
      userId,
      structure: recipient.rules,
      inputs: recipient.inputs,
      startMonth: snapshot.startMonth ?? null,
      basePayApplies: person.status === 'active',
      agencySales,
      producerOfYear: {
        enabled: poy.enabled,
        bonusAmount: poy.bonusAmount,
        winner: poy.winnerIds.includes(userId),
      },
      sales: recipient.sales,
      chargebacks: inputs.chargebacks.get(userId) ?? [],
      adjustments: adjustmentsOf(prior),
      appointedCarriers: appointed,
      leadSourceNames: labels,
      failedAudits: inputs.failedAudits.get(userId) ?? 0,
      team: teamPart,
      salespersonOfMonth: {
        enabled: settings.salespersonOfMonth.enabled,
        bonusAmount: settings.salespersonOfMonth.bonusAmount,
        winner: som.winnerIds.includes(userId),
      },
    });
    try {
      await models.payStatement.updateOne(
        {
          agencyId,
          runId,
          userId: new Types.ObjectId(userId),
          status: { $in: [...EDITABLE_PAY_STATEMENT_STATUSES] },
        },
        {
          $set: {
            month: run.month,
            branchId: person.branchId,
            branchName: person.branchName,
            userName: person.name,
            allstateBindId: person.allstateBindId,
            roleNames: person.roles,
            roleSlugs: person.roleSlugs,
            pool,
            structureId: structure._id,
            structureSnapshot: snapshot,
            timeZone,
            ...computed,
            inputsNeeded: inputsNeededFor(recipient.rules, settings),
            computedAt: now,
          },
          $setOnInsert: { status: 'draft', version: 1, adjustments: [] },
        },
        { upsert: true },
      );
      drafted += 1;
    } catch (error) {
      // Sent between our read and our write: it is no longer ours to change.
      if (!isDuplicateKeyError(error)) throw error;
      untouched += 1;
    }
  }

  // Drafts for people no longer on a structure go; anything issued stays —
  // including a draft that was issued once and reopened (PAC-181), whose
  // history is the record of what the person was sent. Those kept are
  // recalculated once the run is written (below).
  await models.payStatement.deleteMany({
    agencyId,
    runId,
    status: 'draft',
    'history.0': { $exists: false },
    userId: {
      $nin: recipients.map((r) => new Types.ObjectId(r.person.id)),
    },
  });

  const names = new Map(recipients.map((r) => [r.person.id, r.person.name]));
  const teamView: PayoutRunTeamBonusView = {
    enabled: team.enabled,
    stackable: team.stackable,
    levels: team.levels,
    met: team.met,
    poolAmount: team.poolAmount,
    csrSharePercent: team.csrSharePercent,
    producerSharePercent: team.producerSharePercent,
    csrPool: team.csrPool,
    producerPool: team.producerPool,
    csrPremium: team.csrPremium,
    producerPremium: team.producerPremium,
  };
  const salespersonOfMonth: PayoutRunSalespersonOfMonth = {
    enabled: settings.salespersonOfMonth.enabled,
    bonusAmount: settings.salespersonOfMonth.bonusAmount,
    topGrossPremium: som.topGrossPremium,
    winners: som.winnerIds.map((userId) => ({
      userId,
      name: names.get(userId) ?? '',
    })),
  };
  const statements = await models.payStatement.countDocuments({
    agencyId,
    runId,
  });
  await models.payoutRun.updateOne(
    { _id: runId },
    {
      $set: {
        status: 'ready',
        finishedAt: new Date(),
        error: null,
        settingsSnapshot: settings satisfies PayoutSettingsView,
        agencyGrossPremium: agencyGross,
        teamBonus: teamView,
        teamShares: teamMembers.map((member) => ({
          userId: new Types.ObjectId(member.userId),
          pool: member.pool,
          grossPremium: member.grossPremium,
          eligible: member.eligible,
          share: member.eligible ? (team.shares[member.userId] ?? 0) : 0,
        })),
        salespersonOfMonth,
        producerOfYear: poy.enabled
          ? {
              enabled: true,
              bonusAmount: poy.bonusAmount,
              topGrossPremium: poy.topGrossPremium,
              winners: poy.winnerIds.map((userId) => ({
                userId,
                name: names.get(userId) ?? '',
              })),
            }
          : null,
        warnings,
      },
    },
  );

  // Editable statements of people who are no longer recipients — a reopened
  // draft kept above, or a disputed one — were not written by the loop.
  // Left as they were, Send all would issue them with the figures of the
  // last calculation. Each is recalculated as Recalculate does: by the rules
  // it was drafted with, against the split just stored on the run, and
  // saying the person is no longer on a payment structure. After the run's
  // write, because that is what `recomputeStatement` reads.
  const leftOver = await models.payStatement
    .find({
      agencyId,
      runId,
      status: { $in: [...EDITABLE_PAY_STATEMENT_STATUSES] },
      userId: {
        $nin: recipients.map((r) => new Types.ObjectId(r.person.id)),
      },
    })
    .select({ _id: 1 })
    .lean<{ _id: Types.ObjectId }[]>();
  for (const row of leftOver) {
    await recomputeStatement(models, {
      agencyId,
      statementId: String(row._id),
      now,
    });
  }

  return { runId: String(runId), statements, drafted, untouched };
}

/**
 * Producer of the Year (2026 plan), on December's run only: of this run's
 * recipients, those compliant — an entered compliance rate at least the
 * setting's — in at least `minCompliantMonths` of the year's statements,
 * the one(s) with the highest sold premium over the calendar year. December's
 * own month counts with the figure entered on this run's statement.
 */
async function producerOfYearWinners(
  models: PayoutModels,
  args: {
    agencyId: string;
    run: Pick<PayoutRun, 'month' | 'timeZone' | 'window'>;
    settings: PayoutSettingsView;
    recipients: { userId: string; inputs: StatementInputs }[];
  },
): Promise<{
  enabled: boolean;
  bonusAmount: number;
  topGrossPremium: number | null;
  winnerIds: string[];
}> {
  const { agencyId, run, settings } = args;
  const rule = settings.producerOfYear;
  const off = {
    enabled: false,
    bonusAmount: rule.bonusAmount,
    topGrossPremium: null,
    winnerIds: [],
  };
  if (!rule.enabled || !run.month.endsWith('-12') || !args.recipients.length) {
    return off;
  }
  const year = run.month.slice(0, 4);
  const yearWindow = {
    $gte: monthWindow(`${year}-01`, run.timeZone).$gte,
    $lt: run.window.to,
  };
  const [gross, earlier] = await Promise.all([
    grossByProducer(models.deal, agencyId, yearWindow),
    models.payStatement
      .find({
        agencyId,
        month: { $gte: `${year}-01`, $lt: run.month },
        userId: {
          $in: args.recipients.map((r) => new Types.ObjectId(r.userId)),
        },
        'inputs.compliancePercent': { $gte: rule.minCompliancePercent },
      })
      .select({ userId: 1, month: 1 })
      .lean<{ userId: Types.ObjectId; month: string }[]>(),
  ]);
  const months = new Map<string, Set<string>>();
  for (const row of earlier) {
    const key = String(row.userId);
    months.set(key, (months.get(key) ?? new Set()).add(row.month));
  }
  const candidates = args.recipients.filter((r) => {
    const compliant =
      (months.get(r.userId)?.size ?? 0) +
      (r.inputs.compliancePercent !== null &&
      r.inputs.compliancePercent >= rule.minCompliancePercent
        ? 1
        : 0);
    return compliant >= rule.minCompliantMonths;
  });
  const top = candidates.reduce(
    (max, r) => Math.max(max, Math.round((gross.get(r.userId) ?? 0) * 100)),
    0,
  );
  if (top <= 0) return { ...off, enabled: true };
  return {
    enabled: true,
    bonusAmount: rule.bonusAmount,
    topGrossPremium: top / 100,
    winnerIds: candidates
      .filter((r) => Math.round((gross.get(r.userId) ?? 0) * 100) === top)
      .map((r) => r.userId)
      .sort(),
  };
}

/**
 * Recalculate one draft or disputed statement (PAC-178 "Recalculate"): the
 * person's sales and chargebacks are re-read and their **current** structure
 * applied — or, if they have left every structure, the rules the statement
 * was drafted with — against the team split and Salesperson of the Month the
 * month was last calculated with. Re-splitting the pool for one person would
 * change everyone else's share behind their statements, so when this
 * person's premium has moved, the statement says the month needs a full
 * recalculation instead.
 *
 * `false` when the statement is not there or is no longer editable.
 */
export async function recomputeStatement(
  models: PayoutModels,
  args: { agencyId: string; statementId: string; now?: Date },
): Promise<boolean> {
  const { agencyId } = args;
  const now = args.now ?? new Date();
  const statement = await models.payStatement
    .findOne({ _id: new Types.ObjectId(args.statementId), agencyId })
    .lean<LeanStatement | null>();
  if (!statement || !isEditableStatementStatus(statement.status)) return false;
  const run = await models.payoutRun
    .findOne({ _id: statement.runId, agencyId })
    .lean<(PayoutRun & { _id: Types.ObjectId }) | null>();
  if (!run) return false;

  const userId = String(statement.userId);
  const timeZone = run.timeZone;
  const window = { $gte: run.window.from, $lt: run.window.to };
  // Through the mapper: a run calculated before a setting existed (Producer
  // of the Year) has a snapshot without it.
  const settings = payoutSettingsFrom(run.settingsSnapshot);

  const [structure, people, labels, inputs, agency, agencySales] =
    await Promise.all([
      models.paymentStructure
        .findOne({ agencyId, status: 'active', memberIds: statement.userId })
        .sort({ name: 1 })
        .lean<LeanStructure | null>(),
      loadPayoutPeople(peopleModels(models), agencyId, [userId]),
      leadSourceLabels(models.leadSource, agencyId),
      loadRunInputs(models, {
        agencyId,
        month: run.month,
        window,
        timeZone,
        memberIds: [userId],
      }),
      models.agency.findById(agencyId).select({ carrierAppointments: 1 }).lean<{
        carrierAppointments?: {
          carrierId?: Types.ObjectId;
          active?: boolean;
        }[];
      } | null>(),
      loadAgencySales(models.deal, agencyId, window),
    ]);
  const person = people.get(userId);
  const warnings: string[] = [];
  const snapshot = structure
    ? structureSnapshot(structure, labels, userId)
    : statement.structureSnapshot;
  const rules = rulesOf(snapshot);
  const entered = inputsOf(statement);
  if (!structure) {
    warnings.push(
      `${statement.userName} is no longer on a payment structure; this ` +
        `statement keeps the ${snapshot.name} rules it was drafted with.`,
    );
  }
  const roleSlugs = person?.roleSlugs ?? statement.roleSlugs ?? [];
  const pool = person ? payoutPoolFor(roleSlugs) : statement.pool;
  const sales = inputs.sales.get(userId) ?? [];
  const gross = salesGrossPremium(sales);
  const eligibleNow = teamEligible(rules, sales, entered);

  const stored = run.teamShares?.find((row) => String(row.userId) === userId);
  const teamView = run.teamBonus;
  const team = teamView
    ? teamBonusFor(
        { ...teamView, shares: { [userId]: stored?.share ?? 0 } },
        { userId, pool, eligible: snapshot.teamBonusEligible },
      )
    : {
        eligible: snapshot.teamBonusEligible,
        met: false,
        poolAmount: 0,
        pool,
        groupPool: 0,
        groupPremium: 0,
        amount: 0,
      };
  const winners = run.salespersonOfMonth?.winners ?? [];
  const storedGross =
    stored?.grossPremium ?? statement.totals?.grossPremium ?? 0;
  const somBlocked = complianceBelowFloor(rules.complianceFloor, entered);
  const somWinner = winners.some((winner) => winner.userId === userId);
  if (
    Math.round(storedGross * 100) !== Math.round(gross * 100) ||
    (stored !== undefined && stored.eligible !== eligibleNow) ||
    (somWinner && somBlocked)
  ) {
    warnings.push(
      'Sold premium or eligibility has changed since the month was last ' +
        'calculated. Recalculate the month to update the team bonus split ' +
        'and Salesperson of the Month.',
    );
  }
  const poy = run.producerOfYear;

  const computed = computeStatement({
    month: run.month,
    userId,
    structure: rules,
    inputs: entered,
    startMonth: snapshot.startMonth ?? null,
    basePayApplies: person ? person.status === 'active' : false,
    agencySales,
    producerOfYear: {
      enabled: Boolean(poy?.enabled),
      bonusAmount: poy?.bonusAmount ?? 0,
      winner: (poy?.winners ?? []).some((winner) => winner.userId === userId),
    },
    sales,
    chargebacks: inputs.chargebacks.get(userId) ?? [],
    adjustments: adjustmentsOf(statement),
    appointedCarriers: await appointedCarrierNames(
      models.carrier,
      agency?.carrierAppointments,
    ),
    leadSourceNames: labels,
    failedAudits: inputs.failedAudits.get(userId) ?? 0,
    team,
    salespersonOfMonth: {
      enabled: settings.salespersonOfMonth.enabled,
      bonusAmount: settings.salespersonOfMonth.bonusAmount,
      winner: winners.some((winner) => winner.userId === userId),
    },
  });

  const result = await models.payStatement.updateOne(
    {
      _id: statement._id,
      status: { $in: [...EDITABLE_PAY_STATEMENT_STATUSES] },
    },
    {
      $set: {
        ...(person
          ? {
              branchId: person.branchId,
              branchName: person.branchName,
              userName: person.name,
              allstateBindId: person.allstateBindId,
              roleNames: person.roles,
              roleSlugs: person.roleSlugs,
            }
          : {}),
        pool,
        structureId: structure?._id ?? statement.structureId,
        structureSnapshot: snapshot,
        timeZone,
        ...computed,
        inputsNeeded: inputsNeededFor(rules, settings),
        warnings: [...warnings, ...computed.warnings],
        computedAt: now,
      },
    },
  );
  return result.matchedCount === 1;
}
