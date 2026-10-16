import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { AgencyPermission, DataScope } from '@sfa/shared';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Activity } from '../src/activities/schemas/activity.schema';
import { Branch } from '../src/branches/schemas/branch.schema';
import { AccessResolverService } from '../src/permissions/access-resolver.service';
import { CrmRotation } from '../src/crm-rotations/schemas/crm-rotation.schema';
import { Onboarding } from '../src/crm/schemas/onboarding.schema';
import { RenewalCycle } from '../src/crm/schemas/renewal-cycle.schema';
import { ServiceTicket } from '../src/crm/schemas/service-ticket.schema';
import { DealAuditItem } from '../src/deal-audit-items/schemas/deal-audit-item.schema';
import { DealAudit } from '../src/deal-audits/schemas/deal-audit.schema';
import { Deal } from '../src/deals/schemas/deal.schema';
import { Household } from '../src/households/schemas/household.schema';
import { Lead } from '../src/leads/schemas/lead.schema';
import { RoleAssignmentsService } from '../src/permissions/role-assignments.service';
import { AgencyRole } from '../src/roles/schemas/agency-role.schema';
import {
  addDays,
  toIsoDate,
  toYmd,
  zonedDate,
} from '../src/performance/performance.range';
import { ShareLink } from '../src/share-links/schemas/share-link.schema';
import { User } from '../src/users/schemas/user.schema';
import { WorkTransfer } from '../src/users/schemas/work-transfer.schema';
import { WorkTransferService } from '../src/users/work-transfer.service';
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

/**
 * PAC-136 / PAC-137 — handing a departing person's open work to a colleague.
 *
 * The seeded producer (`from`) hands to a second producer (`to`) throughout:
 * work only goes to someone holding the same role, and the producer role is
 * own-scoped, which is what makes the audit-resolution case meaningful.
 */
const SUCCESSOR_EMAIL = 'second-producer@sfa.local';

describe('Work transfer (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestSeedContext;
  let ownerToken: string;
  let fromId: string;
  let toId: string;

  let users: Model<User>;
  let tickets: Model<ServiceTicket>;
  let onboardings: Model<Onboarding>;
  let cycles: Model<RenewalCycle>;
  let households: Model<Household>;
  let deals: Model<Deal>;
  let leads: Model<Lead>;
  let audits: Model<DealAudit>;
  let auditItems: Model<DealAuditItem>;
  let shareLinks: Model<ShareLink>;
  let rotations: Model<CrmRotation>;
  let activities: Model<Activity>;
  let transfers: Model<WorkTransfer>;
  let branches: Model<Branch>;
  let roles: Model<AgencyRole>;
  let roleAssignments: RoleAssignmentsService;
  let accessResolver: AccessResolverService;

  const api = () => request(app.getHttpServer());
  const oid = (id: string) => new Types.ObjectId(id);
  const tenant = () => ({ agencyId: ctx.agencyId, branchId: ctx.branchId });
  const ticketTenant = () => ({
    agencyId: oid(ctx.agencyId),
    branchId: oid(ctx.branchId),
  });

  const transfer = (token = ownerToken, from = fromId, to = toId) =>
    api()
      .post(`/api/v1/users/${from}/work-transfer`)
      .set(authHeader(token))
      .send({ toUserId: to });

  beforeAll(async () => {
    app = await createTestApp();
    const model = <T>(name: string) => app.get<Model<T>>(getModelToken(name));
    users = model(User.name);
    tickets = model(ServiceTicket.name);
    onboardings = model(Onboarding.name);
    cycles = model(RenewalCycle.name);
    households = model(Household.name);
    deals = model(Deal.name);
    leads = model(Lead.name);
    audits = model(DealAudit.name);
    auditItems = model(DealAuditItem.name);
    shareLinks = model(ShareLink.name);
    rotations = model(CrmRotation.name);
    activities = model(Activity.name);
    transfers = model(WorkTransfer.name);
    branches = model(Branch.name);
    roles = model(AgencyRole.name);
    roleAssignments = app.get(RoleAssignmentsService);
    accessResolver = app.get(AccessResolverService);

    // Drop BEFORE seeding — suites share one database and jest reorders them,
    // so a suite that ran earlier may have left its fixtures behind.
    await dropTestDatabase(app);
    ctx = await seedTestData(app);
    ownerToken = (await login(app, ctx.ownerEmail, TEST_PASSWORD)).accessToken;
    const producer = await users.findOne({ email: ctx.producerEmail }).lean();
    fromId = producer!._id.toString();
    const second = await users.create({
      agencyId: oid(ctx.agencyId),
      branchId: oid(ctx.branchId),
      email: SUCCESSOR_EMAIL,
      passwordHash: await bcrypt.hash(TEST_PASSWORD, 4),
      firstName: 'Second',
      lastName: 'Producer',
      isActive: true,
    });
    toId = second._id.toString();
    await roleAssignments.setUserRoles(
      { userId: toId, isPlatformAdmin: true },
      ctx.agencyId,
      second._id,
      [ctx.producerRoleId],
    );
  });

  afterAll(async () => {
    await dropTestDatabase(app);
    await closeTestApp(app);
  });

  beforeEach(async () => {
    await users.updateMany(
      { _id: { $in: [oid(fromId), oid(toId)] } },
      { $set: { isActive: true, deactivatedAt: null } },
    );
    await Promise.all(
      [
        tickets,
        onboardings,
        cycles,
        deals,
        leads,
        audits,
        auditItems,
        shareLinks,
        rotations,
        transfers,
      ].map((m) => (m as Model<unknown>).deleteMany({})),
    );
    await households.updateMany({}, { $unset: { assignedCrmId: 1 } });
  });

  let seq = 0;
  async function seedTicket(status: string) {
    const row = await tickets.create({
      ...ticketTenant(),
      ticketNumber: `TKT-WT-${++seq}`,
      clientName: 'Test Client',
      category: 'Billing',
      priority: 'medium',
      status,
      assignedUserId: oid(fromId),
      assignedRep: 'Test Producer',
      createdByUserId: oid(fromId),
      createdByName: 'Test Producer',
    });
    return row._id;
  }

  describe('what moves', () => {
    it('moves open tickets with the rep name and a timeline note, and leaves closed ones', async () => {
      const open = await seedTicket('open');
      const resolved = await seedTicket('resolved');
      const closed = await seedTicket('closed');

      const res = await transfer().expect(201);
      expect((res.body as { tickets: number }).tickets).toBe(1);

      const moved = await tickets.findById(open).lean();
      expect(moved?.assignedUserId?.toString()).toBe(toId);
      expect(moved?.assignedRep).toBe('Second Producer');
      expect(moved?.timeline.at(-1)?.content).toBe(
        'Reassigned from Test Producer to Second Producer.',
      );
      // Attribution on the moved ticket stays put.
      expect(moved?.createdByUserId?.toString()).toBe(fromId);

      for (const id of [resolved, closed]) {
        const row = await tickets.findById(id).lean();
        expect(row?.assignedUserId?.toString()).toBe(fromId);
      }
    });

    /**
     * The "next call" case the product owner described: the CSR onboarded a
     * sale and left, and the 3-day and 30-day calls are still to come. Those
     * tickets are minted from `onboarding.assignedCsrId` and
     * `renewalCycle.assignedCsrId`, so those are what must move.
     */
    it('moves the seeds of future tickets: in-progress onboardings and renewal cycles', async () => {
      const base = { ...ticketTenant(), clientName: 'Test Client' };
      const live = await onboardings.create({
        ...base,
        householdId: oid(ctx.householdId),
        startedAt: new Date(),
        assignedCsrId: oid(fromId),
      });
      const done = await onboardings.create({
        ...base,
        householdId: oid(ctx.householdId),
        startedAt: new Date(),
        completedAt: new Date(),
        currentStepKey: null,
        assignedCsrId: oid(fromId),
      });
      const cycleBase = {
        agencyId: oid(ctx.agencyId),
        renewalDate: new Date(),
        track: 'annual' as const,
        assignedCsrId: oid(fromId),
      };
      const liveCycle = await cycles.create({
        ...cycleBase,
        groupKey: 'g1',
        termKey: 't1',
      });
      const doneCycle = await cycles.create({
        ...cycleBase,
        groupKey: 'g2',
        termKey: 't2',
        completedAt: new Date(),
      });

      const res = await transfer().expect(201);
      expect(res.body).toMatchObject({ onboardings: 1, renewalCycles: 1 });

      expect(
        (
          await onboardings.findById(live._id).lean()
        )?.assignedCsrId?.toString(),
      ).toBe(toId);
      expect(
        (
          await onboardings.findById(done._id).lean()
        )?.assignedCsrId?.toString(),
      ).toBe(fromId);
      expect(
        (
          await cycles.findById(liveCycle._id).lean()
        )?.assignedCsrId?.toString(),
      ).toBe(toId);
      expect(
        (
          await cycles.findById(doneCycle._id).lean()
        )?.assignedCsrId?.toString(),
      ).toBe(fromId);
    });

    it('moves the household CSR and its deal mirror, but never deal attribution', async () => {
      await households.updateOne(
        { _id: oid(ctx.householdId) },
        { $set: { assignedCrmId: oid(fromId) } },
      );
      const deal = await deals.create({
        ...tenant(),
        producerId: oid(fromId),
        assignedCrmId: oid(fromId),
      });

      const res = await transfer().expect(201);
      expect(res.body).toMatchObject({ households: 1, deals: 1 });

      const household = await households.findById(ctx.householdId).lean();
      expect(household?.assignedCrmId?.toString()).toBe(toId);
      const row = await deals.findById(deal._id).lean();
      expect(row?.assignedCrmId?.toString()).toBe(toId);
      // Who sold it is history — the leaderboard reads this.
      expect(row?.producerId?.toString()).toBe(fromId);
    });

    it('moves open leads with a lead_reassigned activity, and leaves terminal ones', async () => {
      const open = await leads.create({
        ...tenant(),
        status: 'New',
        producerId: oid(fromId),
      });
      const sold = await leads.create({
        ...tenant(),
        status: 'Sold',
        producerId: oid(fromId),
      });

      const res = await transfer().expect(201);
      expect((res.body as { leads: number }).leads).toBe(1);

      expect(
        (await leads.findById(open._id).lean())?.producerId?.toString(),
      ).toBe(toId);
      expect(
        (await leads.findById(sold._id).lean())?.producerId?.toString(),
      ).toBe(fromId);

      const activity = await activities
        .findOne({ leadId: open._id, type: 'lead_reassigned' })
        .lean();
      expect(activity?.summary).toBe(
        'Lead reassigned from Test Producer to Second Producer',
      );
    });

    it('repoints live share links so public URLs keep working', async () => {
      const live = await shareLinks.create({
        ...tenant(),
        token: `tok-live-${++seq}`,
        producerId: oid(fromId),
        createdById: oid(fromId),
      });
      const revoked = await shareLinks.create({
        ...tenant(),
        token: `tok-revoked-${++seq}`,
        producerId: oid(fromId),
        createdById: oid(fromId),
        isActive: false,
      });

      await transfer().expect(201);

      const row = await shareLinks.findById(live._id).lean();
      expect(row?.producerId.toString()).toBe(toId);
      expect(row?.createdById.toString()).toBe(fromId);
      expect(
        (await shareLinks.findById(revoked._id).lean())?.producerId.toString(),
      ).toBe(fromId);
    });

    describe('rotation', () => {
      const producerA = new Types.ObjectId();
      const producerB = new Types.ObjectId();

      it('takes over a slot where the successor has none, and switches off a duplicate', async () => {
        // Successor already rotates for producer A.
        await rotations.create({
          ...tenant(),
          producerId: producerA,
          crmId: oid(toId),
          activeForProducer: true,
        });
        const dupe = await rotations.create({
          ...tenant(),
          producerId: producerA,
          crmId: oid(fromId),
          activeForProducer: true,
        });
        const fresh = await rotations.create({
          ...tenant(),
          producerId: producerB,
          crmId: oid(fromId),
          activeForProducer: true,
        });

        const res = await transfer().expect(201);
        expect(res.body).toMatchObject({
          rotationsTakenOver: 1,
          rotationsDeactivated: 1,
        });

        const off = await rotations.findById(dupe._id).lean();
        expect(off?.activeForProducer).toBe(false);
        const taken = await rotations.findById(fresh._id).lean();
        expect(taken?.crmId?.toString()).toBe(toId);
        expect(taken?.activeForProducer).toBe(true);

        // Exactly one active slot per pool — never doubled.
        for (const producerId of [producerA, producerB]) {
          expect(
            await rotations.countDocuments({
              producerId,
              crmId: oid(toId),
              activeForProducer: true,
            }),
          ).toBe(1);
        }
      });

      it('never doubles a pool when the departing person held two slots in it', async () => {
        for (let i = 0; i < 2; i++) {
          await rotations.create({
            ...tenant(),
            producerId: producerA,
            crmId: oid(fromId),
            activeForProducer: true,
            order: i,
          });
        }

        await transfer().expect(201);

        expect(
          await rotations.countDocuments({
            producerId: producerA,
            crmId: oid(toId),
            activeForProducer: true,
          }),
        ).toBe(1);
      });
    });

    it('records what it touched', async () => {
      const open = await seedTicket('open');

      await transfer().expect(201);

      const record = await transfers
        .findOne({ fromUserId: oid(fromId) })
        .lean();
      expect(record?.toUserId.toString()).toBe(toId);
      expect(record?.touched.serviceTickets.map(String)).toEqual([
        open.toString(),
      ]);
    });

    it('preview counts without changing anything', async () => {
      const open = await seedTicket('open');

      const res = await api()
        .get(`/api/v1/users/${fromId}/work-transfer/preview`)
        .query({ toUserId: toId })
        .set(authHeader(ownerToken))
        .expect(200);
      expect((res.body as { tickets: number }).tickets).toBe(1);

      const row = await tickets.findById(open).lean();
      expect(row?.assignedUserId?.toString()).toBe(fromId);
    });
  });

  describe('deal audits', () => {
    /** A real sale by the departing producer, with one open failed item. */
    async function seedAudit(
      assignee: { type: 'user' | 'role'; id: Types.ObjectId } | null = {
        type: 'user',
        id: oid(fromId),
      },
    ) {
      const deal = await deals.create({ ...tenant(), producerId: oid(fromId) });
      const audit = await audits.create({
        ...tenant(),
        dealId: deal._id,
        auditStatus: 'Fail',
        openFailedCount: 1,
        auditAssignee: assignee,
        auditReviewer: assignee,
      });
      const item = await auditItems.create({
        ...tenant(),
        dealId: deal._id,
        dealAuditId: audit._id,
        title: 'Signed application',
        producerId: oid(fromId),
        producerName: 'Test Producer',
        isFailed: true,
        isResolved: false,
      });
      return { deal, audit, item };
    }

    /**
     * Product owner, 2026-10-05: once a producer has left, every outstanding
     * audit responsibility is the successor's — the card, the reviewer seat and
     * each open checklist item. The sale itself stays credited to the seller.
     */
    it('hands the audit and its open items to the successor, who can resolve them', async () => {
      const { deal, audit, item } = await seedAudit();
      const done = await auditItems.create({
        ...tenant(),
        dealId: deal._id,
        dealAuditId: audit._id,
        title: 'Already cleared',
        producerId: oid(fromId),
        isFailed: true,
        isResolved: true,
      });
      const passed = await audits.create({
        ...tenant(),
        dealId: new Types.ObjectId(),
        auditStatus: 'Pass',
        openFailedCount: 0,
        auditAssignee: { type: 'user', id: oid(fromId) },
      });
      const successorToken = (await login(app, SUCCESSOR_EMAIL, TEST_PASSWORD))
        .accessToken;

      await api()
        .patch(`/api/v1/deal-audits/${item._id.toString()}/resolve`)
        .set(authHeader(successorToken))
        .send({})
        .expect(403);

      const res = await transfer().expect(201);
      expect(res.body).toMatchObject({ audits: 1, auditItems: 1 });

      const moved = await audits.findById(audit._id).lean();
      expect(moved?.auditAssignee?.id.toString()).toBe(toId);
      expect(moved?.auditReviewer?.id.toString()).toBe(toId);

      const open = await auditItems.findById(item._id).lean();
      expect(open?.producerId?.toString()).toBe(toId);
      expect(open?.producerName).toBe('Second Producer');

      // History stays: a cleared item, a passed audit, and the sale itself.
      expect(
        (await auditItems.findById(done._id).lean())?.producerId?.toString(),
      ).toBe(fromId);
      expect(
        (
          await audits.findById(passed._id).lean()
        )?.auditAssignee?.id.toString(),
      ).toBe(fromId);
      expect(
        (await deals.findById(deal._id).lean())?.producerId?.toString(),
      ).toBe(fromId);

      await api()
        .patch(`/api/v1/deal-audits/${item._id.toString()}/resolve`)
        .set(authHeader(successorToken))
        .send({})
        .expect(200);
      expect((await auditItems.findById(item._id).lean())?.isResolved).toBe(
        true,
      );
    });

    it('claims an open audit on their sale that nobody was assigned to', async () => {
      const { audit } = await seedAudit(null);

      const res = await transfer().expect(201);
      expect(res.body).toMatchObject({ audits: 1, auditItems: 1 });

      const row = await audits.findById(audit._id).lean();
      expect(row?.auditAssignee).toMatchObject({ type: 'user' });
      expect(row?.auditAssignee?.id.toString()).toBe(toId);
    });

    it('leaves a role-owned audit with its role', async () => {
      const { audit } = await seedAudit({ type: 'role', id: oid(fromId) });

      await transfer().expect(201);

      const row = await audits.findById(audit._id).lean();
      expect(row?.auditAssignee).toMatchObject({ type: 'role' });
      expect(row?.auditAssignee?.id.toString()).toBe(fromId);
    });

    /**
     * The Manager dashboard counts open audit items against whoever is
     * responsible, not whoever sold the deal — otherwise the departed
     * producer's row keeps the backlog and the successor's never shows it.
     */
    it('moves the backlog on the Manager dashboard to the successor', async () => {
      await seedAudit();
      const drawer = async (id: string) =>
        (
          await api()
            .get(`/api/v1/management-dashboard/producers/${id}`)
            .set(authHeader(ownerToken))
            .expect(200)
        ).body as {
          stats: { openAuditItems: number };
          openAuditItems: unknown[];
        };

      expect((await drawer(fromId)).stats.openAuditItems).toBe(1);
      expect((await drawer(toId)).stats.openAuditItems).toBe(0);

      await transfer().expect(201);

      const before = await drawer(fromId);
      const after = await drawer(toId);
      expect(before.stats.openAuditItems).toBe(0);
      expect(before.openAuditItems).toHaveLength(0);
      expect(after.stats.openAuditItems).toBe(1);
      expect(after.openAuditItems).toHaveLength(1);
    });
  });

  describe('Manager dashboard', () => {
    const TIME_ZONE = 'America/Chicago';
    const now = new Date();
    const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);
    /** A sale old enough to be past the five-business-day audit SLA. */
    async function seedAgingSale() {
      const sold = daysAgo(30);
      const deal = await deals.create({
        ...tenant(),
        producerId: oid(fromId),
        clientName: 'Aging Client',
        soldDate: sold,
        soldDateYmd: toYmd(zonedDate(sold, TIME_ZONE)),
      });
      const audit = await audits.create({
        ...tenant(),
        dealId: deal._id,
        auditStatus: 'Fail',
        openFailedCount: 1,
        auditAssignee: { type: 'user', id: oid(fromId) },
      });
      await auditItems.create({
        ...tenant(),
        dealId: deal._id,
        dealAuditId: audit._id,
        title: 'Signed application',
        producerId: oid(fromId),
        isFailed: true,
        isResolved: false,
      });
      return { deal, audit };
    }

    const window = () => {
      const today = zonedDate(now, TIME_ZONE);
      return `range=custom&from=${toIsoDate(addDays(today, -60))}&to=${toIsoDate(today)}`;
    };
    const aging = async (producerId: string) =>
      (
        await api()
          .get(
            `/api/v1/management-dashboard/alerts/aging-audits?${window()}&producerIds=${producerId}`,
          )
          .set(authHeader(ownerToken))
          .expect(200)
      ).body as {
        total: number;
        items: {
          dealId: string;
          producerName: string;
          assigneeName: string | null;
        }[];
      };

    /**
     * The aging alert filters by the person responsible, like the team table
     * and drawer — otherwise filtering by the successor shows their backlog
     * in one place and none of it in the other.
     */
    it('lists a transferred aging audit under the successor, still naming the seller', async () => {
      const { deal } = await seedAgingSale();
      expect((await aging(fromId)).total).toBe(1);
      expect((await aging(toId)).total).toBe(0);

      await transfer().expect(201);

      expect((await aging(fromId)).total).toBe(0);
      const mine = await aging(toId);
      expect(mine.total).toBe(1);
      expect(mine.items[0]).toMatchObject({
        dealId: deal._id.toString(),
        producerName: 'Test Producer',
        assigneeName: 'Second Producer',
      });
    });

    /**
     * A deal can carry two audit rows (a legacy re-audit). Joining items to
     * their audit by deal listed every item once per row.
     */
    it('lists each open item once when a deal carries two audit rows', async () => {
      const { deal } = await seedAgingSale();
      await audits.create({
        ...tenant(),
        dealId: deal._id,
        auditStatus: 'Pass',
        openFailedCount: 0,
        auditAssignee: { type: 'user', id: oid(fromId) },
      });

      const body = (
        await api()
          .get(`/api/v1/management-dashboard/producers/${fromId}`)
          .set(authHeader(ownerToken))
          .expect(200)
      ).body as {
        stats: { openAuditItems: number };
        openAuditItems: unknown[];
      };
      expect(body.stats.openAuditItems).toBe(1);
      expect(body.openAuditItems).toHaveLength(1);
    });

    /**
     * Role-owned audits are nobody's personal backlog, but they get their own
     * line under the team totals rather than disappearing (product owner,
     * 2026-10-05).
     */
    it('shows role-owned open items on their own line, outside every row and the total', async () => {
      const queue = new Types.ObjectId();
      const deal = await deals.create({ ...tenant(), producerId: oid(fromId) });
      await audits.create({
        ...tenant(),
        dealId: deal._id,
        auditStatus: 'Fail',
        openFailedCount: 2,
        auditAssignee: { type: 'role', id: queue },
      });

      const body = (
        await api()
          .get('/api/v1/management-dashboard/team')
          .set(authHeader(ownerToken))
          .expect(200)
      ).body as {
        rows: { producerId: string; openAuditItems: number }[];
        totals: { openAuditItems: number };
        roleAssignedOpenAuditItems: number;
      };
      expect(body.roleAssignedOpenAuditItems).toBe(2);
      expect(body.totals.openAuditItems).toBe(
        body.rows.reduce((sum, row) => sum + row.openAuditItems, 0),
      );
      expect(
        body.rows.find((row) => row.producerId === fromId)?.openAuditItems ?? 0,
      ).toBe(0);
    });
  });

  describe('removal with a successor (PAC-137)', () => {
    it('hands the work over instead of releasing it', async () => {
      const open = await seedTicket('open');

      const res = await api()
        .delete(`/api/v1/users/${fromId}`)
        .set(authHeader(ownerToken))
        .send({ successorId: toId })
        .expect(200);
      expect(res.body).toMatchObject({ tickets: 1, toUserId: toId });

      expect((await users.findById(fromId).lean())?.isActive).toBe(false);
      const row = await tickets.findById(open).lean();
      expect(row?.assignedUserId?.toString()).toBe(toId);
    });

    it('still releases to the queue without one', async () => {
      const open = await seedTicket('open');

      const res = await api()
        .delete(`/api/v1/users/${fromId}`)
        .set(authHeader(ownerToken))
        .expect(200);
      expect(
        (res.body as { ticketsUnassigned: number }).ticketsUnassigned,
      ).toBe(1);
      expect((await tickets.findById(open).lean())?.assignedUserId).toBeNull();
    });

    it('refuses a bad successor before removing anyone', async () => {
      await users.updateOne({ _id: oid(toId) }, { $set: { isActive: false } });

      await api()
        .delete(`/api/v1/users/${fromId}`)
        .set(authHeader(ownerToken))
        .send({ successorId: toId })
        .expect(409);

      expect((await users.findById(fromId).lean())?.isActive).toBe(true);
    });

    /**
     * The work moves *before* the account is deactivated. The other order
     * left a failed transfer with the person removed, their work stranded,
     * and a retry answering 409 "already removed".
     */
    it('leaves the person active when the transfer itself fails, so a retry works', async () => {
      const service = app.get(WorkTransferService);
      const spy = jest
        .spyOn(service, 'transfer')
        .mockRejectedValueOnce(new Error('transaction aborted'));
      const open = await seedTicket('open');

      await api()
        .delete(`/api/v1/users/${fromId}`)
        .set(authHeader(ownerToken))
        .send({ successorId: toId })
        .expect(500);
      expect((await users.findById(fromId).lean())?.isActive).toBe(true);

      spy.mockRestore();
      await api()
        .delete(`/api/v1/users/${fromId}`)
        .set(authHeader(ownerToken))
        .send({ successorId: toId })
        .expect(200);
      expect((await users.findById(fromId).lean())?.isActive).toBe(false);
      expect(
        (await tickets.findById(open).lean())?.assignedUserId?.toString(),
      ).toBe(toId);
    });

    it('accepts an already-removed source', async () => {
      await users.updateOne(
        { _id: oid(fromId) },
        { $set: { isActive: false, deactivatedAt: new Date() } },
      );
      const open = await seedTicket('open');

      await transfer().expect(201);

      const row = await tickets.findById(open).lean();
      expect(row?.assignedUserId?.toString()).toBe(toId);
    });
  });

  describe('guards', () => {
    it('refuses a deactivated successor', async () => {
      await users.updateOne({ _id: oid(toId) }, { $set: { isActive: false } });
      await transfer().expect(409);
    });

    /**
     * A producer's book goes to a producer, a CSR's to a CSR — enforced by the
     * transfer, not only by the picker.
     */
    it('refuses a successor who does not share a role', async () => {
      const res = await transfer(ownerToken, fromId, ctx.csrUserId).expect(409);
      expect((res.body as { message: string }).message).toContain('same role');
    });

    it('offers only same-role colleagues as candidates', async () => {
      const res = await api()
        .get(`/api/v1/users/${fromId}/work-transfer/candidates`)
        .set(authHeader(ownerToken))
        .expect(200);
      const ids = (res.body as { _id: string }[]).map((u) => u._id);
      expect(ids).toContain(toId);
      expect(ids).not.toContain(ctx.csrUserId);
      expect(ids).not.toContain(fromId);
    });

    it('refuses a transfer to the same person', async () => {
      await transfer(ownerToken, fromId, fromId).expect(400);
    });

    it('refuses someone outside the agency', async () => {
      await transfer(ownerToken, fromId, ctx.otherAgencyUserId).expect(404);
    });

    it('is forbidden without the permission', async () => {
      const csrToken = (await login(app, ctx.csrEmail, TEST_PASSWORD))
        .accessToken;
      await transfer(csrToken, toId, fromId).expect(403);
    });

    describe('branches', () => {
      /** A producer (same role as `from`) in a branch of our choosing. */
      async function producerIn(branchId: Types.ObjectId | null) {
        const user = await users.create({
          agencyId: oid(ctx.agencyId),
          ...(branchId ? { branchId } : {}),
          email: `branch-test-${++seq}@sfa.local`,
          passwordHash: await bcrypt.hash(TEST_PASSWORD, 4),
          isActive: true,
        });
        await roleAssignments.setUserRoles(
          { userId: user._id.toString(), isPlatformAdmin: true },
          ctx.agencyId,
          user._id,
          [ctx.producerRoleId],
        );
        return user._id.toString();
      }
      async function otherBranch() {
        const branch = await branches.create({
          agencyId: oid(ctx.agencyId),
          name: `Elsewhere ${++seq}`,
          slug: `elsewhere-${seq}`,
        });
        return branch._id;
      }
      const candidates = async () =>
        (
          (
            await api()
              .get(`/api/v1/users/${fromId}/work-transfer/candidates`)
              .set(authHeader(ownerToken))
              .expect(200)
          ).body as { _id: string }[]
        ).map((u) => u._id);

      /**
       * No cross-branch transfers (product owner, 2026-10-05): the records
       * keep their branch, so a successor elsewhere would be working clients
       * outside their own branch.
       */
      it('refuses a successor in another branch, and never offers one', async () => {
        const elsewhere = await producerIn(await otherBranch());
        const res = await transfer(ownerToken, fromId, elsewhere).expect(409);
        expect((res.body as { message: string }).message).toContain(
          'different branch',
        );
        expect(await candidates()).not.toContain(elsewhere);
      });

      it('lets someone with no branch receive work, and offers them', async () => {
        const unbranched = await producerIn(null);
        expect(await candidates()).toContain(unbranched);
        await seedTicket('open');
        await transfer(ownerToken, fromId, unbranched).expect(201);
      });
    });

    describe('delegated to a non-owner', () => {
      async function delegate(dataScope: DataScope) {
        const role = await roles.create({
          agencyId: oid(ctx.agencyId),
          name: `Transfer delegate ${dataScope}`,
          slug: `transfer_delegate_${dataScope}`,
          dataScope,
          isSystemTemplate: false,
        });
        await roleAssignments.setRolePermissions(ctx.agencyId, role._id, [
          AgencyPermission.WorkTransfer,
          AgencyPermission.UsersRead,
        ]);
        await roleAssignments.setUserRoles(
          { userId: ctx.readOnlyUserId, isPlatformAdmin: true },
          ctx.agencyId,
          oid(ctx.readOnlyUserId),
          [role._id],
        );
        await accessResolver.invalidateUser(ctx.readOnlyUserId);
        return (await login(app, ctx.readOnlyEmail, TEST_PASSWORD)).accessToken;
      }

      it('works for an agency-wide role the permission is granted to', async () => {
        const token = await delegate(DataScope.Agency);
        await seedTicket('open');
        await transfer(token).expect(201);
      });

      /**
       * Product owner, 2026-10-05: handing over a book is an agency decision.
       * The permission stays per role, but only an agency-wide role can use it
       * — even between two people in the holder's own branch.
       */
      it.each([DataScope.Branch, DataScope.Own])(
        'refuses a %s-scoped holder, even within their own branch',
        async (scope) => {
          const token = await delegate(scope);
          await transfer(token).expect(403);
          await api()
            .get(`/api/v1/users/${fromId}/work-transfer/candidates`)
            .set(authHeader(token))
            .expect(403);
        },
      );
    });
  });
});
