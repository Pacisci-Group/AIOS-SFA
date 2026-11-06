import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import {
  ANY_CARRIER,
  PAYOUT_STATEMENT_NOT_EDITABLE,
  type PaymentStructureView,
  type PayoutRunResponse,
  type PayStatementView,
  type StatementInputs,
  type UpsertPaymentStructureInput,
} from '@sfa/shared';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { businessDateInstant } from '../src/common/dates/business-dates';
import { Deal } from '../src/deals/schemas/deal.schema';
import { Lead } from '../src/leads/schemas/lead.schema';
import { LeadSource } from '../src/lead-sources/schemas/lead-source.schema';
import { PayStatement } from '../src/payouts/schemas/pay-statement.schema';
import { PayoutRun } from '../src/payouts/schemas/payout-run.schema';
import { RoleAssignmentsService } from '../src/permissions/role-assignments.service';
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
const noon = (iso: string) =>
  new Date(businessDateInstant(iso, CHICAGO).getTime() + 12 * 3_600_000);

const JUNE = '2026-06';
const DECEMBER = '2025-12';

const NO_INPUTS: StatementInputs = {
  compliancePercent: null,
  retentionPercent: null,
  lifeReferrals: null,
  meetingAttendance: null,
};

const step = (
  threshold: number,
  ratePercent: number,
  extra: Partial<{
    bonusAmount: number;
    minCompliancePercent: number | null;
    minBundleRatePercent: number | null;
  }> = {},
) => ({
  threshold,
  ratePercent,
  bonusAmount: extra.bonusAmount ?? 0,
  minCompliancePercent: extra.minCompliancePercent ?? null,
  minBundleRatePercent: extra.minBundleRatePercent ?? null,
});

/**
 * David's 2026 comp plans (6 Nov 2026), end to end through the API: June
 * 2026 in the seeded agency (Chicago). Team bonus: $100,000 of agency
 * premium → a $1,000 pool, 20/80.
 *
 * | who | structure | June sales |
 * |---|---|---|
 * | inside (seeded producer) | Inside Sales: 8%, 10% from $50,001; $1,500 at $100,000 (compliance 95%); $2,500 base; floor 85% / 10% | Allstate 60,000 + 50,000 (one sale) |
 * | outside | Outside Sales: 10% / 12% from $50,000 / 15% from $80,000 (95% compliance, 83% bundles); stipend 2,500 / 2,000 / 1,500 from May; 1% of Overflow | Allstate 60,000 · Allstate 15,000 + Progressive 15,000 |
 * | crm (seeded CSR) | Client Relations Manager: Allstate 0% → 5% / 6% / 7.5% + $500 at 83 / 86 / 90% retention; $4,000 base; referrals 15 / 40; team: Sold Log in 1 day + attendance | Allstate 10,000, entered 4 days late |
 * | om | Office Manager: 1% of all agency premium; $1,500 at $150,000 / $2,000 at $200,000 of Allstate; $4,000 base | — |
 * | free | none | Allstate 20,000 from an Overflow lead |
 *
 * Agency premium 230,000, Allstate 215,000.
 */
describe('Payouts — 2026 comp plans (e2e)', () => {
  let app: INestApplication<App>;
  let seed: TestSeedContext;
  let ownerToken: string;
  let producerToken: string;
  let managerToken: string;
  let inside: string;
  let outside: string;
  let crm: string;
  let om: string;
  let overflow: string;
  let otherAgencySource: string;
  let outsideStructure: PaymentStructureView;
  let dealModel: Model<Deal>;
  let policyModel: Model<Policy>;
  let statements: Model<PayStatement>;

  const api = () => request(app.getHttpServer());
  const main = () => ({ agencyId: seed.agencyId, branchId: seed.branchId });

  const generate = (month: string) =>
    api()
      .post('/api/v1/payouts/runs')
      .set(authHeader(ownerToken))
      .send({ month })
      .expect(200)
      .then((res) => res.body as PayoutRunResponse);

  const statementOf = async (userId: string, month = JUNE) => {
    const doc = await statements
      .findOne({ userId: new Types.ObjectId(userId), month })
      .lean();
    return String(doc!._id);
  };

  const detail = async (userId: string, month = JUNE) =>
    (
      await api()
        .get(`/api/v1/payouts/statements/${await statementOf(userId, month)}`)
        .set(authHeader(ownerToken))
        .expect(200)
    ).body as PayStatementView;

  const enter = async (
    userId: string,
    inputs: Partial<StatementInputs>,
    expected = 200,
    month = JUNE,
    token = managerToken,
  ) =>
    api()
      .patch(
        `/api/v1/payouts/statements/${await statementOf(userId, month)}/inputs`,
      )
      .set(authHeader(token))
      .send({ ...NO_INPUTS, ...inputs })
      .expect(expected);

  let sequence = 0;
  const sell = async (
    producerId: string,
    day: string,
    policies: [carrier: string, premium: number][],
    extra: Record<string, unknown> = {},
    enteredOn?: string,
  ) => {
    sequence += 1;
    const deal = await dealModel.create({
      ...main(),
      producerId: new Types.ObjectId(producerId),
      clientName: `Plan client ${sequence}`,
      householdId: new Types.ObjectId(),
      dealType: 'Other',
      policyTypes: policies.map(() => 'Auto'),
      premium: policies.reduce((sum, [, premium]) => sum + premium, 0),
      itemCount: policies.length,
      premiumSource: 'rollup',
      soldDate: noon(day),
      status: 'Sold',
      ...extra,
    });
    await policyModel.create(
      policies.map(([carrier, premium], index) => ({
        ...main(),
        dealId: deal._id,
        householdId: deal.householdId,
        policyNumber: `PLAN-${sequence}-${index}`,
        policyStatus: 'Active',
        policyType: 'Auto',
        carrier,
        premium,
        items: 1,
      })),
    );
    // When it was entered in the app: the Sold Log requirement reads it.
    await dealModel.collection.updateOne(
      { _id: deal._id },
      { $set: { createdAt: noon(enteredOn ?? day) } },
    );
    return deal;
  };

  const structure = async (body: UpsertPaymentStructureInput) =>
    (
      await api()
        .post('/api/v1/payouts/structures')
        .set(authHeader(ownerToken))
        .send(body)
        .expect(201)
    ).body as PaymentStructureView;

  const base = (
    name: string,
    memberIds: string[],
  ): UpsertPaymentStructureInput => ({
    name,
    rules: [{ carrier: ANY_CARRIER, ratePercent: 0 }],
    leadSourceRules: [],
    hatTrick: { enabled: false, dealsPerDay: 3, bonusAmount: 0 },
    individualTiers: [],
    tiersStackable: false,
    teamBonusEligible: false,
    memberIds,
  });

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
    const runs = app.get<Model<PayoutRun>>(getModelToken(PayoutRun.name));
    await runs.syncIndexes();
    await statements.syncIndexes();
    const leads = app.get<Model<Lead>>(getModelToken(Lead.name));
    const sources = app.get<Model<LeadSource>>(getModelToken(LeadSource.name));
    const roleAssignments = app.get(RoleAssignmentsService);

    const producer = await userModel
      .findOne({ email: seed.producerEmail })
      .select('+passwordHash');
    const owner = await userModel.findOne({ email: seed.ownerEmail });
    inside = String(producer!._id);
    crm = seed.csrUserId;
    const agencyId = new Types.ObjectId(seed.agencyId);
    const roles = await roleModel.find({ agencyId }).lean();
    const roleId = (slug: string) =>
      roles.find((role) => role.slug === slug)!._id;
    const person = async (email: string, slug: string) => {
      const user = await userModel.create({
        agencyId,
        branchId: new Types.ObjectId(seed.branchId),
        email,
        passwordHash: (producer as unknown as { passwordHash: string })
          .passwordHash,
        firstName: email.split('@')[0],
        lastName: 'Plan',
        isActive: true,
      });
      await roleAssignments.setUserRoles(
        { userId: String(owner!._id), isPlatformAdmin: true },
        agencyId,
        user._id,
        [roleId(slug)],
      );
      return String(user._id);
    };
    const managerEmail = 'plan-manager@sfa.local';
    await person(managerEmail, 'branch_manager');
    outside = await person('plan-outside@sfa.local', 'producer');
    om = await person('plan-office@sfa.local', 'producer');
    const free = await person('plan-free@sfa.local', 'producer');

    ownerToken = (await login(app, seed.ownerEmail, TEST_PASSWORD)).accessToken;
    producerToken = (await login(app, seed.producerEmail, TEST_PASSWORD))
      .accessToken;
    managerToken = (await login(app, managerEmail, TEST_PASSWORD)).accessToken;

    const source = await sources.create({
      agencyId: seed.agencyId,
      name: 'Overflow — Outside',
      slug: 'overflow-outside',
      active: true,
    });
    overflow = String(source._id);
    otherAgencySource = String(
      (
        await sources.create({
          agencyId: new Types.ObjectId().toHexString(),
          name: 'Someone else',
          slug: 'someone-else',
          active: true,
        })
      )._id,
    );
    const lead = await leads.collection.insertOne({
      ...main(),
      leadSourceId: source._id,
      producerId: new Types.ObjectId(free),
      firstName: 'Over',
      lastName: 'Flow',
      createdDate: noon('2026-06-01'),
    });

    // June 2026.
    await sell(inside, '2026-06-10', [
      ['Allstate', 60_000],
      ['Allstate', 50_000],
    ]);
    await sell(outside, '2026-06-03', [['Allstate', 60_000]]);
    await sell(outside, '2026-06-04', [
      ['Allstate', 15_000],
      ['Progressive', 15_000],
    ]);
    await sell(crm, '2026-06-05', [['Allstate', 10_000]], {}, '2026-06-09');
    await sell(free, '2026-06-06', [['Allstate', 20_000]], {
      leadId: lead.insertedId,
    });
    // December 2025, for Producer of the Year.
    await sell(inside, '2025-12-08', [['Allstate', 5000]]);
    await sell(outside, '2025-12-09', [['Allstate', 9000]]);

    await api()
      .patch('/api/v1/payouts/settings')
      .set(authHeader(ownerToken))
      .send({
        teamBonus: {
          enabled: true,
          stackable: false,
          levels: [{ thresholdPremium: 100_000, poolAmount: 1000 }],
          csrSharePercent: 20,
          producerSharePercent: 80,
        },
        producerOfYear: {
          enabled: true,
          bonusAmount: 2500,
          minCompliantMonths: 1,
          minCompliancePercent: 95,
        },
      })
      .expect(200);

    await structure({
      ...base('Inside Sales 2026', [inside]),
      rules: [
        {
          carrier: ANY_CARRIER,
          ratePercent: 8,
          stepBasis: 'premium',
          steps: [step(50_001, 10)],
        },
      ],
      individualTiers: [
        {
          thresholdPremium: 100_000,
          bonusAmount: 1500,
          minCompliancePercent: 95,
        },
      ],
      teamBonusEligible: true,
      basePay: 2500,
      complianceFloor: { minimumPercent: 85, reductionPercent: 10 },
    });
    outsideStructure = await structure({
      ...base('Outside Sales 2026', [outside]),
      rules: [
        {
          carrier: ANY_CARRIER,
          ratePercent: 10,
          stepBasis: 'premium',
          steps: [
            step(80_000, 15, {
              minCompliancePercent: 95,
              minBundleRatePercent: 83,
            }),
            step(50_000, 12),
          ],
        },
      ],
      stipendAmounts: [2500, 2000, 1500],
      memberStarts: [
        { userId: outside, startMonth: '2026-05' },
        // Not a member: dropped.
        { userId: crm, startMonth: '2026-01' },
      ],
      overrides: [
        {
          basis: 'lead_source',
          leadSourceId: overflow,
          carrier: ANY_CARRIER,
          ratePercent: 1,
        },
      ],
    });
    await structure({
      ...base('Client Relations Manager', [crm]),
      rules: [
        {
          carrier: 'Allstate',
          ratePercent: 0,
          stepBasis: 'retention',
          steps: [
            step(83, 5),
            step(86, 6),
            step(90, 7.5, { bonusAmount: 500 }),
          ],
        },
      ],
      teamBonusEligible: true,
      basePay: 4000,
      referralRule: {
        minimum: 15,
        shortfallDeduction: 500,
        bonusThreshold: 40,
        bonusAmount: 500,
      },
      teamRequirements: { soldLogWithinDays: 1, meetingAttendance: true },
      chargebackWindowMonths: 6,
    });
    await structure({
      ...base('Office Manager', [om]),
      basePay: 4000,
      overrides: [
        {
          basis: 'agency',
          leadSourceId: null,
          carrier: ANY_CARRIER,
          ratePercent: 1,
        },
      ],
      agencyTiers: [
        { thresholdPremium: 200_000, bonusAmount: 2000 },
        { thresholdPremium: 150_000, bonusAmount: 1500 },
      ],
      agencyTiersCarrier: 'Allstate',
    });
  });

  afterAll(async () => {
    if (app) {
      await dropTestDatabase(app);
      await closeTestApp(app);
    }
  });

  describe('structures', () => {
    it('stores the plan parts normalised and reads them back named', () => {
      expect(outsideStructure.rules[0]).toEqual({
        carrier: ANY_CARRIER,
        ratePercent: 10,
        minBundleRatePercent: null,
        stepBasis: 'premium',
        steps: [
          step(50_000, 12),
          step(80_000, 15, {
            minCompliancePercent: 95,
            minBundleRatePercent: 83,
          }),
        ],
      });
      expect(outsideStructure.stipendAmounts).toEqual([2500, 2000, 1500]);
      expect(outsideStructure.memberStarts).toEqual([
        { userId: outside, startMonth: '2026-05' },
      ]);
      expect(outsideStructure.overrides).toEqual([
        {
          basis: 'lead_source',
          leadSourceId: overflow,
          leadSourceName: 'Overflow — Outside',
          carrier: ANY_CARRIER,
          ratePercent: 1,
        },
      ]);
      expect(outsideStructure.basePay).toBe(0);
      expect(outsideStructure.complianceFloor).toBeNull();
      expect(outsideStructure.teamRequirements).toEqual({
        soldLogWithinDays: null,
        meetingAttendance: false,
      });
    });

    it.each([
      [
        'a step below the base rate',
        {
          rules: [
            { carrier: ANY_CARRIER, ratePercent: 10, steps: [step(5000, 8)] },
          ],
        },
        /cannot pay less than the base rate/,
      ],
      [
        'a lead-source override with no source',
        {
          overrides: [
            {
              basis: 'lead_source',
              leadSourceId: null,
              carrier: ANY_CARRIER,
              ratePercent: 1,
            },
          ],
        },
        /needs a lead source/,
      ],
      [
        'a start month out of form',
        {
          memberStarts: [
            {
              userId: new Types.ObjectId().toHexString(),
              startMonth: '2026-13',
            },
          ],
        },
        /YYYY-MM/,
      ],
      [
        'a referral bonus at or under the minimum',
        {
          referralRule: {
            minimum: 15,
            shortfallDeduction: 500,
            bonusThreshold: 15,
            bonusAmount: 500,
          },
        },
        /above the minimum/,
      ],
    ])('refuses %s', async (_label, patch, message) => {
      const res = await api()
        .post('/api/v1/payouts/structures')
        .set(authHeader(ownerToken))
        .send({ ...base('Refused', []), ...patch })
        .expect(400);
      expect(JSON.stringify(res.body)).toMatch(message);
    });

    it("refuses an override on another agency's lead source", async () => {
      await api()
        .post('/api/v1/payouts/structures')
        .set(authHeader(ownerToken))
        .send({
          ...base('Refused', []),
          overrides: [
            {
              basis: 'lead_source',
              leadSourceId: otherAgencySource,
              carrier: ANY_CARRIER,
              ratePercent: 1,
            },
          ],
        })
        .expect(400);
    });
  });

  describe('June 2026', () => {
    beforeAll(async () => {
      await generate(JUNE);
    });

    it('pays Inside Sales 10% on all of $110,000, base pay, and holds the gated tier', async () => {
      const s = await detail(inside);
      expect(
        s.premiumLines.find((l) => l.carrier === 'Allstate'),
      ).toMatchObject({
        ratePercent: 10,
        rateStep: 1,
        grossCommission: 11_000,
      });
      expect(s.totals).toMatchObject({
        basePay: 2500,
        tierBonus: 0,
        // The whole producer half of the pool: no other eligible producer.
        teamBonus: 800,
        netCommission: 11_800,
        netPay: 14_300,
      });
      expect(s.inputsNeeded).toEqual({
        compliance: true,
        retention: false,
        referrals: false,
        attendance: false,
      });
      expect(s.warnings.join(' ')).toContain('$100,000 tier');
    });

    it('pays Outside Sales the 12% step, the month-2 stipend and 1% of the overflow', async () => {
      const s = await detail(outside);
      expect(
        s.premiumLines
          .filter((l) => l.grossPremium > 0)
          .map((l) => [l.carrier, l.ratePercent, l.rateStep]),
      ).toEqual([
        ['Allstate', 12, 1],
        ['Progressive', 12, 1],
      ]);
      expect(s.bonuses.overrides).toEqual([
        expect.objectContaining({
          leadSourceName: 'Overflow — Outside',
          premium: 20_000,
          amount: 200,
        }),
      ]);
      expect(s.totals).toMatchObject({
        grossCommission: 10_800,
        stipend: 2000,
        overrideCommission: 200,
        netPay: 13_000,
      });
      expect(s.warnings.join(' ')).toContain(
        'the 15% step at $80,000 is not paid',
      );
    });

    it('pays the Office Manager 1% of the office and the Allstate production bonus', async () => {
      const s = await detail(om);
      expect(s.bonuses.agency).toMatchObject({
        carrier: 'Allstate',
        premium: 215_000,
        amount: 2000,
      });
      expect(s.totals).toMatchObject({
        overrideCommission: 2300,
        agencyBonus: 2000,
        basePay: 4000,
        netPay: 8300,
      });
    });

    it('keeps the Client Relations Manager out of the pool for a late Sold Log entry', async () => {
      const s = await detail(crm);
      expect(s.totals).toMatchObject({
        basePay: 4000,
        teamBonus: 0,
        netPay: 4000,
      });
      expect(s.bonuses.teamBlocked).toEqual([
        '1 sale was entered more than 1 day after the sold date.',
        'Sales meeting attendance is not entered.',
      ]);
      expect(s.inputsNeeded).toEqual({
        // Producer of the Year is on: every statement asks for it.
        compliance: true,
        retention: true,
        referrals: true,
        attendance: true,
      });
    });
  });

  describe('PATCH /payouts/statements/:id/inputs', () => {
    it('unlocks the Inside Sales tier once the compliance rate is entered', async () => {
      const res = await enter(inside, { compliancePercent: 96 });
      const s = res.body as PayStatementView;
      expect(s.inputs).toEqual({ ...NO_INPUTS, compliancePercent: 96 });
      expect(s.totals).toMatchObject({ tierBonus: 1500, netPay: 15_800 });
    });

    it('pays the CRM retention step, its bonus and the referral bonus', async () => {
      const s = (
        await enter(crm, {
          retentionPercent: 91,
          lifeReferrals: 40,
          meetingAttendance: true,
        })
      ).body as PayStatementView;
      expect(
        s.premiumLines.find((l) => l.carrier === 'Allstate'),
      ).toMatchObject({ ratePercent: 7.5, rateStep: 3, grossCommission: 750 });
      expect(s.totals).toMatchObject({
        rateStepBonus: 500,
        referralAdjustment: 500,
        netPay: 4000 + 750 + 500 + 500,
      });
    });

    it('below the floor: base rate, no bonuses, 10% off, and asks for a month recalculation', async () => {
      const s = (await enter(inside, { compliancePercent: 80 }))
        .body as PayStatementView;
      expect(
        s.premiumLines.find((l) => l.carrier === 'Allstate'),
      ).toMatchObject({
        ratePercent: 8,
        rateStep: null,
        grossCommission: 8800,
      });
      expect(s.totals).toMatchObject({
        tierBonus: 0,
        teamBonus: 0,
        complianceReduction: -880,
        netCommission: 7920,
        netPay: 10_420,
      });
      expect(s.warnings[0]).toMatch(/^Sold premium or eligibility has changed/);
    });

    it('re-splits the pool on a month recalculation, keeping the figures', async () => {
      const run = (await generate(JUNE)).run!;
      expect(run.teamBonus.producerPool).toBe(800);
      expect(run.warnings.join(' ')).toContain(
        'No team-eligible producer sold this month',
      );
      const s = await detail(inside);
      expect(s.inputs.compliancePercent).toBe(80);
      expect(s.totals.netPay).toBe(10_420);
    });

    it('refuses a producer, bad figures, and a sent statement', async () => {
      await enter(inside, {}, 403, JUNE, producerToken);
      await enter(crm, { retentionPercent: 120 }, 400);
      await statements.updateOne(
        { _id: new Types.ObjectId(await statementOf(om)) },
        { $set: { status: 'sent' } },
      );
      const res = await enter(om, { compliancePercent: 99 }, 409);
      expect((res.body as { code: string }).code).toBe(
        PAYOUT_STATEMENT_NOT_EDITABLE,
      );
    });
  });

  describe('Producer of the Year', () => {
    it("goes to the year's top compliant producer on December's run", async () => {
      const first = (await generate(DECEMBER)).run!;
      // No compliance entered yet: nobody has a compliant month.
      expect(first.producerOfYear).toMatchObject({
        enabled: true,
        winners: [],
      });
      // With it on, every statement asks for the compliance rate — the
      // Office Manager's structure reads none of the figures itself.
      expect((await detail(om, DECEMBER)).inputsNeeded.compliance).toBe(true);
      await enter(inside, { compliancePercent: 96 }, 200, DECEMBER);
      await enter(outside, { compliancePercent: 90 }, 200, DECEMBER);
      const run = (await generate(DECEMBER)).run!;
      // Outside sold more, but was not compliant in any month.
      expect(run.producerOfYear).toMatchObject({
        enabled: true,
        bonusAmount: 2500,
        topGrossPremium: 5000,
        winners: [{ userId: inside }],
      });
      const s = await detail(inside, DECEMBER);
      expect(s.totals.producerOfYearBonus).toBe(2500);
      expect((await detail(outside, DECEMBER)).totals.producerOfYearBonus).toBe(
        0,
      );
    });

    it('is not on any other month', async () => {
      const june = (
        await api()
          .get(`/api/v1/payouts/runs?month=${JUNE}`)
          .set(authHeader(ownerToken))
          .expect(200)
      ).body as PayoutRunResponse;
      expect(june.run?.producerOfYear).toBeNull();
    });
  });
});
