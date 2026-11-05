import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { ANY_CARRIER, ModuleKey } from '@sfa/shared';
import { Model, Types } from 'mongoose';
import { App } from 'supertest/types';
import { businessDateInstant } from '../../src/common/dates/business-dates';
import { Deal } from '../../src/deals/schemas/deal.schema';
import {
  deterministicEventId,
  InngestService,
} from '../../src/inngest/inngest.service';
import { PaymentStructure } from '../../src/payouts/schemas/payment-structure.schema';
import { PayStatement } from '../../src/payouts/schemas/pay-statement.schema';
import { PayoutRun } from '../../src/payouts/schemas/payout-run.schema';
import { RoleAssignmentsService } from '../../src/permissions/role-assignments.service';
import { Agency } from '../../src/platform/schemas/agency.schema';
import { Policy } from '../../src/policies/schemas/policy.schema';
import { AgencyRole } from '../../src/roles/schemas/agency-role.schema';
import { User } from '../../src/users/schemas/user.schema';
import { GeneratePayStatementsFn } from '../../src/worker/functions/generate-pay-statements.fn';
import { inlineStep } from '../helpers/inline-step';
import { seedTestData, type TestSeedContext } from '../helpers/seed-test-data';
import {
  CapturedInngestService,
  closeTestApp,
  createTestApp,
  dropTestDatabase,
} from '../helpers/test-app';

const CHICAGO = 'America/Chicago';

/** 00:30 on April 1st in Chicago (CDT): March has just ended there. */
const APRIL_1_0030 = new Date('2026-04-01T05:30:00.000Z');
const later = (minutes: number) =>
  new Date(APRIL_1_0030.getTime() + minutes * 60_000);

/**
 * The 1st-of-month job (PAC-178 §4): `GeneratePayStatementsFn.handle` driven
 * directly with a chosen `now`, against the real app (Inngest captured).
 *
 * The seeded agency is in Chicago with every module on; one producer is on a
 * structure and sold in March. The second seeded agency has no structure.
 */
describe('GeneratePayStatementsFn (e2e)', () => {
  let app: INestApplication<App>;
  let seed: TestSeedContext;
  let fn: GeneratePayStatementsFn;
  let events: CapturedInngestService;
  let runs: Model<PayoutRun>;
  let statements: Model<PayStatement>;
  let structures: Model<PaymentStructure>;
  let agencies: Model<Agency>;
  let producerId: string;
  let ownerId: string;
  let managerId: string;
  let structureId: Types.ObjectId;

  const tick = (now: Date) => fn.handle(inlineStep().step, now);
  const runReady = () =>
    events.sent.filter(
      (event) =>
        event.name === 'notification/requested.v1' &&
        event.data.type === 'payouts.run_ready',
    );
  const reset = async () => {
    await runs.deleteMany({});
    await statements.deleteMany({});
    events.sent.length = 0;
  };

  beforeAll(async () => {
    app = await createTestApp();
    await dropTestDatabase(app);
    seed = await seedTestData(app);
    fn = app.get(GeneratePayStatementsFn);
    events = app.get(InngestService);
    runs = app.get<Model<PayoutRun>>(getModelToken(PayoutRun.name));
    statements = app.get<Model<PayStatement>>(getModelToken(PayStatement.name));
    structures = app.get<Model<PaymentStructure>>(
      getModelToken(PaymentStructure.name),
    );
    agencies = app.get<Model<Agency>>(getModelToken(Agency.name));
    await runs.syncIndexes();
    await statements.syncIndexes();

    const users = app.get<Model<User>>(getModelToken(User.name));
    const roles = app.get<Model<AgencyRole>>(getModelToken(AgencyRole.name));
    const deals = app.get<Model<Deal>>(getModelToken(Deal.name));
    const policies = app.get<Model<Policy>>(getModelToken(Policy.name));
    const roleAssignments = app.get(RoleAssignmentsService);

    const producer = await users.findOne({ email: seed.producerEmail });
    const owner = await users.findOne({ email: seed.ownerEmail });
    producerId = String(producer!._id);
    ownerId = String(owner!._id);
    const agencyId = new Types.ObjectId(seed.agencyId);
    const manager = await users.create({
      agencyId,
      branchId: new Types.ObjectId(seed.branchId),
      email: 'payjob-manager@sfa.local',
      passwordHash: 'not-used-by-this-suite',
      firstName: 'Bea',
      lastName: 'Manager',
      isActive: true,
    });
    managerId = String(manager._id);
    const managerRole = await roles.findOne({
      agencyId,
      slug: 'branch_manager',
    });
    await roleAssignments.setUserRoles(
      { userId: ownerId, isPlatformAdmin: true },
      agencyId,
      manager._id,
      [managerRole!._id],
    );

    const structure = await structures.create({
      agencyId: seed.agencyId,
      name: 'Producers',
      nameKey: 'producers',
      rules: [
        { carrier: ANY_CARRIER, ratePercent: 10, minBundleRatePercent: null },
      ],
      leadSourceRules: [],
      hatTrick: { enabled: false, dealsPerDay: 3, bonusAmount: 50 },
      individualTiers: [],
      tiersStackable: false,
      teamBonusEligible: true,
      memberIds: [producer!._id],
    });
    structureId = structure._id;

    const deal = await deals.create({
      agencyId: seed.agencyId,
      branchId: seed.branchId,
      producerId: producer!._id,
      clientName: 'March Client',
      householdId: new Types.ObjectId(),
      dealType: 'Auto',
      policyTypes: ['Auto'],
      premium: 1200,
      itemCount: 1,
      premiumSource: 'rollup',
      soldDate: businessDateInstant('2026-03-16', CHICAGO),
      status: 'Sold',
    });
    await policies.create({
      agencyId: seed.agencyId,
      branchId: seed.branchId,
      dealId: deal._id,
      policyNumber: 'JOB-1',
      policyStatus: 'Active',
      policyType: 'Auto',
      carrier: 'Allstate',
      premium: 1200,
      items: 1,
    });
  });

  afterAll(async () => {
    if (app) {
      await dropTestDatabase(app);
      await closeTestApp(app);
    }
  });

  beforeEach(reset);

  it("drafts the month that just ended at the agency's midnight, once", async () => {
    // 23:30 on March 31st in Chicago: it is still March there.
    expect(await tick(new Date('2026-04-01T04:30:00.000Z'))).toEqual({
      drafted: 1,
      statements: 1,
    });
    const february = await runs.findOne({ month: '2026-02' }).lean();
    expect(february?.status).toBe('ready');

    expect(await tick(APRIL_1_0030)).toEqual({ drafted: 1, statements: 1 });
    const run = await runs.findOne({ month: '2026-03' }).lean();
    expect(run).toMatchObject({
      agencyId: seed.agencyId,
      status: 'ready',
      trigger: 'cron',
      timeZone: CHICAGO,
      agencyGrossPremium: 1200,
    });
    const statement = await statements.findOne({ runId: run!._id }).lean();
    expect(statement).toMatchObject({ status: 'draft', month: '2026-03' });
    expect(statement?.totals).toMatchObject({
      grossPremium: 1200,
      netCommission: 120,
    });
    expect(String(statement!.userId)).toBe(producerId);

    // Every other tick of April finds March drafted.
    expect(await tick(later(60))).toEqual({ drafted: 0, statements: 0 });
    expect(await tick(later(60 * 24 * 10))).toEqual({
      drafted: 0,
      statements: 0,
    });
    expect(await runs.countDocuments({ month: '2026-03' })).toBe(1);
  });

  it('tells the owners and branch managers, once per run', async () => {
    await tick(APRIL_1_0030);
    const run = await runs.findOne({ month: '2026-03' }).lean();
    const sent = runReady();
    expect(sent).toHaveLength(1);
    expect(sent[0].id).toBe(
      deterministicEventId('payouts.run_ready', String(run!._id)).toHexString(),
    );
    expect(sent[0].data).toMatchObject({
      type: 'payouts.run_ready',
      agencyId: seed.agencyId,
      actorId: null,
      entity: { kind: 'payoutRun', id: String(run!._id) },
      data: { month: '2026-03', monthLabel: 'March 2026', statements: 1 },
      dedupeKey: `payout-run:${String(run!._id)}:ready`,
    });
    expect((sent[0].data.recipientIds as string[]).sort()).toEqual(
      [ownerId, managerId].sort(),
    );
    await tick(later(60));
    expect(runReady()).toHaveLength(1);
  });

  it('finishes a month the owner generated before it ended', async () => {
    await runs.create({
      agencyId: seed.agencyId,
      month: '2026-03',
      status: 'ready',
      trigger: 'manual',
      timeZone: CHICAGO,
      window: {
        from: new Date('2026-03-01T06:00:00.000Z'),
        to: new Date('2026-04-01T05:00:00.000Z'),
      },
      startedAt: new Date('2026-03-31T17:00:00.000Z'),
    });
    expect(await tick(APRIL_1_0030)).toEqual({ drafted: 1, statements: 1 });
    expect((await runs.findOne({ month: '2026-03' }).lean())?.trigger).toBe(
      'cron',
    );
    expect(await tick(later(60))).toEqual({ drafted: 0, statements: 0 });
  });

  it('takes over a failed run and a dead one, never a live one', async () => {
    await tick(APRIL_1_0030);
    await runs.updateOne({ month: '2026-03' }, { $set: { status: 'failed' } });
    expect((await tick(later(60))).drafted).toBe(1);

    await runs.updateOne(
      { month: '2026-03' },
      { $set: { status: 'generating', startedAt: later(110) } },
    );
    expect((await tick(later(120))).drafted).toBe(0);
    expect((await tick(later(150))).drafted).toBe(1);
    expect((await runs.findOne({ month: '2026-03' }).lean())?.status).toBe(
      'ready',
    );
  });

  it('skips an agency with Payouts off or nobody on a structure', async () => {
    await agencies.updateOne(
      { _id: new Types.ObjectId(seed.agencyId) },
      { $set: { [`modules.${ModuleKey.Payouts}.enabled`]: false } },
    );
    expect(await tick(APRIL_1_0030)).toEqual({ drafted: 0, statements: 0 });
    await agencies.updateOne(
      { _id: new Types.ObjectId(seed.agencyId) },
      { $set: { [`modules.${ModuleKey.Payouts}.enabled`]: true } },
    );

    await structures.updateOne(
      { _id: structureId },
      { $set: { memberIds: [] } },
    );
    expect(await tick(APRIL_1_0030)).toEqual({ drafted: 0, statements: 0 });
    expect(await runs.countDocuments({})).toBe(0);
    await structures.updateOne(
      { _id: structureId },
      { $set: { memberIds: [new Types.ObjectId(producerId)] } },
    );
    // The second seeded agency has no structure at all.
    expect(await runs.countDocuments({ agencyId: seed.otherAgencyId })).toBe(0);
  });
});
