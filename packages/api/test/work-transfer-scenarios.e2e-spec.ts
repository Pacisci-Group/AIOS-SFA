import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { AgencyPermission, DataScope } from '@sfa/shared';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { RenewalMaterializationService } from '../src/common/renewal/renewal-materialization.service';
import { CrmAssignmentService } from '../src/crm-rotations/crm-assignment.service';
import { CrmRotation } from '../src/crm-rotations/schemas/crm-rotation.schema';
import { Onboarding } from '../src/crm/schemas/onboarding.schema';
import { RenewalCycle } from '../src/crm/schemas/renewal-cycle.schema';
import { RenewalScanState } from '../src/crm/schemas/renewal-scan-state.schema';
import { ServiceTicket } from '../src/crm/schemas/service-ticket.schema';
import { DealAuditItem } from '../src/deal-audit-items/schemas/deal-audit-item.schema';
import { DealAudit } from '../src/deal-audits/schemas/deal-audit.schema';
import { Deal } from '../src/deals/schemas/deal.schema';
import { Household } from '../src/households/schemas/household.schema';
import { Lead } from '../src/leads/schemas/lead.schema';
import { RoleAssignmentsService } from '../src/permissions/role-assignments.service';
import { Policy } from '../src/policies/schemas/policy.schema';
import { ProducerAssignment } from '../src/producer-assignments/schemas/producer-assignment.schema';
import { AgencyRole } from '../src/roles/schemas/agency-role.schema';
import { ShareLink } from '../src/share-links/schemas/share-link.schema';
import { User } from '../src/users/schemas/user.schema';
import { WorkTransfer } from '../src/users/schemas/work-transfer.schema';
import { authHeader, login } from './helpers/auth.helper';
import {
  closeTestApp,
  createTestApp,
  dropTestDatabase,
} from './helpers/test-app';
import {
  seedTestData,
  TEST_PASSWORD,
  TestSeedContext,
} from './helpers/seed-test-data';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * PAC-136 — the business flows, end to end, through the real APIs.
 *
 * `work-transfer.e2e-spec.ts` proves each *field* moves. This proves the
 * reason those fields matter: that the system's own next step — the next
 * onboarding call, the renewal tickets, the round-robin on the next sale, a
 * lead arriving through a public link — lands on the successor, and that the
 * successor can actually see and act on what they were handed.
 *
 * Two pairs throughout: the seeded CSR hands to a second CSR (tickets,
 * onboardings, renewals, rotation), the seeded producer to a second producer
 * (leads, share links, audits). Both successors are own-scoped, which is what
 * makes the visibility checks meaningful.
 */
describe('Work transfer scenarios (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestSeedContext;
  let ownerToken: string;

  let csrId: string;
  let csrToken: string;
  let csr2Id: string;
  let csr2Token: string;
  let producerId: string;
  let producerToken: string;
  let producer2Id: string;
  let producer2Token: string;

  let users: Model<User>;
  let tickets: Model<ServiceTicket>;
  let onboardings: Model<Onboarding>;
  let cycles: Model<RenewalCycle>;
  let scanState: Model<RenewalScanState>;
  let households: Model<Household>;
  let policies: Model<Policy>;
  let deals: Model<Deal>;
  let leads: Model<Lead>;
  let audits: Model<DealAudit>;
  let auditItems: Model<DealAuditItem>;
  let shareLinks: Model<ShareLink>;
  let rotations: Model<CrmRotation>;
  let producerAssignments: Model<ProducerAssignment>;
  let transfers: Model<WorkTransfer>;
  let roles: Model<AgencyRole>;
  let roleAssignments: RoleAssignmentsService;
  let crmAssignment: CrmAssignmentService;
  let renewals: RenewalMaterializationService;

  let seq = 0;
  const api = () => request(app.getHttpServer());
  const oid = (id: string) => new Types.ObjectId(id);
  const tenant = () => ({ agencyId: ctx.agencyId, branchId: ctx.branchId });
  const ticketTenant = () => ({
    agencyId: oid(ctx.agencyId),
    branchId: oid(ctx.branchId),
  });

  const transfer = (from: string, to: string, token = ownerToken) =>
    api()
      .post(`/api/v1/users/${from}/work-transfer`)
      .set(authHeader(token))
      .send({ toUserId: to });
  const remove = (userId: string, successorId?: string) =>
    api()
      .delete(`/api/v1/users/${userId}`)
      .set(authHeader(ownerToken))
      .send(successorId ? { successorId } : {});

  async function createUser(
    roleId: string,
    first: string,
    last: string,
    extra: Partial<User> = {},
  ) {
    const user = await users.create({
      agencyId: oid(ctx.agencyId),
      branchId: oid(ctx.branchId),
      email: `${first}.${last}.${++seq}@sfa.local`.toLowerCase(),
      passwordHash: await bcrypt.hash(TEST_PASSWORD, 4),
      firstName: first,
      lastName: last,
      isActive: true,
      ...extra,
    });
    await roleAssignments.setUserRoles(
      { userId: user._id.toString(), isPlatformAdmin: true },
      ctx.agencyId,
      user._id,
      [oid(roleId)],
    );
    return user;
  }

  async function seedTicket(assignee: string, status = 'open') {
    const row = await tickets.create({
      ...ticketTenant(),
      ticketNumber: `TKT-SC-${++seq}`,
      clientName: 'Scenario Client',
      category: 'Billing',
      priority: 'medium',
      status,
      assignedUserId: oid(assignee),
      assignedRep: 'Someone',
    });
    return row._id.toString();
  }

  beforeAll(async () => {
    app = await createTestApp();
    await dropTestDatabase(app);
    const model = <T>(name: string) => app.get<Model<T>>(getModelToken(name));
    users = model(User.name);
    tickets = model(ServiceTicket.name);
    onboardings = model(Onboarding.name);
    cycles = model(RenewalCycle.name);
    scanState = model(RenewalScanState.name);
    households = model(Household.name);
    policies = model(Policy.name);
    deals = model(Deal.name);
    leads = model(Lead.name);
    audits = model(DealAudit.name);
    auditItems = model(DealAuditItem.name);
    shareLinks = model(ShareLink.name);
    rotations = model(CrmRotation.name);
    producerAssignments = model(ProducerAssignment.name);
    transfers = model(WorkTransfer.name);
    roles = model(AgencyRole.name);
    roleAssignments = app.get(RoleAssignmentsService);
    crmAssignment = app.get(CrmAssignmentService);
    renewals = app.get(RenewalMaterializationService);

    ctx = await seedTestData(app);
    ownerToken = (await login(app, ctx.ownerEmail, TEST_PASSWORD)).accessToken;

    csrId = ctx.csrUserId;
    csrToken = (await login(app, ctx.csrEmail, TEST_PASSWORD)).accessToken;
    const producer = await users.findOne({ email: ctx.producerEmail }).lean();
    producerId = producer!._id.toString();
    producerToken = (await login(app, ctx.producerEmail, TEST_PASSWORD))
      .accessToken;

    const csr2 = await createUser(ctx.csrRoleId, 'Second', 'Csr');
    csr2Id = csr2._id.toString();
    csr2Token = (await login(app, csr2.email, TEST_PASSWORD)).accessToken;
    const producer2 = await createUser(
      ctx.producerRoleId,
      'Second',
      'Producer',
    );
    producer2Id = producer2._id.toString();
    producer2Token = (await login(app, producer2.email, TEST_PASSWORD))
      .accessToken;
  });

  afterAll(async () => {
    await dropTestDatabase(app);
    await closeTestApp(app);
  });

  beforeEach(async () => {
    await users.updateMany(
      { _id: { $in: [csrId, csr2Id, producerId, producer2Id].map(oid) } },
      { $set: { isActive: true, deactivatedAt: null } },
    );
    await Promise.all(
      [
        tickets,
        onboardings,
        cycles,
        scanState,
        deals,
        leads,
        audits,
        auditItems,
        shareLinks,
        rotations,
        producerAssignments,
        transfers,
      ].map((m) => (m as Model<unknown>).deleteMany({})),
    );
    await households.updateMany({}, { $unset: { assignedCrmId: 1 } });
    await households.deleteMany({ name: /^Scenario/ });
    await policies.deleteMany({ policyNumber: /^SC-/ });
  });

  // ─── The "next call" ────────────────────────────────────────────────────────

  describe('onboarding chain', () => {
    interface TicketBody {
      id: string;
      assignedUserId: string | null;
      assignedRep: string;
      onboarding: { onboardingId: string } | null;
    }
    interface ChainBody {
      chain: { stepKey: string; ticketId: string | null }[];
    }

    async function startOnboarding(token: string) {
      const res = await api()
        .post('/api/v1/crm/service-tickets')
        .set(authHeader(token))
        .send({ category: 'Onboarding', householdId: ctx.householdId })
        .expect(201);
      const body = res.body as TicketBody;
      return {
        welcomeId: body.id,
        onboardingId: body.onboarding!.onboardingId,
      };
    }
    async function nextTicket(onboardingId: string, stepKey: string) {
      const chain = await api()
        .get(`/api/v1/crm/service-tickets/onboardings/${onboardingId}`)
        .set(authHeader(ownerToken))
        .expect(200);
      const link = (chain.body as ChainBody).chain.find(
        (s) => s.stepKey === stepKey,
      );
      expect(link?.ticketId).toBeTruthy();
      return tickets.findById(link!.ticketId).lean();
    }

    /**
     * The scenario the product owner described: the CSR did the welcome
     * call and left; the 3-day and 30-day calls are still to come. They must
     * be created for the successor, who must be able to make them.
     */
    it('creates the next call for the successor, who can complete it themselves', async () => {
      const { welcomeId, onboardingId } = await startOnboarding(csrToken);
      expect(
        (
          await onboardings.findById(onboardingId).lean()
        )?.assignedCsrId?.toString(),
      ).toBe(csrId);

      await transfer(csrId, csr2Id).expect(201);

      // The welcome call itself moved, so the successor — own-scoped — can
      // complete it.
      await api()
        .post(
          `/api/v1/crm/service-tickets/${welcomeId}/onboarding/steps/welcome_call/complete`,
        )
        .set(authHeader(csr2Token))
        .expect(201);

      const threeDay = await nextTicket(onboardingId, 'checkin_3day');
      expect(threeDay?.assignedUserId?.toString()).toBe(csr2Id);
      expect(threeDay?.assignedRep).toBe('Second Csr');
      // Who started the onboarding is history and stays on the new ticket.
      expect(threeDay?.createdByUserId?.toString()).toBe(csrId);
    });

    it('creates the next call unassigned after a release, never as "System"', async () => {
      const { welcomeId, onboardingId } = await startOnboarding(csrToken);

      await remove(csrId).expect(200);

      await api()
        .post(
          `/api/v1/crm/service-tickets/${welcomeId}/onboarding/steps/welcome_call/complete`,
        )
        .set(authHeader(ownerToken))
        .expect(201);

      const threeDay = await nextTicket(onboardingId, 'checkin_3day');
      expect(threeDay?.assignedUserId).toBeNull();
      expect(threeDay?.assignedRep).toBe('');
    });

    it('is handed over mid-chain: a completed call stays credited, the next goes to the successor', async () => {
      const { welcomeId, onboardingId } = await startOnboarding(csrToken);
      await api()
        .post(
          `/api/v1/crm/service-tickets/${welcomeId}/onboarding/steps/welcome_call/complete`,
        )
        .set(authHeader(csrToken))
        .expect(201);
      const threeDay = await nextTicket(onboardingId, 'checkin_3day');

      await transfer(csrId, csr2Id).expect(201);

      const welcome = await tickets.findById(welcomeId).lean();
      // Resolved: left with the person who did it.
      expect(welcome?.assignedUserId?.toString()).toBe(csrId);
      expect(welcome?.onboarding?.completedBy?.toString()).toBe(csrId);
      const moved = await tickets.findById(threeDay!._id).lean();
      expect(moved?.assignedUserId?.toString()).toBe(csr2Id);

      // A scheduled call cannot be completed before it opens; bring the 3-day
      // call forward, as `api.e2e-spec` does for the same step.
      await tickets.updateOne(
        { _id: threeDay!._id },
        { $set: { 'onboarding.availableAt': new Date(Date.now() - 60_000) } },
      );

      await api()
        .post(
          `/api/v1/crm/service-tickets/${threeDay!._id.toString()}/onboarding/steps/checkin_3day/complete`,
        )
        .set(authHeader(csr2Token))
        .expect(201);
      const thirtyDay = await nextTicket(onboardingId, 'checkin_30day');
      expect(thirtyDay?.assignedUserId?.toString()).toBe(csr2Id);
    });
  });

  // ─── Renewals ───────────────────────────────────────────────────────────────

  describe('renewals', () => {
    async function seedBook(crmId: string | null, inDays = 60) {
      const renewalDate = new Date(Date.now() + inDays * DAY_MS);
      const household = await households.create({
        ...tenant(),
        name: `Scenario Renewal ${++seq}`,
        ...(crmId ? { assignedCrmId: oid(crmId) } : {}),
      } as unknown as Household);
      await policies.create({
        ...tenant(),
        policyNumber: `SC-${seq}`,
        policyType: 'Auto',
        carrier: 'Pacific Standard',
        active: true,
        policyStatus: 'Active',
        premium: 1200,
        items: 1,
        effectiveDate: new Date(renewalDate.getTime() - 365 * DAY_MS),
        expirationDate: renewalDate,
        renewalDate,
        householdId: household._id,
      } as unknown as Policy);
      return household;
    }
    const materialize = async () => {
      await scanState.deleteMany({});
      await renewals.materializeForAgency(oid(ctx.agencyId));
    };
    const renewalTickets = (householdId: Types.ObjectId) =>
      tickets.find({ householdId, category: 'Renewal Review' }).lean();

    it("a new cycle after the transfer takes the household's new CSR", async () => {
      const household = await seedBook(csrId);

      await transfer(csrId, csr2Id).expect(201);
      await materialize();

      const cycle = await cycles.findOne({ householdId: household._id }).lean();
      expect(cycle?.assignedCsrId?.toString()).toBe(csr2Id);
      const opened = await renewalTickets(household._id);
      expect(opened.length).toBeGreaterThan(0);
      for (const ticket of opened) {
        expect(ticket.assignedUserId?.toString()).toBe(csr2Id);
        expect(ticket.assignedRep).toBe('Second Csr');
      }
    });

    it('a cycle already in progress mints its remaining calls for the successor', async () => {
      const household = await seedBook(csrId);
      await materialize();
      const cycle = await cycles.findOne({ householdId: household._id }).lean();
      expect(cycle?.assignedCsrId?.toString()).toBe(csrId);
      // Simulate a call not yet opened: drop the tickets the scan created.
      await tickets.deleteMany({ householdId: household._id });

      await transfer(csrId, csr2Id).expect(201);
      await materialize();

      const reopened = await renewalTickets(household._id);
      expect(reopened.length).toBeGreaterThan(0);
      for (const ticket of reopened) {
        expect(ticket.assignedUserId?.toString()).toBe(csr2Id);
      }
    });

    it('after a release, renewal calls open unassigned', async () => {
      const household = await seedBook(csrId);
      await materialize();
      await tickets.deleteMany({ householdId: household._id });

      await remove(csrId).expect(200);
      await materialize();

      const reopened = await renewalTickets(household._id);
      expect(reopened.length).toBeGreaterThan(0);
      for (const ticket of reopened) {
        expect(ticket.assignedUserId).toBeNull();
        expect(ticket.assignedRep).toBe('');
      }
    });
  });

  // ─── The next sale ──────────────────────────────────────────────────────────

  describe('CRM assignment on the next sale', () => {
    async function sell(householdId: Types.ObjectId) {
      const deal = await deals.create({
        ...tenant(),
        producerId: oid(producerId),
        householdId,
      });
      await crmAssignment.assignForDeal({
        agencyId: ctx.agencyId,
        branchId: ctx.branchId,
        dealId: deal._id,
        householdId,
        producerId: oid(producerId),
      });
      return deals.findById(deal._id).lean();
    }
    const household = (name: string) =>
      households.create({ ...tenant(), name: `Scenario ${name}` });

    it("a household's future sales go to the new CSR", async () => {
      const hh = await household('Continuity');
      await households.updateOne(
        { _id: hh._id },
        { $set: { assignedCrmId: oid(csrId) } },
      );

      await transfer(csrId, csr2Id).expect(201);

      const deal = await sell(hh._id);
      expect(deal?.assignedCrmId?.toString()).toBe(csr2Id);
    });

    const slot = (crmId: string, order: number, active = true) =>
      rotations.create({
        ...tenant(),
        producerId: oid(producerId),
        crmId: oid(crmId),
        activeForProducer: active,
        order,
      });
    async function dealOut(n: number) {
      const tally = new Map<string, number>();
      for (let i = 0; i < n; i++) {
        const hh = await household(`Pool ${i}`);
        const deal = await sell(hh._id);
        const key = deal?.assignedCrmId?.toString() ?? 'nobody';
        tally.set(key, (tally.get(key) ?? 0) + 1);
      }
      return tally;
    }

    it('the successor takes the departing CSR’s place in the round-robin', async () => {
      const third = await createUser(ctx.csrRoleId, 'Third', 'Csr');
      await slot(csrId, 0);
      await slot(third._id.toString(), 1);

      await transfer(csrId, csr2Id).expect(201);

      const tally = await dealOut(4);
      expect(tally.get(csr2Id)).toBe(2);
      expect(tally.get(third._id.toString())).toBe(2);
      expect(tally.get(csrId)).toBeUndefined();
    });

    it('never doubles the successor’s share when they were already in the pool', async () => {
      const third = await createUser(ctx.csrRoleId, 'Third', 'Csr');
      await slot(csr2Id, 0);
      await slot(csrId, 1);
      await slot(third._id.toString(), 2);

      await transfer(csrId, csr2Id).expect(201);

      // Pool is [csr2, third] — not [csr2, csr2, third].
      const tally = await dealOut(4);
      expect(tally.get(csr2Id)).toBe(2);
      expect(tally.get(third._id.toString())).toBe(2);
    });

    it('after a release the pool simply skips them', async () => {
      const third = await createUser(ctx.csrRoleId, 'Third', 'Csr');
      await slot(csrId, 0);
      await slot(third._id.toString(), 1);

      await remove(csrId).expect(200);

      const tally = await dealOut(2);
      expect(tally.get(third._id.toString())).toBe(2);
      expect(tally.get(csrId)).toBeUndefined();
    });
  });

  // ─── Share links ────────────────────────────────────────────────────────────

  describe('share links', () => {
    const submission = () => ({
      primaryContact: {
        firstName: 'Robin',
        lastName: `Link${++seq}`,
        dateOfBirth: '1985-03-21',
        phone: '(555) 777-8888',
        email: `robin.link${seq}@example.com`,
      },
      address: {
        street: `${seq} Link Street`,
        city: 'Tulsa',
        state: 'OK',
        zip: '74110',
      },
      members: [],
    });
    async function createLink() {
      const res = await api()
        .post('/api/v1/leads/share-links')
        .set(authHeader(producerToken))
        .send({})
        .expect(201);
      return res.body as { id: string; token: string };
    }

    it('a lead submitted after the transfer goes to the successor', async () => {
      const link = await createLink();

      await transfer(producerId, producer2Id).expect(201);

      const body = submission();
      await api()
        .post(`/api/v1/public/leads/${link.token}`)
        .send(body)
        .expect(201);
      const lead = await leads
        .findOne({ lastName: body.primaryContact.lastName })
        .lean();
      expect(lead?.producerId?.toString()).toBe(producer2Id);
      expect((await shareLinks.findById(link.id).lean())?.submissionCount).toBe(
        1,
      );
      // The successor sees it in their own list; the original creator still
      // sees the link as theirs to revoke.
      const mine = await api()
        .get('/api/v1/leads/share-links')
        .set(authHeader(producer2Token))
        .expect(200);
      expect(
        (mine.body as { items: { id: string }[] }).items.map((l) => l.id),
      ).toContain(link.id);
    });

    it('a dead link comes back to life once the departed producer’s work is handed over', async () => {
      const link = await createLink();

      await remove(producerId).expect(200);
      // Inactive producer: the public form fails closed.
      await api().get(`/api/v1/public/lead-form/${link.token}`).expect(404);

      await transfer(producerId, producer2Id).expect(201);
      await api().get(`/api/v1/public/lead-form/${link.token}`).expect(200);
      const body = submission();
      await api()
        .post(`/api/v1/public/leads/${link.token}`)
        .send(body)
        .expect(201);
      expect(
        (
          await leads.findOne({ lastName: body.primaryContact.lastName }).lean()
        )?.producerId?.toString(),
      ).toBe(producer2Id);
    });
  });

  // ─── What the successor can see and do ──────────────────────────────────────

  describe('visibility', () => {
    const ticketIds = async (token: string) =>
      (
        (
          await api()
            .get('/api/v1/crm/service-tickets?scope=own')
            .set(authHeader(token))
            .expect(200)
        ).body as { items: { id: string }[] }
      ).items.map((t) => t.id);
    const leadIds = async (token: string) =>
      (
        (await api().get('/api/v1/leads').set(authHeader(token)).expect(200))
          .body as { items: { id: string }[] }
      ).items.map((l) => l.id);
    const auditDealIds = async (token: string) =>
      (
        (
          await api()
            .get('/api/v1/deal-audits')
            .set(authHeader(token))
            .expect(200)
        ).body as { items: { dealId: string }[] }
      ).items.map((a) => a.dealId);

    it('a transferred ticket leaves the old queue and appears in the new one', async () => {
      const id = await seedTicket(csrId);
      expect(await ticketIds(csrToken)).toContain(id);
      expect(await ticketIds(csr2Token)).not.toContain(id);

      await transfer(csrId, csr2Id).expect(201);

      expect(await ticketIds(csr2Token)).toContain(id);
      expect(await ticketIds(csrToken)).not.toContain(id);

      const detail = await api()
        .get(`/api/v1/crm/service-tickets/${id}`)
        .set(authHeader(csr2Token))
        .expect(200);
      const timeline = (
        detail.body as { timeline: { type: string; content: string }[] }
      ).timeline;
      expect(timeline).toContainEqual(
        expect.objectContaining({
          type: 'system',
          content: 'Reassigned from Test Csr to Second Csr.',
        }),
      );
    });

    it('a transferred lead moves between the producers’ lists', async () => {
      const lead = await leads.create({
        ...tenant(),
        status: 'New',
        firstName: 'Moving',
        lastName: 'Lead',
        producerId: oid(producerId),
      });
      const id = lead._id.toString();
      expect(await leadIds(producerToken)).toContain(id);
      expect(await leadIds(producer2Token)).not.toContain(id);

      await transfer(producerId, producer2Id).expect(201);

      expect(await leadIds(producer2Token)).toContain(id);
      expect(await leadIds(producerToken)).not.toContain(id);
    });

    it('a transferred audit moves to the successor’s hand-off board', async () => {
      const deal = await deals.create({
        ...tenant(),
        producerId: oid(producerId),
      });
      await audits.create({
        ...tenant(),
        dealId: deal._id,
        auditStatus: 'Fail',
        openFailedCount: 1,
        auditAssignee: { type: 'user', id: oid(producerId) },
      });
      await auditItems.create({
        ...tenant(),
        dealId: deal._id,
        title: 'Signed application',
        producerId: oid(producerId),
        isFailed: true,
        isResolved: false,
      });
      const dealId = deal._id.toString();
      expect(await auditDealIds(producerToken)).toContain(dealId);
      expect(await auditDealIds(producer2Token)).not.toContain(dealId);

      await transfer(producerId, producer2Id).expect(201);

      expect(await auditDealIds(producer2Token)).toContain(dealId);
      expect(await auditDealIds(producerToken)).not.toContain(dealId);
    });
  });

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  describe('lifecycle', () => {
    it('preview matches what the transfer then does, and a second transfer finds nothing', async () => {
      await seedTicket(csrId);
      await seedTicket(csrId);
      await seedTicket(csrId, 'closed');
      await households.updateOne(
        { _id: oid(ctx.householdId) },
        { $set: { assignedCrmId: oid(csrId) } },
      );
      await rotations.create({
        ...tenant(),
        producerId: oid(producerId),
        crmId: oid(csrId),
        activeForProducer: true,
      });

      const preview = (
        await api()
          .get(`/api/v1/users/${csrId}/work-transfer/preview`)
          .query({ toUserId: csr2Id })
          .set(authHeader(ownerToken))
          .expect(200)
      ).body as Record<string, number>;
      expect(preview).toMatchObject({
        tickets: 2,
        households: 1,
        rotationsTakenOver: 1,
      });

      const first = (await transfer(csrId, csr2Id).expect(201)).body as Record<
        string,
        unknown
      >;
      for (const [key, value] of Object.entries(preview)) {
        expect(first[key]).toBe(value);
      }

      const second = (await transfer(csrId, csr2Id).expect(201)).body as Record<
        string,
        unknown
      >;
      for (const key of Object.keys(preview)) {
        expect(second[key]).toBe(0);
      }
      expect(await transfers.countDocuments({})).toBe(2);
    });

    it('reactivating the departed person does not pull the work back', async () => {
      const id = await seedTicket(csrId);
      await remove(csrId, csr2Id).expect(200);

      await api()
        .post(`/api/v1/users/${csrId}/reactivate`)
        .set(authHeader(ownerToken))
        .expect(201);

      expect((await users.findById(csrId).lean())?.isActive).toBe(true);
      expect(
        (await tickets.findById(id).lean())?.assignedUserId?.toString(),
      ).toBe(csr2Id);
    });

    it('two simultaneous transfers of the same person leave every record moved exactly once', async () => {
      const ids = await Promise.all(
        [1, 2, 3, 4, 5].map(() => seedTicket(csrId)),
      );

      const results = await Promise.all([
        transfer(csrId, csr2Id),
        transfer(csrId, csr2Id),
      ]);
      for (const res of results) expect(res.status).toBe(201);

      for (const id of ids) {
        const row = await tickets.findById(id).lean();
        expect(row?.assignedUserId?.toString()).toBe(csr2Id);
        expect(
          row?.timeline.filter((e) => e.content.startsWith('Reassigned from')),
        ).toHaveLength(1);
      }
    });

    it('moves a migrated lead with no status, and leaves a lost one', async () => {
      const noStatus = await leads.create({
        ...tenant(),
        firstName: 'No',
        lastName: 'Status',
        producerId: oid(producerId),
      });
      const lost = await leads.create({
        ...tenant(),
        status: 'Lost',
        producerId: oid(producerId),
      });

      await transfer(producerId, producer2Id).expect(201);

      expect(
        (await leads.findById(noStatus._id).lean())?.producerId?.toString(),
      ).toBe(producer2Id);
      expect(
        (await leads.findById(lost._id).lean())?.producerId?.toString(),
      ).toBe(producerId);
    });
  });

  // ─── Who may, and to whom ───────────────────────────────────────────────────

  describe('permissions and roles', () => {
    it('a user manager without the transfer permission cannot name a successor, but can still remove', async () => {
      const role = await roles.create({
        agencyId: oid(ctx.agencyId),
        name: 'User manager',
        slug: `user_manager_${++seq}`,
        dataScope: DataScope.Agency,
        isSystemTemplate: false,
      });
      await roleAssignments.setRolePermissions(ctx.agencyId, role._id, [
        AgencyPermission.UsersWrite,
        AgencyPermission.UsersRead,
      ]);
      const manager = await createUser(role._id.toString(), 'User', 'Manager');
      const token = (await login(app, manager.email, TEST_PASSWORD))
        .accessToken;
      await seedTicket(csrId);

      await api()
        .delete(`/api/v1/users/${csrId}`)
        .set(authHeader(token))
        .send({ successorId: csr2Id })
        .expect(403);
      expect((await users.findById(csrId).lean())?.isActive).toBe(true);

      const res = await api()
        .delete(`/api/v1/users/${csrId}`)
        .set(authHeader(token))
        .expect(200);
      expect(
        (res.body as { ticketsUnassigned: number }).ticketsUnassigned,
      ).toBe(1);
    });

    /**
     * The owner grants the permission through the roles screen; nothing else
     * (no restart, no manual cache drop) should be needed for it to work.
     */
    it('works as soon as the permission is granted through the roles API', async () => {
      await api()
        .patch(`/api/v1/roles/${ctx.editableRoleId}`)
        .set(authHeader(ownerToken))
        .send({
          adminPermissions: [
            AgencyPermission.WorkTransfer,
            AgencyPermission.UsersRead,
          ],
        })
        .expect(200);
      await api()
        .patch(`/api/v1/users/${ctx.readOnlyUserId}/roles`)
        .set(authHeader(ownerToken))
        .send({ roleIds: [ctx.editableRoleId] })
        .expect(200);
      const token = (await login(app, ctx.readOnlyEmail, TEST_PASSWORD))
        .accessToken;

      await seedTicket(csrId);
      await transfer(csrId, csr2Id, token).expect(201);
    });

    it('refuses a successor whose invite was never accepted', async () => {
      const invited = await createUser(ctx.csrRoleId, 'Invited', 'Csr', {
        isActive: false,
      });
      await transfer(csrId, invited._id.toString()).expect(409);
    });

    it('a person holding two roles can hand over to someone holding either', async () => {
      const both = await createUser(ctx.producerRoleId, 'Both', 'Roles');
      await roleAssignments.setUserRoles(
        { userId: both._id.toString(), isPlatformAdmin: true },
        ctx.agencyId,
        both._id,
        [oid(ctx.producerRoleId), oid(ctx.csrRoleId)],
      );
      const candidates = (
        await api()
          .get(`/api/v1/users/${both._id.toString()}/work-transfer/candidates`)
          .set(authHeader(ownerToken))
          .expect(200)
      ).body as { _id: string }[];
      const ids = candidates.map((c) => c._id);
      expect(ids).toContain(csr2Id);
      expect(ids).toContain(producer2Id);
      await transfer(both._id.toString(), csr2Id).expect(201);
    });

    it('a person with no role can hand over to anyone active', async () => {
      const roleless = await users.create({
        agencyId: oid(ctx.agencyId),
        branchId: oid(ctx.branchId),
        email: `roleless.${++seq}@sfa.local`,
        passwordHash: await bcrypt.hash(TEST_PASSWORD, 4),
        firstName: 'No',
        lastName: 'Role',
        isActive: true,
      });
      const id = await seedTicket(roleless._id.toString());
      await transfer(roleless._id.toString(), producer2Id).expect(201);
      expect(
        (await tickets.findById(id).lean())?.assignedUserId?.toString(),
      ).toBe(producer2Id);
    });
  });
});
