import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import type {
  AgingAuditRow,
  ManagementAlertList,
  ManagementAlerts,
  OverdueTicketRow,
  ProducerDrawerResponse,
  StalledLeadRow,
  TeamActivityResponse,
} from '@sfa/shared';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { addBusinessDays } from '../src/common/dates/business-days';
import { ServiceTicket } from '../src/crm/schemas/service-ticket.schema';
import { DealAuditItem } from '../src/deal-audit-items/schemas/deal-audit-item.schema';
import { DealAudit } from '../src/deal-audits/schemas/deal-audit.schema';
import { Deal } from '../src/deals/schemas/deal.schema';
import { Household } from '../src/households/schemas/household.schema';
import { Lead } from '../src/leads/schemas/lead.schema';
import {
  addDays,
  chicagoDayStart,
  chicagoParts,
  toIsoDate,
  toYmd,
} from '../src/performance/performance.range';
import { RoleAssignmentsService } from '../src/permissions/role-assignments.service';
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

/**
 * The Manager View dashboard (PAC-139).
 *
 * Every fixture is dated **relative to now** — stalled, aging and overdue are
 * all "as of this moment" — and asked for as a custom window covering the last
 * sixty days, so the suite is independent of the calendar without pinning a
 * month the way the Owner suite does.
 *
 * Main branch unless noted. `P` = the seeded producer, `O` = the owner, `C` =
 * the CSR, `X` = a producer in the other branch, `F` = a deactivated producer.
 *
 * | leads | producer | status | last activity | created | notes |
 * |---|---|---|---|---|---|
 * | L1 | P | New | 3 days ago | 10 days ago | Mailer, wants Auto — **stalled** |
 * | L2 | P | New | *never* | 10 days ago | Facebook — **stalled** |
 * | L3 | P | Sold | 3 days ago | 10 days ago | terminal |
 * | L4 | P | `jp76g` (Lost) | 3 days ago | 10 days ago | terminal, raw code |
 * | L5 | P | New | 1 hour ago | 10 days ago | fresh |
 * | L6 | P | New | 3 days ago | 100 days ago | outside the window |
 * | L7 | X | New | 3 days ago | 10 days ago | other branch — **stalled** |
 * | L8 | O | New | 3 days ago | 10 days ago | **stalled** |
 *
 * | deals | producer | sold | audit | notes |
 * |---|---|---|---|---|
 * | D1 | P | 30 days ago | Not Submitted | Auto — **aging** |
 * | D2 | P | 30 days ago | Fail, 2 open items | **aging** |
 * | D3 | P | 30 days ago | Pass | |
 * | D4 | P | 30 days ago | *none* | |
 * | D5 | P | 4 business days ago | Not Submitted | inside the SLA |
 * | D6 | P | 7 business days ago | Not Submitted | same household as D5 — **aging** |
 * | D7 | P | 30 days ago | Not Submitted | company transfer — not a sale |
 * | D8 | X | 30 days ago | Pending | other branch — **aging** |
 * | D9 | P | 400 days ago | Fail, 1 open item raised 390 days ago | outside the window; still backlog |
 * | D10 | F | 20 days ago | Pass | a deactivated producer's sale |
 * | D11 | O | 20 days ago | *none* | the owner's own sale |
 *
 * Quotes: Q1 and Q2 on L1's household (Q1 newer, $1,500), Q3 on D2's — so P
 * quoted **2** households and sold **5** (D1–D6 less the shared one; D7 is a
 * transfer, D9 is outside the window).
 *
 * | tickets | assigned | kind | notes |
 * |---|---|---|---|
 * | T1 | P | plain, `overdue`, Home | **overdue** |
 * | T2 | C | plain, `open` | |
 * | T3 | C | onboarding, due 3 days ago, `overdue` | **overdue** |
 * | T4 | C | renewal, due yesterday, `overdue` | **overdue** |
 *
 * T3 and T4 carry the stored `overdue` the status sweep would have written
 * (PAC-102): the card reads the column, not the step's `dueAt`.
 * | T5 | C | onboarding, due 3 days ago, status pinned `open` | overridden |
 * | T6 | C | onboarding, opens in 2 days | waiting |
 * | T7 | C | plain, `overdue`, opened 100 days ago | outside the window |
 * | T8 | C | plain, `overdue` | **overdue** |
 * | T9 | C | plain, `overdue`, other branch | **overdue** for the owner only (also the CSR's) |
 */
describe('Management dashboard (PAC-139) (e2e)', () => {
  let app: INestApplication<App>;
  let seed: TestSeedContext;
  let ownerToken: string;
  let managerToken: string;
  let producerToken: string;
  let csrToken: string;
  let readOnlyToken: string;
  let producerId: string;
  let ownerId: string;
  let otherProducerId: string;
  let formerProducerId: string;
  let ids: Record<string, string>;
  let WINDOW: string;

  const now = new Date();
  const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);
  const hoursAgo = (hours: number) =>
    new Date(now.getTime() - hours * 3_600_000);
  const today = chicagoParts(now);
  /** A sale on the Chicago calendar day `n` business days back. */
  const soldBusinessDaysAgo = (n: number) => {
    const day = addBusinessDays(today, -n);
    return {
      soldDate: new Date(chicagoDayStart(day).getTime() + 12 * 3_600_000),
      soldDateYmd: toYmd(day),
    };
  };
  const soldDaysAgo = (n: number) => ({
    soldDate: daysAgo(n),
    soldDateYmd: toYmd(chicagoParts(daysAgo(n))),
  });

  const get = async <T>(path: string, query: string, token = ownerToken) => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/management-dashboard/${path}?${query}`)
      .set(authHeader(token))
      .expect(200);
    return res.body as T;
  };
  const alerts = (query = WINDOW, token = ownerToken) =>
    get<ManagementAlerts>('alerts', query, token);
  const stalled = (query = WINDOW, token = ownerToken) =>
    get<ManagementAlertList<StalledLeadRow>>(
      'alerts/stalled-leads',
      query,
      token,
    );
  const aging = (query = WINDOW, token = ownerToken) =>
    get<ManagementAlertList<AgingAuditRow>>(
      'alerts/aging-audits',
      query,
      token,
    );
  const overdue = (query = WINDOW, token = ownerToken) =>
    get<ManagementAlertList<OverdueTicketRow>>(
      'alerts/overdue-tickets',
      query,
      token,
    );
  const team = (query = WINDOW, token = ownerToken) =>
    get<TeamActivityResponse>('team', query, token);
  const drawer = (id: string, query = WINDOW, token = ownerToken) =>
    get<ProducerDrawerResponse>(`producers/${id}`, query, token);

  beforeAll(async () => {
    app = await createTestApp();
    // Drop BEFORE seeding — suites share one database and jest reorders them.
    await dropTestDatabase(app);
    seed = await seedTestData(app);

    WINDOW = `range=custom&from=${toIsoDate(addDays(today, -60))}&to=${toIsoDate(today)}`;

    const model = <T>(name: string) => app.get<Model<T>>(getModelToken(name));
    const userModel = model<User>(User.name);
    const roleModel = model<AgencyRole>(AgencyRole.name);
    const leadModel = model<Lead>(Lead.name);
    const dealModel = model<Deal>(Deal.name);
    const auditModel = model<DealAudit>(DealAudit.name);
    const itemModel = model<DealAuditItem>(DealAuditItem.name);
    const recapModel = model<QuoteRecap>(QuoteRecap.name);
    const ticketModel = model<ServiceTicket>(ServiceTicket.name);
    const householdModel = model<Household>(Household.name);
    const roleAssignments = app.get(RoleAssignmentsService);

    const producer = await userModel
      .findOne({ email: seed.producerEmail })
      .select('+passwordHash');
    const owner = await userModel.findOne({ email: seed.ownerEmail });
    producerId = producer!._id.toString();
    ownerId = owner!._id.toString();

    const agencyId = new Types.ObjectId(seed.agencyId);
    const mainBranchId = new Types.ObjectId(seed.branchId);
    const otherBranch = await householdModel
      .findById(seed.otherBranchHouseholdId)
      .lean<{ branchId: string }>();
    const otherBranchId = otherBranch!.branchId;

    // Three more people: the persona this page is for, a producer in the other
    // branch, and a producer who has left but sold something in the window.
    const passwordHash = (producer as unknown as { passwordHash: string })
      .passwordHash;
    const roles = await roleModel.find({ agencyId }).lean();
    const roleId = (slug: string) =>
      roles.find((role) => role.slug === slug)!._id;
    const seedActor = { userId: ownerId, isPlatformAdmin: true };

    const person = async (
      email: string,
      branchId: Types.ObjectId,
      slug: string,
      extra: Record<string, unknown> = {},
    ) => {
      const user = await userModel.create({
        agencyId,
        branchId,
        email,
        passwordHash,
        firstName: email.split('@')[0],
        lastName: 'Fixture',
        isActive: true,
        ...extra,
      });
      await roleAssignments.setUserRoles(seedActor, agencyId, user._id, [
        roleId(slug),
      ]);
      return user._id.toString();
    };
    const managerEmail = 'test-branch-manager@sfa.local';
    await person(managerEmail, mainBranchId, 'branch_manager');
    otherProducerId = await person(
      'test-other-producer@sfa.local',
      new Types.ObjectId(otherBranchId),
      'producer',
    );
    formerProducerId = await person(
      'test-former-producer@sfa.local',
      mainBranchId,
      'producer',
      { isActive: false, deactivatedAt: daysAgo(5) },
    );

    const main = { agencyId: seed.agencyId, branchId: seed.branchId };
    const other = { agencyId: seed.agencyId, branchId: otherBranchId };
    const mailer = new Types.ObjectId(seed.leadSourceIds.mailer);
    const facebook = new Types.ObjectId(seed.leadSourceIds.facebook);
    const oid = (id: string) => new Types.ObjectId(id);
    ids = {};

    // ── Leads ─────────────────────────────────────────────────────────────
    const lead = async (
      key: string,
      fields: Record<string, unknown>,
      scope = main,
    ) => {
      const doc = await leadModel.create({
        ...scope,
        firstName: key,
        lastName: 'Lead',
        temperature: 'Warm',
        createdDate: daysAgo(10),
        ...fields,
      });
      ids[key] = doc._id.toString();
      return doc;
    };
    const l1 = await lead('L1', {
      producerId: oid(producerId),
      status: 'New',
      lastActivityAt: daysAgo(3),
      leadSourceId: mailer,
      householdId: oid(seed.householdId),
      policiesOfInterest: [{ policyType: 'Auto', itemCount: 1 }],
    });
    await lead('L2', {
      producerId: oid(producerId),
      status: 'New',
      leadSourceId: facebook,
    });
    await lead('L3', {
      producerId: oid(producerId),
      status: 'Sold',
      lastActivityAt: daysAgo(3),
    });
    await lead('L4', {
      producerId: oid(producerId),
      status: 'jp76g',
      lastActivityAt: daysAgo(3),
    });
    await lead('L5', {
      producerId: oid(producerId),
      status: 'New',
      lastActivityAt: hoursAgo(1),
    });
    await lead('L6', {
      producerId: oid(producerId),
      status: 'New',
      lastActivityAt: daysAgo(3),
      createdDate: daysAgo(100),
    });
    await lead(
      'L7',
      {
        producerId: oid(otherProducerId),
        status: 'New',
        lastActivityAt: daysAgo(3),
      },
      other,
    );
    await lead('L8', {
      producerId: oid(ownerId),
      status: 'New',
      lastActivityAt: daysAgo(3),
    });

    // ── Deals + audits ────────────────────────────────────────────────────
    const deal = async (
      key: string,
      fields: Record<string, unknown>,
      audit: {
        auditStatus: string;
        openItems?: number;
        /** How long ago the open items were raised. */
        raisedDaysAgo?: number;
      } | null,
      scope = main,
    ) => {
      const doc = await dealModel.create({
        ...scope,
        clientName: `${key} Client`,
        householdId: new Types.ObjectId(),
        dealType: 'Home',
        policyTypes: ['Home'],
        premium: 1000,
        itemCount: 1,
        premiumSource: 'rollup',
        ...soldDaysAgo(30),
        ...fields,
      });
      ids[key] = doc._id.toString();
      if (audit) {
        const open = audit.openItems ?? 0;
        const raised = audit.raisedDaysAgo ?? 12;
        const roll = await auditModel.create({
          ...scope,
          dealId: doc._id,
          auditStatus: audit.auditStatus,
          itemCount: open,
          resolvedCount: 0,
          openFailedCount: open,
          oldestOpenAt: open ? daysAgo(raised) : undefined,
        });
        ids[`${key}.audit`] = roll._id.toString();
        for (let n = 0; n < open; n += 1) {
          await itemModel.create({
            ...scope,
            dealId: doc._id,
            dealAuditId: roll._id,
            itemName: `${key} item ${n + 1}`,
            isFailed: true,
            isResolved: false,
            firstCreatedAt: daysAgo(raised - n),
          });
        }
      }
      return doc;
    };
    const P = oid(producerId);
    const d1 = await deal(
      'D1',
      {
        producerId: P,
        householdId: oid(seed.householdId),
        dealType: 'Auto',
        policyTypes: ['Auto'],
        leadId: l1._id,
      },
      { auditStatus: 'Not Submitted' },
    );
    const d2 = await deal(
      'D2',
      { producerId: P },
      { auditStatus: 'Fail', openItems: 2 },
    );
    await deal('D3', { producerId: P }, { auditStatus: 'Pass' });
    await deal('D4', { producerId: P }, null);
    const sharedHousehold = new Types.ObjectId();
    await deal(
      'D5',
      {
        producerId: P,
        householdId: sharedHousehold,
        ...soldBusinessDaysAgo(4),
      },
      { auditStatus: 'Not Submitted' },
    );
    await deal(
      'D6',
      {
        producerId: P,
        householdId: sharedHousehold,
        ...soldBusinessDaysAgo(7),
      },
      { auditStatus: 'Not Submitted' },
    );
    await deal(
      'D7',
      { producerId: P, businessType: 'company_transfer' },
      { auditStatus: 'Not Submitted' },
    );
    await deal(
      'D8',
      { producerId: oid(otherProducerId) },
      { auditStatus: 'Pending' },
      other,
    );
    await deal(
      'D9',
      { producerId: P, ...soldDaysAgo(400) },
      { auditStatus: 'Fail', openItems: 1, raisedDaysAgo: 390 },
    );
    await deal(
      'D10',
      { producerId: oid(formerProducerId), ...soldDaysAgo(20) },
      { auditStatus: 'Pass' },
    );
    await deal('D11', { producerId: oid(ownerId), ...soldDaysAgo(20) }, null);

    // ── Quote recaps ──────────────────────────────────────────────────────
    const recap = (fields: Record<string, unknown>) =>
      recapModel.create({
        ...main,
        producerId: P,
        premium: 1000,
        itemCount: 1,
        productsQuoted: ['Auto'],
        policies: [{ policyType: 'Auto', premium: 1000, itemCount: 1 }],
        ...fields,
      });
    const quoted = (n: number) => ({
      quoteDate: daysAgo(n),
      quoteDateYmd: toYmd(chicagoParts(daysAgo(n))),
    });
    await recap({
      householdId: d1.householdId,
      leadId: l1._id,
      premium: 1500,
      ...quoted(10),
    });
    await recap({
      householdId: d1.householdId,
      leadId: l1._id,
      premium: 900,
      ...quoted(20),
    });
    await recap({ householdId: d2.householdId, ...quoted(5) });

    // ── Service tickets ───────────────────────────────────────────────────
    let ticketNo = 900;
    const ticket = async (
      key: string,
      fields: Record<string, unknown>,
      branchId: Types.ObjectId = mainBranchId,
    ) => {
      const doc = await ticketModel.create({
        agencyId,
        branchId,
        ticketNumber: `MGR-${ticketNo++}`,
        clientName: `${key} Client`,
        category: 'Billing',
        status: 'open',
        priority: 'medium',
        assignedRep: 'Test Csr',
        assignedUserId: oid(seed.csrUserId),
        openedAt: daysAgo(5),
        lastActivityAt: daysAgo(5),
        onboarding: null,
        renewal: null,
        ...fields,
      });
      ids[key] = doc._id.toString();
    };
    const onboarding = (dueAt: Date, availableAt = daysAgo(5)) => ({
      category: 'Onboarding',
      onboarding: {
        onboardingId: new Types.ObjectId(),
        stepKey: 'welcome_call',
        sequence: 1,
        availableAt,
        dueAt,
        completedAt: null,
        completedBy: null,
        completedByName: '',
      },
    });
    await ticket('T1', {
      status: 'overdue',
      assignedUserId: P,
      assignedRep: 'Test Producer',
      policyType: 'Home',
    });
    await ticket('T2', { status: 'open' });
    await ticket('T3', { ...onboarding(daysAgo(3)), status: 'overdue' });
    await ticket('T4', {
      category: 'Renewal Review',
      status: 'overdue',
      renewal: {
        renewalCycleId: new Types.ObjectId(),
        stepKey: 'annual_review',
        track: 'annual',
        sequence: 1,
        totalSteps: 1,
        renewalDate: daysAgo(-30),
        availableAt: daysAgo(5),
        dueAt: daysAgo(1),
        completedAt: null,
        completedBy: null,
        completedByName: '',
      },
    });
    await ticket('T5', {
      ...onboarding(daysAgo(3)),
      statusOverriddenAt: daysAgo(2),
    });
    await ticket('T6', {
      ...onboarding(daysAgo(-4), daysAgo(-2)),
      status: 'waiting',
    });
    await ticket('T7', {
      status: 'overdue',
      openedAt: daysAgo(100),
      lastActivityAt: daysAgo(100),
    });
    await ticket('T8', {
      status: 'overdue',
      openedAt: daysAgo(2),
      lastActivityAt: daysAgo(2),
    });
    await ticket(
      'T9',
      { status: 'overdue' },
      new Types.ObjectId(otherBranchId),
    );

    ownerToken = (await login(app, seed.ownerEmail, TEST_PASSWORD)).accessToken;
    managerToken = (await login(app, managerEmail, TEST_PASSWORD)).accessToken;
    producerToken = (await login(app, seed.producerEmail, TEST_PASSWORD))
      .accessToken;
    csrToken = (await login(app, seed.csrEmail, TEST_PASSWORD)).accessToken;
    readOnlyToken = (await login(app, seed.readOnlyEmail, TEST_PASSWORD))
      .accessToken;
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  describe('the three alert cards', () => {
    it('count the fixtures, agency-wide for the owner', async () => {
      const body = await alerts();
      expect(body.period.key).toBe('custom');
      expect(body.stalledLeads).toBe(4);
      expect(body.agingAudits).toBe(4);
      expect(body.overdueTickets).toBe(5);
    });

    it.each([
      ['stalled-leads', 'stalledLeads'],
      ['aging-audits', 'agingAudits'],
      ['overdue-tickets', 'overdueTickets'],
    ] as const)(
      'the %s drawer total is the card number, and the page holds it',
      async (path, card) => {
        const [cards, list] = await Promise.all([
          alerts(),
          get<ManagementAlertList<unknown>>(`alerts/${path}`, WINDOW),
        ]);
        expect(list.total).toBe(cards[card]);
        expect(list.items).toHaveLength(cards[card]);
        expect(list.totalPages).toBe(1);
      },
    );

    it('pages the drawer', async () => {
      const page = await stalled(`${WINDOW}&pageSize=3&page=2`);
      expect(page.total).toBe(4);
      expect(page.totalPages).toBe(2);
      expect(page.items).toHaveLength(1);
    });
  });

  describe('stalled leads', () => {
    it('is lastActivityAt, missing included, terminal statuses excluded', async () => {
      const { items } = await stalled();
      const byId = new Map(items.map((row) => [row.leadId, row]));
      expect([...byId.keys()].sort()).toEqual(
        [ids.L1, ids.L2, ids.L7, ids.L8].sort(),
      );
      // Never touched at all: still stalled, with nothing to measure from.
      expect(byId.get(ids.L2)).toMatchObject({
        lastActivityAt: null,
        hoursSinceActivity: null,
      });
      expect(byId.get(ids.L1)).toMatchObject({
        status: 'New',
        producerId,
        producerName: 'Test Producer',
        leadSourceName: 'Mailer',
        householdId: seed.householdId,
      });
      expect(byId.get(ids.L1)!.hoursSinceActivity).toBeGreaterThanOrEqual(71);
    });

    it('lists the stalest first', async () => {
      const { items } = await stalled();
      // A missing `lastActivityAt` sorts before every date.
      expect(items[0].leadId).toBe(ids.L2);
    });

    it('narrows by producer, source and line of business', async () => {
      expect(
        (await alerts(`${WINDOW}&producerIds=${producerId}`)).stalledLeads,
      ).toBe(2);
      expect(
        (await alerts(`${WINDOW}&leadSourceIds=${seed.leadSourceIds.mailer}`))
          .stalledLeads,
      ).toBe(1);
      expect((await alerts(`${WINDOW}&policyTypes=Auto`)).stalledLeads).toBe(1);
      expect(
        (await stalled(`${WINDOW}&policyTypes=Auto`)).items[0].leadId,
      ).toBe(ids.L1);
    });
  });

  describe('aging audits', () => {
    it('is sold more than five business days ago with an audit that is not Pass', async () => {
      const { items } = await aging();
      expect(items.map((row) => row.dealId).sort()).toEqual(
        [ids.D1, ids.D2, ids.D6, ids.D8].sort(),
      );
      for (const row of items) {
        expect(row.auditStatus).not.toBe('Pass');
        expect(row.businessDaysOpen).toBeGreaterThan(5);
      }
      const d2 = items.find((row) => row.dealId === ids.D2)!;
      expect(d2).toMatchObject({
        dealAuditId: ids['D2.audit'],
        auditStatus: 'Fail',
        openFailedCount: 2,
        clientName: 'D2 Client',
        producerName: 'Test Producer',
      });
      // Oldest sale first; D6 is the most recent of the four.
      expect(items[items.length - 1].dealId).toBe(ids.D6);
    });

    it('narrows by producer and line of business', async () => {
      expect(
        (await alerts(`${WINDOW}&producerIds=${producerId}`)).agingAudits,
      ).toBe(3);
      const auto = await aging(`${WINDOW}&policyTypes=Auto`);
      expect(auto.items.map((row) => row.dealId)).toEqual([ids.D1]);
    });

    it('resolves the lead source through the lead', async () => {
      const mailer = await aging(
        `${WINDOW}&leadSourceIds=${seed.leadSourceIds.mailer}`,
      );
      expect(mailer.items.map((row) => row.dealId)).toEqual([ids.D1]);
    });
  });

  describe('overdue tickets', () => {
    it('is the stored status the sweep maintains, with the step dueAt on the row', async () => {
      const { items } = await overdue();
      expect(items.map((row) => row.ticketId).sort()).toEqual(
        [ids.T1, ids.T3, ids.T4, ids.T8, ids.T9].sort(),
      );
      const t3 = items.find((row) => row.ticketId === ids.T3)!;
      expect(t3.dueAt).not.toBeNull();
      expect(t3.daysOverdue).toBeGreaterThanOrEqual(2);
      const t1 = items.find((row) => row.ticketId === ids.T1)!;
      expect(t1).toMatchObject({
        dueAt: null,
        daysOverdue: null,
        assignedUserId: producerId,
      });
    });

    it('narrows by the assigned person and by line of business', async () => {
      // T3, T4, T8 and — agency-wide — T9.
      expect(
        (await alerts(`${WINDOW}&producerIds=${seed.csrUserId}`))
          .overdueTickets,
      ).toBe(4);
      expect(
        (await alerts(`${WINDOW}&producerIds=${seed.csrUserId}`, managerToken))
          .overdueTickets,
      ).toBe(3);
      expect((await alerts(`${WINDOW}&policyTypes=Home`)).overdueTickets).toBe(
        1,
      );
    });
  });

  describe('team activity', () => {
    it('lists every producer in households, and anyone else who sold', async () => {
      const { rows, totals } = await team();
      const byId = new Map(rows.map((row) => [row.producerId, row]));

      expect(byId.has(seed.csrUserId)).toBe(false);
      expect(byId.get(producerId)).toMatchObject({
        name: 'Test Producer',
        initials: 'TP',
        availability: 'available',
        householdsQuoted: 2,
        householdsSold: 5,
        householdCloseRatio: 250,
        openAuditItems: 3,
      });
      // The other branch's producer: on the roster, nothing in this window.
      expect(byId.get(otherProducerId)).toMatchObject({
        householdsQuoted: 0,
        householdsSold: 1,
        householdCloseRatio: null,
      });
      // The owner is not a producer, but sold D11.
      expect(byId.get(ownerId)).toMatchObject({
        householdsSold: 1,
        householdsQuoted: 0,
        householdCloseRatio: null,
        availability: 'available',
      });
      // Deactivated, still sold D10 — named, with no availability.
      expect(byId.get(formerProducerId)).toMatchObject({
        householdsSold: 1,
        availability: null,
      });

      expect(totals).toEqual({
        householdsQuoted: 2,
        householdsSold: 8,
        householdCloseRatio: 400,
        openAuditItems: 3,
      });
    });

    it('ignores the producer filter — the table is the team', async () => {
      const { rows } = await team(`${WINDOW}&producerIds=${ownerId}`);
      expect(rows.some((row) => row.producerId === producerId)).toBe(true);
    });

    it('applies the line-of-business filter to the household counts', async () => {
      const { rows } = await team(`${WINDOW}&policyTypes=Auto`);
      const producer = rows.find((row) => row.producerId === producerId)!;
      // Only D1 is Auto; every quote fixture is Auto.
      expect(producer.householdsSold).toBe(1);
      expect(producer.householdsQuoted).toBe(2);
      // The backlog is not a period figure and not a line figure.
      expect(producer.openAuditItems).toBe(3);
    });
  });

  describe('producer drawer', () => {
    it("carries the row's figures, the open pipeline and the open items", async () => {
      const body = await drawer(producerId);
      expect(body.producer).toMatchObject({
        producerId,
        name: 'Test Producer',
        availability: 'available',
      });
      expect(body.stats).toEqual({
        householdsQuoted: 2,
        householdsSold: 5,
        householdCloseRatio: 250,
        openAuditItems: 3,
      });

      // Open, in the window, most recently worked first; a lead never touched
      // sorts last.
      expect(body.activePipeline.map((lead) => lead.leadId)).toEqual([
        ids.L5,
        ids.L1,
        ids.L2,
      ]);
      const l1 = body.activePipeline.find((lead) => lead.leadId === ids.L1)!;
      expect(l1).toMatchObject({
        status: 'New',
        lineOfBusiness: 'Auto',
        value: 1500,
        householdId: seed.householdId,
      });
      expect(l1.ageDays).toBeGreaterThanOrEqual(9);
      expect(
        body.activePipeline.find((lead) => lead.leadId === ids.L2)!.value,
      ).toBeNull();

      expect(body.openAuditItems).toHaveLength(3);
      expect(body.openAuditItems[0]).toMatchObject({
        dealId: ids.D9,
        dealAuditId: ids['D9.audit'],
        clientName: 'D9 Client',
        itemTitle: 'D9 item 1',
      });
      expect(body.openAuditItems[0].daysOpen).toBeGreaterThanOrEqual(389);
    });

    it('rejects a malformed id and hides an unknown one', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/management-dashboard/producers/not-an-id')
        .set(authHeader(ownerToken))
        .expect(400);
      await request(app.getHttpServer())
        .get(
          `/api/v1/management-dashboard/producers/${new Types.ObjectId().toString()}`,
        )
        .set(authHeader(ownerToken))
        .expect(404);
    });
  });

  describe('a branch manager', () => {
    it('sees their branch on every card', async () => {
      const body = await alerts(WINDOW, managerToken);
      expect(body.stalledLeads).toBe(3);
      expect(body.agingAudits).toBe(3);
      expect(body.overdueTickets).toBe(4);
    });

    it("sees their branch's team", async () => {
      const { rows } = await team(WINDOW, managerToken);
      const producers = rows.map((row) => row.producerId).sort();
      expect(producers).toEqual([producerId, ownerId, formerProducerId].sort());
    });

    it('cannot open a producer from another branch', async () => {
      await request(app.getHttpServer())
        .get(
          `/api/v1/management-dashboard/producers/${otherProducerId}?${WINDOW}`,
        )
        .set(authHeader(managerToken))
        .expect(404);
      await drawer(producerId, WINDOW, managerToken);
    });
  });

  describe('access', () => {
    it.each(['alerts', 'alerts/stalled-leads', 'team'])(
      'GET /management-dashboard/%s — forbidden without management:read',
      async (path) => {
        for (const token of [producerToken, csrToken]) {
          await request(app.getHttpServer())
            .get(`/api/v1/management-dashboard/${path}`)
            .set(authHeader(token))
            .expect(403);
        }
      },
    );

    it('is readable by any holder of management:read', async () => {
      // The read-only fixture role is agency-scoped, like the owner.
      const body = await alerts(WINDOW, readOnlyToken);
      expect(body.stalledLeads).toBe(4);
    });

    it("is read-only — the stub's bare GET and PATCH are gone", async () => {
      await request(app.getHttpServer())
        .get('/api/v1/management')
        .set(authHeader(ownerToken))
        .expect(404);
      await request(app.getHttpServer())
        .patch('/api/v1/management')
        .set(authHeader(ownerToken))
        .expect(404);
    });
  });

  describe('validation', () => {
    it.each([
      ['an unknown range', 'range=fortnight'],
      ['a producer-dashboard-only range', 'range=week'],
      ['custom without bounds', 'range=custom'],
      ['a page below one', 'range=mtd&page=0'],
      ['a page size past the cap', 'range=mtd&pageSize=201'],
    ])('rejects %s (400)', async (_name, query) => {
      await request(app.getHttpServer())
        .get(`/api/v1/management-dashboard/alerts/stalled-leads?${query}`)
        .set(authHeader(ownerToken))
        .expect(400);
    });

    it('defaults to this month', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/management-dashboard/alerts')
        .set(authHeader(ownerToken))
        .expect(200);
      expect((res.body as ManagementAlerts).period.key).toBe('mtd');
    });
  });
});
