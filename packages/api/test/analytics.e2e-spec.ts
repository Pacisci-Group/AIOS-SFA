import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import type {
  AnalyticsOptionsResponse,
  AnalyticsSalesSummary,
  OwnerDashboardSummary,
  SalesBreakdownResponse,
  SalesTimeseriesResponse,
  ServiceBreakdownResponse,
  ServiceSummary,
  ServiceTimeseriesResponse,
} from '@sfa/shared';
import { SALES_GROUP_BY } from '@sfa/shared';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { ServiceTicket } from '../src/crm/schemas/service-ticket.schema';
import { Deal } from '../src/deals/schemas/deal.schema';
import { Household } from '../src/households/schemas/household.schema';
import { Lead } from '../src/leads/schemas/lead.schema';
import { AccessResolverService } from '../src/permissions/access-resolver.service';
import { RoleAssignmentsService } from '../src/permissions/role-assignments.service';
import { Agency } from '../src/platform/schemas/agency.schema';
import { Policy } from '../src/policies/schemas/policy.schema';
import { ProducerGoal } from '../src/producer-goals/schemas/producer-goal.schema';
import { QuoteRecap } from '../src/quote-recaps/schemas/quote-recap.schema';
import { AgencyRole } from '../src/roles/schemas/agency-role.schema';
import { User } from '../src/users/schemas/user.schema';
import { authHeader, login } from './helpers/auth.helper';
import {
  TEST_PASSWORD,
  TestSeedContext,
  seedTestData,
} from './helpers/seed-test-data';
import {
  closeTestApp,
  createTestApp,
  dropTestDatabase,
} from './helpers/test-app';

/** May 2026, the window every assertion below is about. */
const MAY = 'range=custom&from=2026-05-01&to=2026-05-31';

/**
 * The Analytics page (PAC-152, part 2).
 *
 * | | branch | producer | premium | lines (carrier) | household | notes |
 * |---|---|---|---|---|---|---|
 * | D1 | main | producer | 3,000 | Auto 1,200 (Allstate) · Home 1,800 (`B4tEH`) | H1 74103, CRM owner | −200 chargeback, lead L1 (Mailer) |
 * | D2 | main | owner | 1,000 | Auto 1,000 (Progressive) | H2 74104 | deal CRM = producer, lead L2 (Facebook) |
 * | D3 | main | — | 500 | none (lineless) | — | Renters by its own type list |
 * | D4 | main | producer | 800 | Auto 800 (Allstate) | H1 | **April** — the comparison window |
 * | D5 | other | owner | 2,000 | Auto 2,000 (Allstate) | — | the other branch |
 *
 * Quotes: Q1 (producer, H1, 5,000 = Auto 2,000 + Home 3,000), Q2 (owner, H2,
 * Auto 2,500). Goals for May: producer 10,000, owner 5,000. Tickets: four
 * opened in May (three main, one other branch), one in April.
 */
describe('Analytics (PAC-152, part 2) (e2e)', () => {
  let app: INestApplication<App>;
  let seed: TestSeedContext;
  let ownerToken: string;
  let managerToken: string;
  let producerToken: string;
  let csrToken: string;
  let producerId: string;
  let ownerId: string;
  let otherBranchId: string;

  const server = () => app.getHttpServer();
  const get = async <T>(path: string, token = ownerToken, status = 200) =>
    (
      await request(server())
        .get(`/api/v1/analytics/${path}`)
        .set(authHeader(token))
        .expect(status)
    ).body as T;

  beforeAll(async () => {
    app = await createTestApp();
    await dropTestDatabase(app);
    seed = await seedTestData(app);

    const model = <T>(name: string) => app.get<Model<T>>(getModelToken(name));
    const userModel = model<User>(User.name);
    const roleModel = model<AgencyRole>(AgencyRole.name);
    const households = model<Household>(Household.name);
    const leads = model<Lead>(Lead.name);
    const deals = model<Deal>(Deal.name);
    const policies = model<Policy>(Policy.name);
    const recaps = model<QuoteRecap>(QuoteRecap.name);
    const goals = model<ProducerGoal>(ProducerGoal.name);
    const tickets = model<ServiceTicket>(ServiceTicket.name);
    const roleAssignments = app.get(RoleAssignmentsService);

    const producer = await userModel
      .findOne({ email: seed.producerEmail })
      .select('+passwordHash');
    const owner = await userModel.findOne({ email: seed.ownerEmail });
    producerId = producer!._id.toString();
    ownerId = owner!._id.toString();
    const other = await households.findById(seed.otherBranchHouseholdId).lean();
    otherBranchId = String(other!.branchId);

    // The persona this page is for, alongside the owner.
    const agencyId = new Types.ObjectId(seed.agencyId);
    const managerRole = await roleModel
      .findOne({ agencyId, slug: 'branch_manager' })
      .lean();
    const manager = await userModel.create({
      agencyId,
      branchId: new Types.ObjectId(seed.branchId),
      email: 'test-analytics-manager@sfa.local',
      passwordHash: (producer as unknown as { passwordHash: string })
        .passwordHash,
      firstName: 'Mara',
      lastName: 'Manager',
      isActive: true,
    });
    await roleAssignments.setUserRoles(
      { userId: ownerId, isPlatformAdmin: true },
      agencyId,
      manager._id,
      [managerRole!._id],
    );

    const main = { agencyId: seed.agencyId, branchId: seed.branchId };
    const elsewhere = { agencyId: seed.agencyId, branchId: otherBranchId };
    const mailer = new Types.ObjectId(seed.leadSourceIds.mailer);
    const facebook = new Types.ObjectId(seed.leadSourceIds.facebook);

    const [h1, h2] = await households.create([
      {
        ...main,
        householdRef: 'HH-AN-1',
        name: 'Analytics One',
        propertyAddress: {
          street: '1 Main St',
          city: 'Tulsa',
          state: 'OK',
          zip: '74103',
        },
        assignedCrmId: owner!._id,
      },
      {
        ...main,
        householdRef: 'HH-AN-2',
        name: 'Analytics Two',
        propertyAddress: {
          street: '2 Main St',
          city: 'Tulsa',
          state: 'OK',
          zip: ' 74104 ',
        },
      },
    ]);
    const [l1, l2] = await leads.create([
      {
        ...main,
        firstName: 'L',
        lastName: 'One',
        status: 'Sold',
        producerId: producer!._id,
        leadSourceId: mailer,
        householdId: h1._id,
      },
      {
        ...main,
        firstName: 'L',
        lastName: 'Two',
        status: 'Sold',
        producerId: owner!._id,
        leadSourceId: facebook,
        householdId: h2._id,
      },
    ]);

    const [d1, d2, , d4, d5] = await deals.create([
      {
        ...main,
        producerId: producer!._id,
        leadId: l1._id,
        householdId: h1._id,
        soldDateYmd: 20260504,
        premium: 3000,
        chargebackAdjustment: -200,
        itemCount: 4,
        policyTypes: ['Auto', 'Home'],
      },
      {
        ...main,
        producerId: owner!._id,
        leadId: l2._id,
        householdId: h2._id,
        assignedCrmId: producer!._id,
        soldDateYmd: 20260520,
        premium: 1000,
        itemCount: 2,
        policyTypes: ['Auto'],
      },
      {
        ...main,
        soldDateYmd: 20260512,
        premium: 500,
        itemCount: 1,
        policyTypes: ['Renters'],
      },
      {
        ...main,
        producerId: producer!._id,
        householdId: h1._id,
        soldDateYmd: 20260415,
        premium: 800,
        itemCount: 1,
        policyTypes: ['Auto'],
      },
      {
        ...elsewhere,
        producerId: owner!._id,
        soldDateYmd: 20260510,
        premium: 2000,
        itemCount: 2,
        policyTypes: ['Auto'],
      },
    ]);
    const line = (
      deal: { _id: Types.ObjectId },
      extra: Record<string, unknown>,
    ) => ({
      ...main,
      dealId: deal._id,
      policyStatus: 'Active',
      ...extra,
    });
    await policies.create([
      line(d1, {
        householdId: h1._id,
        policyNumber: 'AN-1',
        policyType: 'Auto',
        carrier: 'Allstate',
        premium: 1200,
        items: 3,
      }),
      line(d1, {
        householdId: h1._id,
        policyNumber: 'AN-2',
        policyType: 'Home',
        carrier: 'B4tEH',
        premium: 1800,
        items: 1,
      }),
      line(d2, {
        householdId: h2._id,
        policyNumber: 'AN-3',
        policyType: 'Auto',
        carrier: 'Progressive',
        premium: 1000,
        items: 2,
      }),
      line(d4, {
        householdId: h1._id,
        policyNumber: 'AN-4',
        policyType: 'Auto',
        carrier: 'Allstate',
        premium: 800,
        items: 1,
      }),
      {
        ...line(d5, {
          policyNumber: 'AN-5',
          policyType: 'Auto',
          carrier: 'Allstate',
          premium: 2000,
          items: 2,
        }),
        branchId: otherBranchId,
      },
    ]);

    await recaps.create([
      {
        ...main,
        producerId: producer!._id,
        leadId: l1._id,
        householdId: h1._id,
        quoteDateYmd: 20260502,
        premium: 5000,
        itemCount: 4,
        policies: [
          { policyType: 'Auto', premium: 2000, itemCount: 3 },
          { policyType: 'Home', premium: 3000, itemCount: 1 },
        ],
      },
      {
        ...main,
        producerId: owner!._id,
        leadId: l2._id,
        householdId: h2._id,
        quoteDateYmd: 20260515,
        premium: 2500,
        itemCount: 2,
        policies: [{ policyType: 'Auto', premium: 2500, itemCount: 2 }],
      },
    ]);

    await goals.create([
      {
        ...main,
        producerId: producer!._id,
        month: '2026-05',
        goalPremium: 10_000,
      },
      { ...main, producerId: owner!._id, month: '2026-05', goalPremium: 5_000 },
    ]);

    let ticketNo = 1;
    const ticket = (fields: Record<string, unknown>, branch = seed.branchId) =>
      tickets.create({
        agencyId,
        branchId: new Types.ObjectId(branch),
        ticketNumber: `AN-${ticketNo++}`,
        clientName: 'Analytics Client',
        category: 'Billing',
        status: 'open',
        priority: 'medium',
        assignedRep: 'Test Csr',
        assignedUserId: new Types.ObjectId(seed.csrUserId),
        policyType: 'Auto',
        lastActivityAt: new Date('2026-05-03T15:00:00Z'),
        onboarding: null,
        renewal: null,
        ...fields,
      });
    await ticket({
      openedAt: new Date('2026-05-03T15:00:00Z'),
      status: 'resolved',
      resolvedAt: new Date('2026-05-04T15:00:00Z'),
    });
    await ticket({
      openedAt: new Date('2026-05-10T15:00:00Z'),
      category: 'Endorsement',
      policyType: 'Home',
    });
    await ticket({
      openedAt: new Date('2026-05-20T15:00:00Z'),
      status: 'overdue',
      policyType: '',
      assignedUserId: null,
      assignedRep: '',
    });
    await ticket(
      { openedAt: new Date('2026-05-06T15:00:00Z'), category: 'Claims Assist' },
      otherBranchId,
    );
    await ticket({ openedAt: new Date('2026-04-20T15:00:00Z') });

    ownerToken = (await login(app, seed.ownerEmail, TEST_PASSWORD)).accessToken;
    managerToken = (
      await login(app, 'test-analytics-manager@sfa.local', TEST_PASSWORD)
    ).accessToken;
    producerToken = (await login(app, seed.producerEmail, TEST_PASSWORD))
      .accessToken;
    csrToken = (await login(app, seed.csrEmail, TEST_PASSWORD)).accessToken;
  });

  afterAll(async () => {
    // Suites share one database, and a later one may seed without dropping.
    await dropTestDatabase(app);
    await closeTestApp(app);
  });

  describe('access', () => {
    it('refuses a role without analytics:read', async () => {
      await get(`sales/summary?${MAY}`, csrToken, 403);
      await get(`sales/summary?${MAY}`, producerToken, 403);
    });

    it('lets the branch manager in by template', async () => {
      await get(`sales/summary?${MAY}`, managerToken);
    });

    it('refuses everyone while the module is disabled', async () => {
      const agencies = app.get<Model<Agency>>(getModelToken(Agency.name));
      const resolver = app.get(AccessResolverService);
      await agencies.updateOne(
        { _id: seed.agencyId },
        { $set: { 'modules.analytics.enabled': false } },
      );
      await resolver.invalidateAgency(seed.agencyId);
      try {
        await get(`sales/summary?${MAY}`, ownerToken, 403);
      } finally {
        await agencies.updateOne(
          { _id: seed.agencyId },
          { $set: { 'modules.analytics.enabled': true } },
        );
        await resolver.invalidateAgency(seed.agencyId);
      }
    });

    it.each([
      [
        'segmentBy equal to groupBy',
        'sales/breakdown?groupBy=producer&segmentBy=producer',
      ],
      ['an unknown groupBy', 'sales/breakdown?groupBy=nope'],
      ['an unknown interval', 'sales/timeseries?interval=hour'],
      [
        'to before from',
        'sales/summary?range=custom&from=2026-05-31&to=2026-05-01',
      ],
      ['an unknown service groupBy', 'service/breakdown?groupBy=producer'],
    ])('rejects %s with a 400', async (_label, path) => {
      await get(path, ownerToken, 400);
    });
  });

  describe('options', () => {
    it('lists every branch, the producers, ticket assignees and merged carriers for the owner', async () => {
      const options = await get<AnalyticsOptionsResponse>('options');
      expect(options.branches.map((b) => b.id)).toEqual(
        expect.arrayContaining([seed.branchId, otherBranchId]),
      );
      expect(options.producers.map((p) => p.id)).toContain(producerId);
      expect(options.assignees.map((a) => a.id)).toContain(seed.csrUserId);
      // `B4tEH` is Allstate, not a carrier of its own.
      expect(options.carriers).toEqual(
        expect.arrayContaining(['Allstate', 'Progressive']),
      );
      expect(options.carriers).not.toContain('B4tEH');
    });

    it("lists only the manager's own branch", async () => {
      const options = await get<AnalyticsOptionsResponse>(
        'options',
        managerToken,
      );
      expect(options.branches.map((b) => b.id)).toEqual([seed.branchId]);
    });
  });

  describe('sales summary', () => {
    it('agrees with the Owner dashboard for the same filters', async () => {
      const summary = await get<AnalyticsSalesSummary>(`sales/summary?${MAY}`);
      const owner = (
        await request(server())
          .get(`/api/v1/owner-dashboard/summary?${MAY}`)
          .set(authHeader(ownerToken))
          .expect(200)
      ).body as OwnerDashboardSummary;
      expect(summary.premium.current).toBe(owner.premium.current);
      expect(summary.premium.current).toBe(6500);
      expect(summary.items.current).toBe(owner.items.current);
      expect(summary.closingRatio?.current).toBe(owner.closingRatio.current);
    });

    it('reports net premium after chargebacks, and households', async () => {
      const summary = await get<AnalyticsSalesSummary>(`sales/summary?${MAY}`);
      // 3,000 − 200 + 1,000 + 500 + 2,000.
      expect(summary.netPremium.current).toBe(6300);
      expect(summary.households.current).toBe(4);
      expect(summary.policies.current).toBe(4);
    });

    it('paces May against the goals of everyone in scope', async () => {
      const { pacing, pacingGap } = await get<AnalyticsSalesSummary>(
        `sales/summary?${MAY}`,
      );
      expect(pacingGap).toBeNull();
      expect(pacing).toMatchObject({
        month: '2026-05',
        goalPremium: 15_000,
        boundPremium: 6500,
        producersWithGoals: 2,
        daysInMonth: 31,
      });
    });

    it('explains a missing pacing card', async () => {
      const span = await get<AnalyticsSalesSummary>(
        'sales/summary?range=custom&from=2026-04-01&to=2026-05-31',
      );
      expect(span.pacingGap).toBe('not_one_month');
      const june = await get<AnalyticsSalesSummary>(
        'sales/summary?range=custom&from=2026-06-01&to=2026-06-30',
      );
      expect(june.pacingGap).toBe('no_goals_for_month');
      const filtered = await get<AnalyticsSalesSummary>(
        `sales/summary?${MAY}&policyTypes=Auto`,
      );
      expect(filtered.pacingGap).toBe('filtered');
    });

    it('has no closing ratio under a carrier filter — quotes record no carrier', async () => {
      const summary = await get<AnalyticsSalesSummary>(
        `sales/summary?${MAY}&carriers=Allstate`,
      );
      expect(summary.closingRatio).toBeNull();
      // Allstate lines only: D1 Auto 1,200 + Home 1,800 (`B4tEH`) + D5 2,000.
      expect(summary.premium.current).toBe(5000);
    });
  });

  describe('sales breakdown', () => {
    it.each(SALES_GROUP_BY)(
      'rows grouped by %s add up to the summary',
      async (groupBy) => {
        const breakdown = await get<SalesBreakdownResponse>(
          `sales/breakdown?${MAY}&groupBy=${groupBy}`,
        );
        const sum = (pick: (m: SalesBreakdownResponse['totals']) => number) =>
          Math.round(
            breakdown.rows.reduce((acc, row) => acc + pick(row.metrics), 0) *
              100,
          ) / 100;
        expect(breakdown.totals.premium).toBe(6500);
        expect(sum((m) => m.premium)).toBe(breakdown.totals.premium);
        expect(sum((m) => m.items)).toBe(breakdown.totals.items);
      },
    );

    it('labels producers, keeps the unassigned sale as a row, and closes per producer', async () => {
      const { rows } = await get<SalesBreakdownResponse>(
        `sales/breakdown?${MAY}&groupBy=producer`,
      );
      const mine = rows.find((row) => row.key === producerId)!;
      expect(mine.metrics).toMatchObject({
        premium: 3000,
        netPremium: 2800,
        quotes: 1,
        quotedPremium: 5000,
        closingPct: 60,
      });
      expect(mine.label).toBeTruthy();
      const unassigned = rows.find((row) => row.key === null)!;
      expect(unassigned).toMatchObject({ label: 'Unassigned' });
      expect(unassigned.metrics.premium).toBe(500);
      // The unassigned row sorts last whatever its size.
      expect(rows[rows.length - 1].key).toBeNull();
    });

    it('splits a sale across its lines, folding the untyped one into Unspecified', async () => {
      const { rows, unavailable } = await get<SalesBreakdownResponse>(
        `sales/breakdown?${MAY}&groupBy=policyType`,
      );
      const byKey = Object.fromEntries(rows.map((r) => [r.key ?? '', r]));
      expect(byKey.Auto.metrics.premium).toBe(4200);
      expect(byKey.Home.metrics.premium).toBe(1800);
      expect(byKey[''].label).toBe('Unspecified');
      // A chargeback belongs to a sale, not a policy.
      expect(unavailable).toContain('netPremium');
      expect(byKey.Auto.metrics.netPremium).toBeNull();
      // Quotes still split by line.
      expect(byKey.Auto.metrics.quotedPremium).toBe(4500);
    });

    it('merges carrier spellings and has no quote side', async () => {
      const { rows, unavailable } = await get<SalesBreakdownResponse>(
        `sales/breakdown?${MAY}&groupBy=carrier`,
      );
      const byKey = Object.fromEntries(rows.map((r) => [r.key ?? '', r]));
      expect(byKey.allstate).toMatchObject({ label: 'Allstate' });
      expect(byKey.allstate.metrics.premium).toBe(5000);
      expect(byKey.progressive.metrics.premium).toBe(1000);
      expect(byKey[''].label).toBe('Unknown carrier');
      expect(unavailable).toEqual(
        expect.arrayContaining(['quotes', 'quotedPremium', 'closingPct']),
      );
      expect(byKey.allstate.metrics.quotes).toBeNull();
    });

    it("groups by the household's ZIP, trimmed, with quotes alongside", async () => {
      const { rows } = await get<SalesBreakdownResponse>(
        `sales/breakdown?${MAY}&groupBy=zip`,
      );
      const byKey = Object.fromEntries(rows.map((r) => [r.key ?? '', r]));
      expect(byKey['74103'].metrics).toMatchObject({
        premium: 3000,
        quotes: 1,
      });
      expect(byKey['74104'].metrics.premium).toBe(1000);
      expect(byKey[''].label).toBe('No ZIP');
    });

    it("credits the deal's CRM first, then the household's", async () => {
      const { rows } = await get<SalesBreakdownResponse>(
        `sales/breakdown?${MAY}&groupBy=csr`,
      );
      const byKey = Object.fromEntries(rows.map((r) => [r.key ?? '', r]));
      expect(byKey[ownerId].metrics.premium).toBe(3000);
      expect(byKey[producerId].metrics.premium).toBe(1000);
    });

    it('names lead sources through the lead', async () => {
      const { rows } = await get<SalesBreakdownResponse>(
        `sales/breakdown?${MAY}&groupBy=leadSource`,
      );
      const mailer = rows.find((r) => r.key === seed.leadSourceIds.mailer)!;
      expect(mailer).toMatchObject({ label: 'Mailer' });
      expect(mailer.metrics.premium).toBe(3000);
      expect(rows.find((r) => r.key === null)!.label).toBe('No source');
    });

    it('splits producers by line — the multi-line view', async () => {
      const breakdown = await get<SalesBreakdownResponse>(
        `sales/breakdown?${MAY}&groupBy=producer&segmentBy=policyType`,
      );
      const mine = breakdown.rows.find((row) => row.key === producerId)!;
      expect(
        Object.fromEntries(
          mine.segments!.map((s) => [s.key, s.metrics.premium]),
        ),
      ).toEqual({ Home: 1800, Auto: 1200 });
      for (const row of breakdown.rows) {
        const parts = row.segments!.reduce(
          (sum, s) => sum + s.metrics.premium,
          0,
        );
        expect(Math.round(parts * 100) / 100).toBe(row.metrics.premium);
      }
      expect(breakdown.series.map((s) => s.key)).toEqual(
        expect.arrayContaining(['Auto', 'Home', null]),
      );
    });

    it('compares each row with the prior window', async () => {
      const breakdown = await get<SalesBreakdownResponse>(
        `sales/breakdown?${MAY}&groupBy=producer&compare=true`,
      );
      const mine = breakdown.rows.find((row) => row.key === producerId)!;
      // The custom window's comparison is the 31 days before it: D4 in April.
      expect(mine.previous!.premium).toBe(800);
      expect(mine.change!.premium).toBe(275);
      expect(breakdown.previousTotals!.premium).toBe(800);
    });
  });

  describe('sales timeseries', () => {
    it('buckets by month, zero-filled, quotes beside sales', async () => {
      const series = await get<SalesTimeseriesResponse>(
        'sales/timeseries?range=custom&from=2026-03-01&to=2026-05-31&interval=month',
      );
      expect(series.buckets.map((b) => b.key)).toEqual([
        '2026-03',
        '2026-04',
        '2026-05',
      ]);
      expect(series.buckets.map((b) => b.metrics.premium)).toEqual([
        0, 800, 6500,
      ]);
      expect(series.buckets[2].metrics.quotes).toBe(2);
    });

    it('buckets by day and by Monday-started week, summing to the window', async () => {
      const days = await get<SalesTimeseriesResponse>(
        `sales/timeseries?${MAY}&interval=day`,
      );
      expect(days.buckets).toHaveLength(31);
      expect(
        days.buckets.find((b) => b.key === '2026-05-04')!.metrics.premium,
      ).toBe(3000);
      const weeks = await get<SalesTimeseriesResponse>(
        `sales/timeseries?${MAY}&interval=week`,
      );
      // May 1 2026 is a Friday; its week began on Monday April 27.
      expect(weeks.buckets[0]).toMatchObject({
        key: '2026-04-27',
        from: '2026-05-01',
        to: '2026-05-03',
      });
      const total = weeks.buckets.reduce(
        (sum, b) => sum + b.metrics.premium,
        0,
      );
      expect(total).toBe(6500);
    });

    it('splits each bucket by a segment and aligns the prior window by position', async () => {
      const series = await get<SalesTimeseriesResponse>(
        `sales/timeseries?${MAY}&interval=month&segmentBy=carrier&compare=true`,
      );
      expect(series.buckets[0].segments!.allstate.premium).toBe(5000);
      expect(series.series[0]).toEqual({ key: 'allstate', label: 'Allstate' });
      expect(series.previous).toHaveLength(2);
    });
  });

  describe('data scope', () => {
    beforeAll(async () => {
      await app
        .get(RoleAssignmentsService)
        .setUserOverrides(seed.agencyId, producerId, ['analytics:read'], []);
      await app.get(AccessResolverService).invalidateUser(producerId);
    });

    it('lets the owner narrow to one branch', async () => {
      const summary = await get<AnalyticsSalesSummary>(
        `sales/summary?${MAY}&branchId=${otherBranchId}`,
      );
      expect(summary.premium.current).toBe(2000);
    });

    it('keeps the manager in their branch, and refuses another', async () => {
      const mine = await get<AnalyticsSalesSummary>(
        `sales/summary?${MAY}`,
        managerToken,
      );
      expect(mine.premium.current).toBe(4500);
      // Their own branch, asked for explicitly, is the same answer.
      const own = await get<AnalyticsSalesSummary>(
        `sales/summary?${MAY}&branchId=${seed.branchId}`,
        managerToken,
      );
      expect(own.premium.current).toBe(4500);
      // `BranchGuard` refuses a branch outside a branch-scoped caller's.
      await get(
        `sales/summary?${MAY}&branchId=${otherBranchId}`,
        managerToken,
        403,
      );
    });

    it('pins a producer granted the page to their own sales', async () => {
      const summary = await get<AnalyticsSalesSummary>(
        `sales/summary?${MAY}&producerIds=${ownerId}`,
        producerToken,
      );
      expect(summary.premium.current).toBe(3000);
      expect(summary.pacing).toMatchObject({ goalPremium: 10_000 });
    });

    it("gives a producer their branch's tickets — the CRM rule", async () => {
      const summary = await get<ServiceSummary>(
        `service/summary?${MAY}`,
        producerToken,
      );
      expect(summary.opened.current).toBe(3);
    });
  });

  describe('service', () => {
    it('counts tickets opened and resolved in the window, and open work now', async () => {
      const summary = await get<ServiceSummary>(`service/summary?${MAY}`);
      expect(summary.opened.current).toBe(4);
      expect(summary.resolved.current).toBe(1);
      expect(summary.avgHoursToResolve.current).toBe(24);
      // Everything still open, the April ticket included — a snapshot.
      expect(summary.openNow).toBe(4);
      expect(summary.overdueNow).toBe(1);
    });

    it('breaks tickets down by category, assignee, line and branch', async () => {
      const byCategory = await get<ServiceBreakdownResponse>(
        `service/breakdown?${MAY}&groupBy=category`,
      );
      expect(
        Object.fromEntries(
          byCategory.rows.map((r) => [r.key, r.metrics.opened]),
        ),
      ).toEqual({ Billing: 2, Endorsement: 1, 'Claims Assist': 1 });
      expect(byCategory.totals).toMatchObject({
        opened: 4,
        resolved: 1,
        overdue: 1,
      });

      const byAssignee = await get<ServiceBreakdownResponse>(
        `service/breakdown?${MAY}&groupBy=assignee`,
      );
      expect(byAssignee.rows.find((r) => r.key === null)!.label).toBe(
        'Unassigned',
      );
      expect(
        byAssignee.rows.find((r) => r.key === seed.csrUserId)!.metrics.opened,
      ).toBe(3);

      const byLine = await get<ServiceBreakdownResponse>(
        `service/breakdown?${MAY}&groupBy=policyType`,
      );
      expect(byLine.rows.find((r) => r.key === null)!.label).toBe(
        'Unspecified',
      );

      const byBranch = await get<ServiceBreakdownResponse>(
        `service/breakdown?${MAY}&groupBy=branch&compare=true`,
      );
      expect(byBranch.rows).toHaveLength(2);
      expect(byBranch.previousTotals!.opened).toBe(1);
    });

    it('charts opened against resolved per month', async () => {
      const series = await get<ServiceTimeseriesResponse>(
        'service/timeseries?range=custom&from=2026-04-01&to=2026-05-31&interval=month',
      );
      expect(series.buckets).toEqual([
        expect.objectContaining({ key: '2026-04', opened: 1, resolved: 0 }),
        expect.objectContaining({ key: '2026-05', opened: 4, resolved: 1 }),
      ]);
    });

    it('narrows the owner to a branch and filters by assignee', async () => {
      const branch = await get<ServiceSummary>(
        `service/summary?${MAY}&branchId=${otherBranchId}`,
      );
      expect(branch.opened.current).toBe(1);
      const assigned = await get<ServiceSummary>(
        `service/summary?${MAY}&assigneeIds=${seed.csrUserId}`,
      );
      expect(assigned.opened.current).toBe(3);
    });
  });
});
