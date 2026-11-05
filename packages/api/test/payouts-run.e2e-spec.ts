import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import {
  ANY_CARRIER,
  PAYOUT_NO_CARRIER,
  PAYOUT_RUN_GENERATING,
  PAYOUT_STATEMENT_NOT_EDITABLE,
  type OwnerDashboardSummary,
  type PayoutActivityPeopleResponse,
  type PayoutActivityView,
  type PayoutRunResponse,
  type PayStatementsResponse,
  type PayStatementView,
  type UpsertPaymentStructureInput,
} from '@sfa/shared';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Chargeback } from '../src/chargebacks/schemas/chargeback.schema';
import { businessDateInstant } from '../src/common/dates/business-dates';
import { DealAudit } from '../src/deal-audits/schemas/deal-audit.schema';
import { Deal } from '../src/deals/schemas/deal.schema';
import { Lead } from '../src/leads/schemas/lead.schema';
import { LeadSource } from '../src/lead-sources/schemas/lead-source.schema';
import { PaymentStructure } from '../src/payouts/schemas/payment-structure.schema';
import { PayStatement } from '../src/payouts/schemas/pay-statement.schema';
import { PayoutRun } from '../src/payouts/schemas/payout-run.schema';
import { RoleAssignmentsService } from '../src/permissions/role-assignments.service';
import { Agency } from '../src/platform/schemas/agency.schema';
import { Policy } from '../src/policies/schemas/policy.schema';
import { AgencyRole } from '../src/roles/schemas/agency-role.schema';
import { User } from '../src/users/schemas/user.schema';
import { authHeader, login } from './helpers/auth.helper';
import {
  seedTestData,
  TEST_PASSWORD,
  type TestSeedContext,
} from './helpers/seed-test-data';
import {
  closeTestApp,
  createTestApp,
  dropTestDatabase,
} from './helpers/test-app';

const CHICAGO = 'America/Chicago';
const onDay = (iso: string) => businessDateInstant(iso, CHICAGO);
/** Noon on an agency day — far from either midnight. */
const noon = (iso: string) => new Date(onDay(iso).getTime() + 12 * 3_600_000);

const MONTH = '2026-03';

/**
 * PAC-178 / PAC-179 — the monthly statements, end to end through the API.
 *
 * March 2026 in the seeded agency (Chicago). Structure "Producers": Allstate
 * 10% (minimum bundle rate 80%), any other carrier 5%, JYA leads on Allstate
 * 6%, hat trick 2 sales/day → $50, stacking tiers $5,000 → $100 and $10,000 →
 * $200. Team bonus: $10,000 of agency premium → a $1,000 pool, 20/80.
 * Salesperson of the Month: $250.
 *
 * | | who (branch) | sales | |
 * |---|---|---|---|
 * | P1 | seeded producer (main) | D1 Mar 10 Allstate 3,000 + Progressive 2,000 (bundle, failed audit) · D2 Mar 10 Allstate 1,500 via a JYA lead · D3 **Mar 31 23:30 Central** Allstate 1,000 · D6 Mar 20 no policies, 500 | gross 8,000; a 1,500 cancellation of D2 on Mar 25 |
 * | C1 | seeded CSR (main) | D7 Mar 5 Allstate 2,000 | gross 2,000 |
 * | P2 | producer (other branch) | D8 Mar 6 Travelers 1,000 | gross 1,000 |
 * | P3 | producer on no structure | D9 Mar 7 Allstate 3,000 | counts toward the agency only |
 *
 * Out of the month: a company transfer and a test record (P1, Mar 15), a sale
 * at 00:30 Central on Apr 1, and a February chargeback.
 */
describe('Payouts — monthly statements (e2e)', () => {
  let app: INestApplication<App>;
  let seed: TestSeedContext;
  let ownerToken: string;
  let producerToken: string;
  let managerToken: string;
  let readOnlyToken: string;
  let p1: string;
  let c1: string;
  let p2: string;
  let p3: string;
  let formerId: string;
  let structureId: string;
  let jya: string;
  let dealModel: Model<Deal>;
  let policyModel: Model<Policy>;
  let statements: Model<PayStatement>;
  let runs: Model<PayoutRun>;
  let structures: Model<PaymentStructure>;
  let otherBranchId: string;

  const api = () => request(app.getHttpServer());
  const main = () => ({ agencyId: seed.agencyId, branchId: seed.branchId });

  const generate = (month = MONTH, token = ownerToken) =>
    api().post('/api/v1/payouts/runs').set(authHeader(token)).send({ month });

  const list = async (query: string, token = ownerToken) =>
    (
      await api()
        .get(`/api/v1/payouts/statements?${query}`)
        .set(authHeader(token))
        .expect(200)
    ).body as PayStatementsResponse;

  const statementOf = async (userId: string) => {
    const doc = await statements
      .findOne({ userId: new Types.ObjectId(userId), month: MONTH })
      .lean();
    return String(doc!._id);
  };

  const detail = async (id: string, token = ownerToken) =>
    (
      await api()
        .get(`/api/v1/payouts/statements/${id}`)
        .set(authHeader(token))
        .expect(200)
    ).body as PayStatementView;

  let sequence = 0;
  const sell = async (
    producerId: string,
    soldDate: Date,
    policies: [carrier: string, policyType: string, premium: number][],
    extra: Record<string, unknown> = {},
    scope = main(),
  ) => {
    sequence += 1;
    const deal = await dealModel.create({
      ...scope,
      producerId: new Types.ObjectId(producerId),
      clientName: `Client ${sequence}`,
      householdId: new Types.ObjectId(),
      dealType: 'Other',
      policyTypes: policies.map(([, type]) => type),
      premium: policies.reduce((sum, [, , premium]) => sum + premium, 0),
      itemCount: Math.max(1, policies.length),
      premiumSource: 'rollup',
      soldDate,
      status: 'Sold',
      ...extra,
    });
    const created = policies.length
      ? await policyModel.create(
          policies.map(([carrier, policyType, premium], index) => ({
            ...scope,
            dealId: deal._id,
            householdId: deal.householdId,
            policyNumber: `PR-${sequence}-${index}`,
            policyStatus: 'Active',
            policyType,
            carrier,
            premium,
            items: 1,
          })),
        )
      : [];
    return { deal, policies: created };
  };

  beforeAll(async () => {
    app = await createTestApp();
    await dropTestDatabase(app);
    seed = await seedTestData(app);

    const userModel = app.get<Model<User>>(getModelToken(User.name));
    const roleModel = app.get<Model<AgencyRole>>(
      getModelToken(AgencyRole.name),
    );
    dealModel = app.get<Model<Deal>>(getModelToken(Deal.name));
    policyModel = app.get<Model<Policy>>(getModelToken(Policy.name));
    statements = app.get<Model<PayStatement>>(getModelToken(PayStatement.name));
    runs = app.get<Model<PayoutRun>>(getModelToken(PayoutRun.name));
    structures = app.get<Model<PaymentStructure>>(
      getModelToken(PaymentStructure.name),
    );
    // `dropTestDatabase` drops the indexes the app built at boot; the claim
    // and the one-statement-per-person rule ride on them.
    await runs.syncIndexes();
    await statements.syncIndexes();
    const chargebacks = app.get<Model<Chargeback>>(
      getModelToken(Chargeback.name),
    );
    const audits = app.get<Model<DealAudit>>(getModelToken(DealAudit.name));
    const leads = app.get<Model<Lead>>(getModelToken(Lead.name));
    const sources = app.get<Model<LeadSource>>(getModelToken(LeadSource.name));
    const agencies = app.get<Model<Agency>>(getModelToken(Agency.name));
    const roleAssignments = app.get(RoleAssignmentsService);

    const producer = await userModel
      .findOne({ email: seed.producerEmail })
      .select('+passwordHash');
    const owner = await userModel.findOne({ email: seed.ownerEmail });
    p1 = String(producer!._id);
    c1 = seed.csrUserId;
    const agencyId = new Types.ObjectId(seed.agencyId);
    const branches = await userModel.db
      .collection('branches')
      .find({ agencyId })
      .toArray();
    otherBranchId = String(
      branches.find((branch) => String(branch._id) !== seed.branchId)!._id,
    );

    const roles = await roleModel.find({ agencyId }).lean();
    const roleId = (slug: string) =>
      roles.find((role) => role.slug === slug)!._id;
    const seedActor = { userId: String(owner!._id), isPlatformAdmin: true };
    const person = async (
      email: string,
      slug: string,
      branchId: string,
      extra: Record<string, unknown> = {},
    ) => {
      const user = await userModel.create({
        agencyId,
        branchId: new Types.ObjectId(branchId),
        email,
        passwordHash: (producer as unknown as { passwordHash: string })
          .passwordHash,
        firstName: email.split('@')[0],
        lastName: 'Fixture',
        isActive: true,
        ...extra,
      });
      await roleAssignments.setUserRoles(seedActor, agencyId, user._id, [
        roleId(slug),
      ]);
      return String(user._id);
    };
    const managerEmail = 'payrun-manager@sfa.local';
    await person(managerEmail, 'branch_manager', seed.branchId);
    p2 = await person('payrun-north@sfa.local', 'producer', otherBranchId);
    p3 = await person('payrun-free@sfa.local', 'producer', seed.branchId);
    formerId = await person(
      'payrun-former@sfa.local',
      'producer',
      seed.branchId,
      {
        isActive: false,
        deactivatedAt: new Date('2026-01-15T12:00:00Z'),
      },
    );

    ownerToken = (await login(app, seed.ownerEmail, TEST_PASSWORD)).accessToken;
    producerToken = (await login(app, seed.producerEmail, TEST_PASSWORD))
      .accessToken;
    managerToken = (await login(app, managerEmail, TEST_PASSWORD)).accessToken;
    readOnlyToken = (await login(app, seed.readOnlyEmail, TEST_PASSWORD))
      .accessToken;

    // The agency's own JYA source, and a lead from it.
    const source = await sources.create({
      agencyId: seed.agencyId,
      name: 'JYA',
      slug: 'jya',
      active: true,
    });
    jya = String(source._id);
    const lead = await leads.collection.insertOne({
      ...main(),
      leadSourceId: source._id,
      producerId: producer!._id,
      firstName: 'Jya',
      lastName: 'Lead',
      createdDate: onDay('2026-03-01'),
    });

    // Sales.
    const d1 = await sell(p1, noon('2026-03-10'), [
      ['Allstate', 'Auto', 3000],
      ['Progressive', 'Home', 2000],
    ]);
    const d2 = await sell(
      p1,
      noon('2026-03-10'),
      [['Allstate', 'Auto', 1500]],
      {
        leadId: lead.insertedId,
      },
    );
    // 11:30 pm Central on the 31st: April 1st in UTC, March for the agency.
    await sell(p1, new Date('2026-04-01T04:30:00.000Z'), [
      ['Allstate', 'Auto', 1000],
    ]);
    await sell(p1, noon('2026-03-15'), [['Allstate', 'Auto', 9999]], {
      businessType: 'company_transfer',
    });
    await sell(p1, noon('2026-03-15'), [['Allstate', 'Auto', 8888]], {
      isTestRecord: true,
    });
    await sell(p1, noon('2026-03-20'), [], {
      premium: 500,
      policyTypes: ['Auto'],
    });
    // 00:30 Central on April 1st — April.
    await sell(p1, new Date('2026-04-01T05:30:00.000Z'), [
      ['Allstate', 'Auto', 777],
    ]);
    await sell(c1, noon('2026-03-05'), [['Allstate', 'Auto', 2000]]);
    await sell(
      p2,
      noon('2026-03-06'),
      [['Travelers', 'Home', 1000]],
      {},
      { agencyId: seed.agencyId, branchId: otherBranchId },
    );
    await sell(p3, noon('2026-03-07'), [['Allstate', 'Auto', 3000]]);

    // D1's audit failed.
    await audits.collection.insertOne({
      ...main(),
      dealId: d1.deal._id,
      auditStatus: 'Fail',
    });

    // D2 cancelled with a chargeback on Mar 25; an older one in February.
    const ledger = (deal: typeof d2, amount: number, occurredAt: Date) => ({
      ...main(),
      policyId: deal.policies[0]._id,
      policyNumber: deal.policies[0].policyNumber,
      policyType: deal.policies[0].policyType,
      dealId: deal.deal._id,
      householdId: deal.deal.householdId,
      producerId: producer!._id,
      producerName: 'Test Producer',
      reason: 'cancellation',
      source: 'app',
      amount,
      soldAdjustment: 0,
      withinClawbackWindow: false,
      occurredAt,
      soldDate: deal.deal.soldDate,
    });
    await chargebacks.create(ledger(d2, 1500, noon('2026-03-25')));
    await chargebacks.create(ledger(d1, 400, noon('2026-02-20')));

    // Settings and the structure, through the API.
    await api()
      .patch('/api/v1/payouts/settings')
      .set(authHeader(ownerToken))
      .send({
        teamBonus: {
          enabled: true,
          stackable: false,
          levels: [{ thresholdPremium: 10_000, poolAmount: 1000 }],
          csrSharePercent: 20,
          producerSharePercent: 80,
        },
        salespersonOfMonth: { enabled: true, bonusAmount: 250 },
      })
      .expect(200);
    const body: UpsertPaymentStructureInput = {
      name: 'Producers',
      rules: [
        { carrier: 'Allstate', ratePercent: 10, minBundleRatePercent: 80 },
        { carrier: ANY_CARRIER, ratePercent: 5 },
      ],
      leadSourceRules: [
        { leadSourceId: jya, carrier: 'Allstate', ratePercent: 6 },
      ],
      hatTrick: { enabled: true, dealsPerDay: 2, bonusAmount: 50 },
      individualTiers: [
        { thresholdPremium: 5000, bonusAmount: 100 },
        { thresholdPremium: 10_000, bonusAmount: 200 },
      ],
      tiersStackable: true,
      teamBonusEligible: true,
      memberIds: [p1, c1, p2],
    };
    const created = await api()
      .post('/api/v1/payouts/structures')
      .set(authHeader(ownerToken))
      .send(body)
      .expect(201);
    structureId = (created.body as { id: string }).id;
    // A member removed from the agency in January: still on the list, idle.
    await structures.updateOne(
      { _id: new Types.ObjectId(structureId) },
      { $push: { memberIds: new Types.ObjectId(formerId) } },
    );
    void agencies;
  });

  afterAll(async () => {
    if (app) {
      await dropTestDatabase(app);
      await closeTestApp(app);
    }
  });

  describe('POST /payouts/runs', () => {
    it('drafts a statement for everyone on a structure', async () => {
      const res = await generate().expect(200);
      const { run, currentMonth } = res.body as PayoutRunResponse;
      expect(currentMonth).toMatch(/^\d{4}-\d{2}$/);
      expect(run).toMatchObject({
        month: MONTH,
        status: 'ready',
        trigger: 'manual',
        timeZone: CHICAGO,
        agencyGrossPremium: 14_000,
        counts: { statements: 3, draft: 3, sent: 0, accepted: 0, rejected: 0 },
        totals: { grossPremium: 11_000 },
      });
      expect(run!.window).toEqual({
        from: '2026-03-01T06:00:00.000Z',
        to: '2026-04-01T05:00:00.000Z',
      });
      expect(run!.teamBonus).toMatchObject({
        enabled: true,
        met: true,
        poolAmount: 1000,
        csrPool: 200,
        producerPool: 800,
        csrPremium: 2000,
        producerPremium: 9000,
      });
      expect(run!.salespersonOfMonth).toMatchObject({
        enabled: true,
        bonusAmount: 250,
        topGrossPremium: 8000,
        winners: [{ userId: p1, name: 'Test Producer' }],
      });
      // The idle former member and the person on no structure get none.
      const ids = (await statements.find({ month: MONTH }).lean()).map((s) =>
        String(s.userId),
      );
      expect(ids.sort()).toEqual([p1, c1, p2].sort());
      expect(ids).not.toContain(formerId);
      expect(ids).not.toContain(p3);
    });

    it("matches the Owner dashboard's sold premium for the month", async () => {
      const range = 'range=custom&from=2026-03-01&to=2026-03-31';
      const agency = (
        await api()
          .get(`/api/v1/owner-dashboard/summary?${range}`)
          .set(authHeader(ownerToken))
          .expect(200)
      ).body as OwnerDashboardSummary;
      expect(agency.premium.current).toBe(14_000);
      const mine = (
        await api()
          .get(`/api/v1/owner-dashboard/summary?${range}&producerIds=${p1}`)
          .set(authHeader(ownerToken))
          .expect(200)
      ).body as OwnerDashboardSummary;
      const statement = await detail(await statementOf(p1));
      expect(statement.totals.grossPremium).toBe(mine.premium.current);
    });

    it('computes the producer statement line by line', async () => {
      const s = await detail(await statementOf(p1));
      expect(s).toMatchObject({
        userName: 'Test Producer',
        pool: 'producer',
        status: 'draft',
        version: 1,
        structureName: 'Producers',
        branchId: seed.branchId,
      });
      expect(
        s.premiumLines.map((line) => [
          line.carrier,
          line.leadSourceName,
          line.grossPremium,
          line.chargebacks,
          line.ratePercent,
          line.grossCommission,
          line.chargebackImpact,
          line.netCommission,
        ]),
      ).toEqual([
        ['Allstate', null, 4000, 0, 10, 400, 0, 400],
        ['Allstate', 'JYA', 1500, 1500, 6, 90, 90, 0],
        ['Progressive', null, 2000, 0, 5, 100, 0, 100],
        [PAYOUT_NO_CARRIER, null, 500, 0, 5, 25, 0, 25],
      ]);
      for (const line of s.premiumLines.filter(
        (l) => l.carrier === 'Allstate',
      )) {
        expect(line).toMatchObject({
          bundleRate: 33.33,
          minBundleRatePercent: 80,
          bundleShortfall: true,
        });
      }
      expect(s.warnings).toContain(
        'Allstate bundle rate 33.33% is below the 80% minimum.',
      );

      expect(s.deals).toHaveLength(4);
      const late = s.deals.find(
        (deal) => deal.soldDate === '2026-04-01T04:30:00.000Z',
      );
      expect(late?.soldDay).toBe('2026-03-31');
      expect(
        s.deals.find((deal) => deal.leadSourceName === 'JYA'),
      ).toBeDefined();
      expect(s.chargebacks).toHaveLength(1);
      expect(s.chargebacks[0]).toMatchObject({
        amount: 1500,
        carrier: 'Allstate',
        leadSourceId: jya,
        ratePercent: 6,
        commissionDeduction: 90,
        reason: 'cancellation',
        source: 'app',
      });

      expect(s.bonuses.hatTrick).toMatchObject({
        days: ['2026-03-10'],
        amount: 50,
      });
      expect(s.bonuses.individual).toMatchObject({
        amount: 100,
        stackable: true,
      });
      expect(s.bonuses.team).toMatchObject({
        eligible: true,
        met: true,
        groupPool: 800,
        groupPremium: 9000,
        amount: 711.11,
      });
      expect(s.bonuses.salespersonOfMonth).toEqual({
        enabled: true,
        winner: true,
        amount: 250,
      });
      expect(s.indicators).toEqual({
        tier: { level: 1, thresholdPremium: 5000 },
        bundleRate: 25,
        hatTricks: 1,
        somStatus: 'winner',
        complianceStatus: 'non_compliant',
        failedAudits: 1,
      });
      expect(s.totals).toEqual({
        grossPremium: 8000,
        chargebackTotal: 1500,
        netPremium: 6500,
        grossCommission: 615,
        chargebackImpact: 90,
        tierBonus: 100,
        teamBonus: 711.11,
        somBonus: 250,
        hatTrickBonus: 50,
        spiffs: 0,
        complianceAdjustment: 0,
        otherAdjustments: 0,
        netCommission: 1636.11,
      });
    });

    it('pays the CSR from the CSR pool, and splits the producer pool to the cent', async () => {
      const csr = await detail(await statementOf(c1));
      expect(csr.pool).toBe('csr');
      expect(csr.bonuses.team).toMatchObject({ groupPool: 200, amount: 200 });
      expect(csr.totals.netCommission).toBe(400);
      const north = await detail(await statementOf(p2));
      expect(north.bonuses.team.amount).toBe(88.89);
      expect(north.totals.netCommission).toBe(138.89);
      expect(north.branchId).toBe(otherBranchId);
    });

    it('refuses a month that has not started, and a month being generated', async () => {
      await generate('2099-01').expect(400);
      await runs.updateOne(
        { month: MONTH },
        { $set: { status: 'generating', startedAt: new Date() } },
      );
      const busy = await generate().expect(409);
      expect((busy.body as { code?: string }).code).toBe(PAYOUT_RUN_GENERATING);
      await runs.updateOne({ month: MONTH }, { $set: { status: 'ready' } });
    });

    it("is the owner's: a branch manager and a producer get 403", async () => {
      await generate(MONTH, managerToken).expect(403);
      await generate(MONTH, producerToken).expect(403);
    });
  });

  describe('who sees what', () => {
    it('shows the owner every statement, filterable', async () => {
      expect((await list(`month=${MONTH}`)).total).toBe(3);
      const north = await list(`month=${MONTH}&branchId=${otherBranchId}`);
      expect(north.statements.map((s) => s.userId)).toEqual([p2]);
      const named = await list(`month=${MONTH}&q=north`);
      expect(named.statements.map((s) => s.userId)).toEqual([p2]);
      expect((await list(`month=${MONTH}&status=sent`)).total).toBe(0);
    });

    it('shows a branch manager their branch only', async () => {
      const mine = await list(`month=${MONTH}`, managerToken);
      expect(mine.statements.map((s) => s.userId).sort()).toEqual(
        [p1, c1].sort(),
      );
      await api()
        .get(`/api/v1/payouts/statements/${await statementOf(p2)}`)
        .set(authHeader(managerToken))
        .expect(404);
      const run = (
        await api()
          .get(`/api/v1/payouts/runs?month=${MONTH}`)
          .set(authHeader(managerToken))
          .expect(200)
      ).body as PayoutRunResponse;
      expect(run.run?.counts.statements).toBe(2);
      expect(run.run?.agencyGrossPremium).toBe(14_000);
    });

    it('never shows an employee a draft, even their own', async () => {
      expect((await list(`month=${MONTH}`, producerToken)).total).toBe(0);
      const own = await statementOf(p1);
      await api()
        .get(`/api/v1/payouts/statements/${own}`)
        .set(authHeader(producerToken))
        .expect(404);
      await api()
        .get(`/api/v1/payouts/runs?month=${MONTH}`)
        .set(authHeader(producerToken))
        .expect(403);
    });

    it("shows an employee their own statement once it is sent, and nobody else's", async () => {
      const own = await statementOf(p1);
      await statements.updateOne(
        { _id: new Types.ObjectId(own) },
        { $set: { status: 'sent' } },
      );
      const mine = await list('', producerToken);
      expect(mine.statements.map((s) => s.id)).toEqual([own]);
      expect((await detail(own, producerToken)).totals.netCommission).toBe(
        1636.11,
      );
      await api()
        .get(`/api/v1/payouts/statements/${await statementOf(c1)}`)
        .set(authHeader(producerToken))
        .expect(404);
      // My Pay for a reviewer is the employee view too.
      expect((await list('mine=true', managerToken)).total).toBe(0);
    });

    it('keeps payouts:read to oneself whatever the data scope', async () => {
      // The seeded read-only role is agency-scoped and holds payouts:read.
      expect((await list(`month=${MONTH}`, readOnlyToken)).total).toBe(0);
      await api()
        .get(`/api/v1/payouts/statements/${await statementOf(c1)}`)
        .set(authHeader(readOnlyToken))
        .expect(404);
    });
  });

  describe('recalculating', () => {
    it('rewrites drafts only, and says whose sent statement no longer matches', async () => {
      // P1's statement is sent (above). A new sale for P2 moves the split.
      await sell(
        p2,
        noon('2026-03-12'),
        [['Travelers', 'Auto', 1000]],
        {},
        { agencyId: seed.agencyId, branchId: otherBranchId },
      );
      const { run } = (await generate().expect(200)).body as PayoutRunResponse;
      expect(run).toMatchObject({
        agencyGrossPremium: 15_000,
        counts: { draft: 2, sent: 1 },
      });
      expect(run!.warnings).toContain(
        "Test Producer's statement was already sent: their team bonus " +
          'would now be $640, and it says $711.11.',
      );
      const sent = await detail(await statementOf(p1));
      expect(sent.totals.netCommission).toBe(1636.11);
      const north = await detail(await statementOf(p2));
      expect(north.totals).toMatchObject({
        grossPremium: 2000,
        teamBonus: 160,
      });
    });

    it('recalculates one draft, and refuses a sent one', async () => {
      const sentId = await statementOf(p1);
      const refused = await api()
        .post(`/api/v1/payouts/statements/${sentId}/recalculate`)
        .set(authHeader(ownerToken))
        .expect(409);
      expect((refused.body as { code?: string }).code).toBe(
        PAYOUT_STATEMENT_NOT_EDITABLE,
      );

      await sell(c1, noon('2026-03-13'), [['Allstate', 'Auto', 500]]);
      const csrId = await statementOf(c1);
      const res = await api()
        .post(`/api/v1/payouts/statements/${csrId}/recalculate`)
        .set(authHeader(managerToken))
        .expect(200);
      const csr = res.body as PayStatementView;
      expect(csr.totals.grossPremium).toBe(2500);
      // The pool split is the month's, kept until the month is recalculated.
      expect(csr.totals.teamBonus).toBe(200);
      expect(csr.warnings[0]).toMatch(/^Sold premium has changed/);

      await api()
        .post(`/api/v1/payouts/statements/${csrId}/recalculate`)
        .set(authHeader(producerToken))
        .expect(403);
    });

    it('drops the draft of someone taken off the structure', async () => {
      await structures.updateOne(
        { _id: new Types.ObjectId(structureId) },
        { $pull: { memberIds: new Types.ObjectId(p2) } },
      );
      const { run } = (await generate().expect(200)).body as PayoutRunResponse;
      expect(run!.counts.statements).toBe(2);
      expect(
        await statements.countDocuments({ userId: new Types.ObjectId(p2) }),
      ).toBe(0);
      await structures.updateOne(
        { _id: new Types.ObjectId(structureId) },
        { $push: { memberIds: new Types.ObjectId(p2) } },
      );
      await generate().expect(200);
    });
  });

  describe('GET /payouts/activity (PAC-179)', () => {
    const activity = (query: string, token = ownerToken) =>
      api().get(`/api/v1/payouts/activity?${query}`).set(authHeader(token));

    it("lists a person's month, with totals equal to their statement", async () => {
      const res = await activity(`month=${MONTH}&userId=${p2}`).expect(200);
      const body = res.body as PayoutActivityView;
      const statement = await detail(await statementOf(p2));
      expect(body).toMatchObject({
        userId: p2,
        month: MONTH,
        statementId: statement.id,
        totals: {
          deals: 2,
          policies: 2,
          premium: statement.totals.grossPremium,
          chargebacks: 0,
          chargebackTotal: statement.totals.chargebackTotal,
        },
      });
    });

    it('names the source of each chargeback, statement or not', async () => {
      const feb = (await activity(`month=2026-02&userId=${p1}`).expect(200))
        .body as PayoutActivityView;
      expect(feb.statementId).toBeNull();
      expect(feb.deals).toHaveLength(0);
      expect(feb.chargebacks).toHaveLength(1);
      expect(feb.chargebacks[0]).toMatchObject({
        amount: 400,
        carrier: 'Allstate',
        reason: 'cancellation',
        source: 'app',
        occurredDay: '2026-02-20',
      });
    });

    it('shows an employee only their own, and a branch manager only their branch', async () => {
      const own = (await activity(`month=${MONTH}`, producerToken).expect(200))
        .body as PayoutActivityView;
      expect(own.userId).toBe(p1);
      expect(own.totals.premium).toBe(8000);
      // Their statement is sent, so they may open it from here.
      expect(own.statementId).toBe(await statementOf(p1));
      await activity(`month=${MONTH}&userId=${c1}`, producerToken).expect(403);
      await activity(`month=${MONTH}&userId=${c1}`, readOnlyToken).expect(403);
      await activity(`month=${MONTH}&userId=${c1}`, managerToken).expect(200);
      await activity(`month=${MONTH}&userId=${p2}`, managerToken).expect(404);
      await activity(`month=2099-01&userId=${p1}`).expect(400);
    });

    it('lists the people a reviewer may pick', async () => {
      const people = (
        await api()
          .get('/api/v1/payouts/activity/people')
          .set(authHeader(managerToken))
          .expect(200)
      ).body as PayoutActivityPeopleResponse;
      const ids = people.people.map((person) => person.id);
      expect(ids).toEqual(expect.arrayContaining([p1, c1, p3]));
      expect(ids).not.toContain(p2);
      expect(ids).not.toContain(formerId);
      await api()
        .get('/api/v1/payouts/activity/people')
        .set(authHeader(producerToken))
        .expect(403);
    });
  });
});
