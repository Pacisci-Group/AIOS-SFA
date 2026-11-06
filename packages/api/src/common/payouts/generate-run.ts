import {
  computeStatement,
  computeTeamContext,
  EDITABLE_PAY_STATEMENT_STATUSES,
  isEditableStatementStatus,
  normalizeRateRules,
  payoutPoolFor,
  salesGrossPremium,
  salespersonOfMonthWinners,
  teamBonusFor,
  type PayoutAdjustment,
  type PayoutPool,
  type PayoutRunTeamBonusView,
  type PayoutSettingsView,
  type PayStatementStatus,
  type StatementBonusesView,
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
  loadRunInputs,
  type PayoutInputModels,
} from './load-run-inputs';
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

/** The structure as a statement freezes it, sources named. */
export function structureSnapshot(
  structure: LeanStructure,
  labels: ReadonlyMap<string, string>,
): StatementStructureSnapshot {
  return {
    id: String(structure._id),
    name: structure.name,
    rules: normalizeRateRules(structure.rules ?? []),
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
    individualTiers: (structure.individualTiers ?? []).map((tier) => ({
      thresholdPremium: tier.thresholdPremium,
      bonusAmount: tier.bonusAmount,
    })),
    tiersStackable: structure.tiersStackable ?? false,
    teamBonusEligible: structure.teamBonusEligible,
  };
}

function rulesOf(snapshot: StatementStructureSnapshot): StatementRules {
  return {
    rules: snapshot.rules,
    leadSourceRules: snapshot.leadSourceRules,
    hatTrick: snapshot.hatTrick,
    individualTiers: snapshot.individualTiers,
    tiersStackable: snapshot.tiersStackable,
    teamBonusEligible: snapshot.teamBonusEligible,
  };
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

  const [people, labels, inputs, agencyGross, appointed, existingRows] =
    await Promise.all([
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
    ]);
  const existing = new Map(
    existingRows.map((row) => [String(row.userId), row]),
  );

  interface Recipient {
    person: PayoutPerson;
    structure: LeanStructure;
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
    recipients.push({
      person,
      structure,
      pool: payoutPoolFor(person.roleSlugs),
      gross: salesGrossPremium(sales),
    });
  }
  if (!structures.length) warnings.push('No payment structure is active.');

  const teamMembers = recipients.map((r) => ({
    userId: r.person.id,
    pool: r.pool,
    grossPremium: r.gross,
    eligible: r.structure.teamBonusEligible,
  }));
  const team = computeTeamContext(settings.teamBonus, agencyGross, teamMembers);
  warnings.push(...team.warnings);
  const som = salespersonOfMonthWinners(
    settings.salespersonOfMonth,
    teamMembers,
  );

  let drafted = 0;
  let untouched = 0;
  for (const recipient of recipients) {
    const { person, structure, pool } = recipient;
    const userId = person.id;
    const prior = existing.get(userId);
    const teamPart = teamBonusFor(team, {
      userId,
      pool,
      eligible: structure.teamBonusEligible,
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

    const snapshot = structureSnapshot(structure, labels);
    const computed = computeStatement({
      structure: rulesOf(snapshot),
      sales: inputs.sales.get(userId) ?? [],
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

  // Drafts for people no longer on a structure go; anything issued stays.
  await models.payStatement.deleteMany({
    agencyId,
    runId,
    status: 'draft',
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
        warnings,
      },
    },
  );

  return { runId: String(runId), statements, drafted, untouched };
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
  const settings = run.settingsSnapshot ?? payoutSettingsFrom(null);

  const [structure, people, labels, inputs, agency] = await Promise.all([
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
      carrierAppointments?: { carrierId?: Types.ObjectId; active?: boolean }[];
    } | null>(),
  ]);
  const person = people.get(userId);
  const warnings: string[] = [];
  const snapshot = structure
    ? structureSnapshot(structure, labels)
    : statement.structureSnapshot;
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
  if (Math.round(storedGross * 100) !== Math.round(gross * 100)) {
    warnings.push(
      'Sold premium has changed since the month was last calculated. ' +
        'Recalculate the month to update the team bonus split and ' +
        'Salesperson of the Month.',
    );
  }

  const computed = computeStatement({
    structure: rulesOf(snapshot),
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
        warnings: [...warnings, ...computed.warnings],
        computedAt: now,
      },
    },
  );
  return result.matchedCount === 1;
}
