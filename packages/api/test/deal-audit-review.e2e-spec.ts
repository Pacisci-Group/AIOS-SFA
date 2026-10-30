import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import type {
  DealAuditQueueResponse,
  DealAuditQueueRow,
  DealAuditReviewView,
  SetAuditItemVerdictResponse,
} from '@sfa/shared';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AuditGenerationService } from '../src/audit-generation/audit-generation.service';
import { AuditTemplate } from '../src/audit-templates/schemas/audit-template.schema';
import {
  addBusinessDays,
  businessDaysBetween,
} from '../src/common/dates/business-days';
import { Contact } from '../src/contacts/schemas/contact.schema';
import { DealAuditItem } from '../src/deal-audit-items/schemas/deal-audit-item.schema';
import type {
  DealAuditDealRow,
  DealAuditListResponse,
} from '../src/deal-audits/deal-audits.types';
import { reconcileDealAudits } from '../src/deal-audits/audit-reconcile';
import { DealAudit } from '../src/deal-audits/schemas/deal-audit.schema';
import {
  Deal,
  DealAuditTriggers,
  emptyAuditTriggers,
} from '../src/deals/schemas/deal.schema';
import { Household } from '../src/households/schemas/household.schema';
import { InngestService } from '../src/inngest/inngest.service';
import { Lead } from '../src/leads/schemas/lead.schema';
import {
  toIsoDate,
  zonedDate,
  zonedDayStart,
} from '../src/performance/performance.range';
import { RoleAssignmentsService } from '../src/permissions/role-assignments.service';
import { Policy } from '../src/policies/schemas/policy.schema';
import { QuoteRecap } from '../src/quote-recaps/schemas/quote-recap.schema';
import { AgencyRole } from '../src/roles/schemas/agency-role.schema';
import { seedAuditTemplates } from '../src/seed/audit-templates.seed';
import { StorageService } from '../src/storage/storage.service';
import { User } from '../src/users/schemas/user.schema';
import { authHeader, login } from './helpers/auth.helper';
import { FakeStorage } from './helpers/fake-storage';
import {
  TEST_PASSWORD,
  TestSeedContext,
  seedTestData,
} from './helpers/seed-test-data';
import {
  CapturedInngestService,
  closeTestApp,
  createTestApp,
  dropTestDatabase,
} from './helpers/test-app';

/**
 * The manager's side of the deal audit (PAC-106): the Deal Audits queue, the
 * Deal Audit page, the item-by-item ruling and the send-back loop.
 *
 * Sales are booked straight through the models and handed to
 * `AuditGenerationService`, as the Sold form does after it writes the deal —
 * the form itself is `api.e2e-spec.ts`'s to cover. The production catalog
 * (`CORE_AUDIT_TEMPLATES`) is seeded, so which items are manager-only is the
 * real split rather than a fixture's: a plain Auto sale carries only
 * manager-only items, and a Good Student discount adds the one item the
 * producer must document.
 *
 * Personas: `M` the branch manager (created here — the shared seed has none),
 * `O` the owner (agency-scoped, also a reviewer), `P` the producer, `C` the
 * CSR.
 *
 * ⚠ e2e suites share one database — never run two at once.
 */
describe('Deal Audits review (PAC-106) (e2e)', () => {
  const BOARD = '/api/v1/deal-audits';
  const TIME_ZONE = 'America/Chicago';

  let app: INestApplication<App>;
  let seed: TestSeedContext;
  let storage: FakeStorage;
  let inngest: CapturedInngestService;

  let ownerToken: string;
  let managerToken: string;
  let producerToken: string;
  let csrToken: string;
  let producerId: string;
  let managerId: string;
  let otherBranchId: string;

  let dealModel: Model<Deal>;
  let auditModel: Model<DealAudit>;
  let itemModel: Model<DealAuditItem>;
  let policyModel: Model<Policy>;

  const now = new Date();
  const today = zonedDate(now, TIME_ZONE);
  /** Noon on the agency's calendar day `n` business days back. */
  const soldBusinessDaysAgo = (n: number) =>
    new Date(
      zonedDayStart(addBusinessDays(today, -n), TIME_ZONE).getTime() +
        12 * 3_600_000,
    );

  let counter = 0;

  /**
   * A booked sale with its generated audit.
   *
   * A unique client name per call: the queue is branch-wide and every test
   * here books sales, so rows are found by deal id, never by position.
   */
  const sale = async (
    options: {
      triggers?: Partial<DealAuditTriggers>;
      soldDate?: Date;
      branchId?: string;
      /** Who sold it; the seeded producer unless named. */
      sellerId?: string;
      fields?: Record<string, unknown>;
    } = {},
  ) => {
    const branchId = options.branchId ?? seed.branchId;
    const seller = new Types.ObjectId(options.sellerId ?? producerId);
    const clientName = `Review ${(counter += 1).toString().padStart(3, '0')}`;
    const deal = await dealModel.create({
      agencyId: seed.agencyId,
      branchId,
      clientName,
      producerId: seller,
      soldDate: options.soldDate ?? soldBusinessDaysAgo(1),
      policyTypes: ['Auto'],
      dealType: 'Auto',
      auditTriggers: { ...emptyAuditTriggers(), ...options.triggers },
      ...options.fields,
    });
    await app.get(AuditGenerationService).generateForDeal({
      agencyId: seed.agencyId,
      branchId,
      dealId: deal._id,
      producerId: seller,
      clientName,
    });
    return deal._id.toString();
  };
  /** A sale with one producer item: the Good Student transcript. */
  const studentSale = (options: Parameters<typeof sale>[0] = {}) =>
    sale({ ...options, triggers: { goodStudent: true } });

  const auditOf = (dealId: string) =>
    auditModel
      .findOne({ dealId: new Types.ObjectId(dealId) })
      .sort({ createdAt: -1 });
  const itemsOf = (dealId: string) =>
    itemModel.find({ dealId: new Types.ObjectId(dealId) }).sort({ _id: 1 });
  const itemNamed = async (dealId: string, name: string) =>
    (await itemsOf(dealId)).find((item) => item.itemName === name)!;

  const queue = async (query = '', token = managerToken) => {
    const res = await request(app.getHttpServer())
      .get(`${BOARD}/queue?pageSize=100&${query}`)
      .set(authHeader(token))
      .expect(200);
    return res.body as DealAuditQueueResponse;
  };
  const queueRow = async (
    dealId: string,
    query = 'status=all',
    token = managerToken,
  ): Promise<DealAuditQueueRow | undefined> =>
    (await queue(query, token)).items.find((row) => row.dealId === dealId);

  const reviewView = async (dealId: string, token = managerToken) => {
    const res = await request(app.getHttpServer())
      .get(`${BOARD}/deals/${dealId}/review`)
      .set(authHeader(token))
      .expect(200);
    return res.body as DealAuditReviewView;
  };

  /** The producer's hand-off board row for a deal, if it is on the board. */
  const boardRow = async (
    dealId: string,
    token = producerToken,
  ): Promise<DealAuditDealRow | undefined> => {
    const res = await request(app.getHttpServer())
      .get(`${BOARD}?pageSize=50`)
      .set(authHeader(token))
      .expect(200);
    return (res.body as DealAuditListResponse).items.find(
      (row) => row.dealId === dealId,
    );
  };

  const verdict = (
    itemId: string,
    body: Record<string, unknown>,
    token = managerToken,
  ) =>
    request(app.getHttpServer())
      .patch(`${BOARD}/${itemId}/verdict`)
      .set(authHeader(token))
      .send(body);

  /** Rule on every item of a deal, except those named in `except`. */
  const ruleAll = async (
    dealId: string,
    ruling: 'pass' | 'fail',
    except: string[] = [],
  ) => {
    for (const item of await itemsOf(dealId)) {
      if (except.includes(item.itemName ?? '')) continue;
      await verdict(item._id.toString(), { verdict: ruling }).expect(200);
    }
  };

  const review = (
    dealId: string,
    body: Record<string, unknown>,
    token = managerToken,
  ) =>
    request(app.getHttpServer())
      .post(`${BOARD}/deals/${dealId}/review`)
      .set(authHeader(token))
      .send(body);

  const submit = (dealId: string, token = producerToken) =>
    request(app.getHttpServer())
      .post(`${BOARD}/deals/${dealId}/submit`)
      .set(authHeader(token));

  /** Every `audit.sent_back` notification requested since the last clear. */
  const sentBackEvents = () =>
    inngest.sent.filter(
      (event) =>
        event.name === 'notification/requested.v1' &&
        event.data.type === 'audit.sent_back',
    );

  beforeAll(async () => {
    storage = new FakeStorage();
    app = await createTestApp({
      overrides: [{ provide: StorageService, useValue: storage.asService() }],
    });
    // Drop BEFORE seeding — suites share one database and jest reorders them.
    await dropTestDatabase(app);
    seed = await seedTestData(app);
    inngest = app.get(InngestService);

    const model = <T>(name: string) => app.get<Model<T>>(getModelToken(name));
    dealModel = model<Deal>(Deal.name);
    auditModel = model<DealAudit>(DealAudit.name);
    itemModel = model<DealAuditItem>(DealAuditItem.name);
    policyModel = model<Policy>(Policy.name);
    const userModel = model<User>(User.name);
    const roleModel = model<AgencyRole>(AgencyRole.name);

    await seedAuditTemplates(
      model<AuditTemplate>(AuditTemplate.name),
      seed.agencyId,
      seed.branchId,
    );

    const producer = await userModel
      .findOne({ email: seed.producerEmail })
      .select('+passwordHash');
    const owner = await userModel.findOne({ email: seed.ownerEmail });
    producerId = producer!._id.toString();

    const otherBranch = await model<Household>(Household.name)
      .findById(seed.otherBranchHouseholdId)
      .lean<{ branchId: string }>();
    otherBranchId = otherBranch!.branchId;

    // The persona this page is for. The shared seed has no branch manager.
    const agencyId = new Types.ObjectId(seed.agencyId);
    const roles = await roleModel.find({ agencyId }).lean();
    const person = async (
      email: string,
      slug: string,
      extra: Record<string, unknown> = {},
    ) => {
      const user = await userModel.create({
        agencyId,
        branchId: new Types.ObjectId(seed.branchId),
        email,
        passwordHash: (producer as unknown as { passwordHash: string })
          .passwordHash,
        firstName: email.split('@')[0],
        lastName: 'Fixture',
        isActive: true,
        ...extra,
      });
      await app
        .get(RoleAssignmentsService)
        .setUserRoles(
          { userId: owner!._id.toString(), isPlatformAdmin: true },
          agencyId,
          user._id,
          [roles.find((role) => role.slug === slug)!._id],
        );
      return user._id.toString();
    };
    const managerEmail = 'review-manager@sfa.local';
    managerId = await person(managerEmail, 'branch_manager');
    // Holds the producer role but has left — a role assignee's notification
    // must skip them.
    await person('review-former-producer@sfa.local', 'producer', {
      isActive: false,
      deactivatedAt: new Date(),
    });

    ownerToken = (await login(app, seed.ownerEmail, TEST_PASSWORD)).accessToken;
    managerToken = (await login(app, managerEmail, TEST_PASSWORD)).accessToken;
    producerToken = (await login(app, seed.producerEmail, TEST_PASSWORD))
      .accessToken;
    csrToken = (await login(app, seed.csrEmail, TEST_PASSWORD)).accessToken;
  });

  afterAll(async () => {
    if (app) {
      await dropTestDatabase(app);
      await closeTestApp(app);
    }
  });

  describe('handing the audit over', () => {
    it('submits a sale with nothing for the producer straight to the manager', async () => {
      const dealId = await sale();

      const audit = await auditOf(dealId);
      expect(audit!.auditStatus).toBe('Pending');
      // No person submitted it — which is also why no one is barred from
      // reviewing it as "their own submission".
      expect(audit!.submittedById ?? null).toBeNull();
      expect(audit!.submittedAt).toBeInstanceOf(Date);
      expect(audit!.producerItemCount).toBe(0);
      expect((await dealModel.findById(dealId))!.dealAuditStatus).toBe(
        'Pending',
      );

      // Nothing for the producer to do, so not on their board…
      expect(await boardRow(dealId)).toBeUndefined();
      // …and on the manager's queue, ready to review.
      const row = await queueRow(dealId, 'status=pending');
      expect(row).toMatchObject({
        auditStatus: 'Pending',
        canReview: true,
        counts: { passed: 0, failed: 0, remaining: audit!.itemCount },
      });
    });

    it("keeps a sale with producer work on the producer's board, showing only their items", async () => {
      const dealId = await studentSale();

      const audit = await auditOf(dealId);
      expect(audit!.auditStatus).toBe('Not Submitted');
      expect(audit!.producerItemCount).toBe(1);

      const row = await boardRow(dealId);
      expect(row).toMatchObject({
        itemCount: 1,
        openCount: 1,
        readyToSubmit: false,
        sentBack: null,
      });
      expect(row!.items).toHaveLength(1);
      expect(row!.items[0]).toMatchObject({
        missing: 'Good Student',
        requiresUpload: true,
        managerOnly: false,
        review: { verdict: null },
      });

      // The manager sees every item, and can see the audit waiting — but not
      // review it before the producer submits.
      expect(await queueRow(dealId)).toMatchObject({
        auditStatus: 'Not Submitted',
        canReview: false,
      });
      const page = await reviewView(dealId);
      expect(page.items.length).toBe(audit!.itemCount);
      expect(page.items.length).toBeGreaterThan(1);
      expect(
        page.items.find((item) => item.itemName === 'Correct Sold Date'),
      ).toMatchObject({ producerVisible: false, requiresUpload: false });
      expect(page.audit).toMatchObject({
        canReview: false,
        canApprove: false,
        canSendBack: false,
      });
    });

    it('hands a system submission back when a new policy brings producer work', async () => {
      const dealId = await sale();
      expect((await auditOf(dealId))!.auditStatus).toBe('Pending');

      // A policy added later (PAC-104) can bring a Good Student item.
      await dealModel.updateOne(
        { _id: new Types.ObjectId(dealId) },
        { $set: { 'auditTriggers.goodStudent': true } },
      );
      await app.get(AuditGenerationService).generateForDeal({
        agencyId: seed.agencyId,
        branchId: seed.branchId,
        dealId: new Types.ObjectId(dealId),
      });

      const audit = await auditOf(dealId);
      expect(audit!.auditStatus).toBe('Not Submitted');
      expect(audit!.submittedAt).toBeUndefined();
      expect((await dealModel.findById(dealId))!.dealAuditStatus).toBe(
        'Not Submitted',
      );
      expect(
        (await boardRow(dealId))!.items.map((item) => item.missing),
      ).toEqual(['Good Student']);
    });

    it('refuses to resolve a document requirement without the document', async () => {
      const dealId = await studentSale();
      const item = await itemNamed(dealId, 'Good Student');

      await request(app.getHttpServer())
        .patch(`${BOARD}/${item._id.toString()}/resolve`)
        .set(authHeader(producerToken))
        .send({ note: 'They have a 3.8 GPA.' })
        .expect(400);
      expect((await itemNamed(dealId, 'Good Student')).isResolved).toBe(false);
    });
  });

  describe('the queue', () => {
    it('is for managers only', async () => {
      const dealId = await sale();
      const [item] = await itemsOf(dealId);

      for (const token of [producerToken, csrToken]) {
        await request(app.getHttpServer())
          .get(`${BOARD}/queue`)
          .set(authHeader(token))
          .expect(403);
        await request(app.getHttpServer())
          .get(`${BOARD}/deals/${dealId}/review`)
          .set(authHeader(token))
          .expect(403);
        await verdict(item._id.toString(), { verdict: 'pass' }, token).expect(
          403,
        );
        await review(dealId, { decision: 'approve' }, token).expect(403);
      }
      // Nothing was ruled on along the way.
      expect((await itemsOf(dealId))[0].reviewVerdict ?? null).toBeNull();
    });

    it("shows a branch manager their branch and the owner the agency's", async () => {
      const mine = await sale();
      const theirs = await sale({ branchId: otherBranchId });

      expect(await queueRow(mine)).toBeDefined();
      expect(await queueRow(theirs)).toBeUndefined();
      expect(await queueRow(theirs, 'status=all', ownerToken)).toBeDefined();

      await request(app.getHttpServer())
        .get(`${BOARD}/deals/${theirs}/review`)
        .set(authHeader(managerToken))
        .expect(404);
    });

    it('counts days sitting in business days from the sale, oldest first', async () => {
      const fresh = await studentSale({ soldDate: soldBusinessDaysAgo(3) });
      const stale = await studentSale({ soldDate: soldBusinessDaysAgo(8) });

      const { items } = await queue('status=not_submitted');
      const freshRow = items.find((row) => row.dealId === fresh)!;
      const staleRow = items.find((row) => row.dealId === stale)!;

      const expected = (n: number) =>
        businessDaysBetween(addBusinessDays(today, -n), today);
      expect(freshRow.businessDaysOpen).toBe(expected(3));
      expect(freshRow.aging).toBe(false);
      expect(staleRow.businessDaysOpen).toBe(expected(8));
      // Five business days is the SLA (PAC-139 D2).
      expect(staleRow.aging).toBe(true);

      // The longest-waiting deal leads.
      expect(items.indexOf(staleRow)).toBeLessThan(items.indexOf(freshRow));
    });

    it('leaves approved audits out unless asked for', async () => {
      const dealId = await sale();
      await auditModel.updateOne(
        { dealId: new Types.ObjectId(dealId) },
        { $set: { auditStatus: 'Pass' } },
      );

      expect(await queueRow(dealId, '')).toBeUndefined();
      expect(await queueRow(dealId, 'status=pending')).toBeUndefined();
      expect(await queueRow(dealId, 'status=pass')).toMatchObject({
        auditStatus: 'Pass',
        aging: false,
        canReview: false,
      });
    });
  });

  describe('the Deal Audit page', () => {
    let dealId: string;
    let policyId: string;
    let bareDealId: string;
    const NBA_KEY = `agencies/__agency__/sold-deals/nba/2026/application.pdf`;
    const QUOTE_KEY = `agencies/__agency__/quote-recaps/2026/quote.pdf`;

    beforeAll(async () => {
      const model = <T>(name: string) => app.get<Model<T>>(getModelToken(name));
      const scope = { agencyId: seed.agencyId, branchId: seed.branchId };
      const contact = await model<Contact>(Contact.name).create({
        ...scope,
        firstName: 'Paula',
        lastName: 'Page',
        roleInHousehold: 'Named Insured',
        isPrimary: true,
        email: 'paula@example.com',
        phone: '5125550100',
      });
      const household = await model<Household>(Household.name).create({
        ...scope,
        name: 'Page Household',
        primaryContactId: contact._id,
      });
      const lead = await model<Lead>(Lead.name).create({
        ...scope,
        firstName: 'Paula',
        lastName: 'Page',
        status: 'Sold',
        temperature: 'Hot',
        producerId: new Types.ObjectId(producerId),
        householdId: household._id,
        leadSourceId: new Types.ObjectId(seed.leadSourceIds.mailer),
        createdDate: soldBusinessDaysAgo(10),
      });
      // Named by no deal: the page finds it through the lead, as it must for
      // most migrated sales.
      await model<QuoteRecap>(QuoteRecap.name).create({
        ...scope,
        leadId: lead._id,
        householdId: household._id,
        producerId: new Types.ObjectId(producerId),
        quoteDate: soldBusinessDaysAgo(4),
        premium: 1450,
        itemCount: 2,
        productsQuoted: ['Auto'],
        policies: [{ policyType: 'Auto', premium: 1450, itemCount: 2 }],
        notes: 'Two cars, one teen driver.',
        quoteDocument: {
          key: QUOTE_KEY,
          filename: 'quote.pdf',
          contentType: 'application/pdf',
          size: 4096,
        },
      });

      dealId = await studentSale({
        soldDate: soldBusinessDaysAgo(2),
        fields: {
          clientName: 'Paula Page',
          leadId: lead._id,
          householdId: household._id,
          premium: 1450,
        },
      });
      const policy = await policyModel.create({
        ...scope,
        dealId: new Types.ObjectId(dealId),
        householdId: household._id,
        policyNumber: 'RVW-000001',
        policyType: 'Auto',
        carrier: 'Allstate',
        premium: 1450,
        effectiveDate: new Date('2026-10-01T00:00:00.000Z'),
        newBusinessApplication: {
          key: NBA_KEY,
          filename: 'application.pdf',
          contentType: 'application/pdf',
          size: 2048,
        },
      });
      policyId = policy._id.toString();

      // A sale with no lead, no quote and an application never uploaded.
      bareDealId = await sale();
      await policyModel.create({
        ...scope,
        dealId: new Types.ObjectId(bareDealId),
        policyNumber: 'RVW-000002',
        policyType: 'Auto',
      });

      await submit(dealId).expect(201);
    });

    it('brings the sale, its policies, its quote, its lead and every item together', async () => {
      const page = await reviewView(dealId);

      expect(page.deal).toMatchObject({
        id: dealId,
        clientName: 'Paula Page',
        householdName: 'Page Household',
        premium: 1450,
        aging: false,
      });
      expect(page.deal.producerName).toBeTruthy();
      expect(page.policies).toHaveLength(1);
      expect(page.policies[0]).toMatchObject({
        id: policyId,
        policyNumber: 'RVW-000001',
        effectiveDate: '2026-10-01',
        newBusinessApplication: {
          filename: 'application.pdf',
          contentType: 'application/pdf',
          size: 2048,
        },
      });
      expect(page.quoteRecap).toMatchObject({
        premium: 1450,
        itemCount: 2,
        notes: 'Two cars, one teen driver.',
        document: { filename: 'quote.pdf' },
      });
      expect(page.lead).toMatchObject({
        name: 'Paula Page',
        email: 'paula@example.com',
        phone: '5125550100',
      });
      expect(page.lead!.leadSourceName).toBeTruthy();

      // Submitted by the producer, so the manager may rule — and nothing has
      // been ruled on yet.
      const audit = await auditOf(dealId);
      expect(page.items).toHaveLength(audit!.itemCount);
      expect(page.audit).toMatchObject({
        auditStatus: 'Pending',
        canReview: true,
        canApprove: false,
        canSendBack: false,
        counts: { passed: 0, failed: 0, remaining: audit!.itemCount },
      });
      expect(page.audit.unmet).toHaveLength(audit!.itemCount);

      // A storage key is a capability; it never reaches the browser.
      const body = JSON.stringify(page);
      expect(body).not.toContain(NBA_KEY);
      expect(body).not.toContain(QUOTE_KEY);
    });

    it('opens the new business application and the quote document inline', async () => {
      const nba = await request(app.getHttpServer())
        .get(`/api/v1/policies/${policyId}/new-business-application/download`)
        .set(authHeader(managerToken))
        .expect(200);
      expect(nba.body).toMatchObject({
        filename: 'application.pdf',
        contentType: 'application/pdf',
      });
      expect(storage.downloads.at(-1)).toMatchObject({
        key: NBA_KEY,
        disposition: 'inline',
      });

      const quote = await request(app.getHttpServer())
        .get(`${BOARD}/deals/${dealId}/quote-recap/document/download`)
        .set(authHeader(managerToken))
        .expect(200);
      expect(quote.body).toMatchObject({ filename: 'quote.pdf' });
      expect(storage.downloads.at(-1)).toMatchObject({
        key: QUOTE_KEY,
        disposition: 'inline',
      });
    });

    it('404s for a document that was never uploaded', async () => {
      const bare = await policyModel.findOne({
        dealId: new Types.ObjectId(bareDealId),
      });
      await request(app.getHttpServer())
        .get(
          `/api/v1/policies/${bare!._id.toString()}/new-business-application/download`,
        )
        .set(authHeader(managerToken))
        .expect(404);
      await request(app.getHttpServer())
        .get(`${BOARD}/deals/${bareDealId}/quote-recap/document/download`)
        .set(authHeader(managerToken))
        .expect(404);

      const page = await reviewView(bareDealId);
      expect(page.quoteRecap).toBeNull();
      expect(page.lead).toBeNull();
      expect(page.policies[0].newBusinessApplication).toBeNull();
    });
  });

  describe('ruling on items', () => {
    it('only while the audit awaits review', async () => {
      const dealId = await studentSale();
      const item = await itemNamed(dealId, 'Good Student');

      await verdict(item._id.toString(), { verdict: 'pass' }).expect(409);
      expect(
        (await itemNamed(dealId, 'Good Student')).reviewVerdict,
      ).toBeNull();
    });

    it('never on your own submission', async () => {
      const dealId = await studentSale();
      // The owner submits — then may not rule on what they submitted.
      await submit(dealId, ownerToken).expect(201);
      const item = await itemNamed(dealId, 'Good Student');

      await verdict(
        item._id.toString(),
        { verdict: 'pass' },
        ownerToken,
      ).expect(403);
      expect((await reviewView(dealId, ownerToken)).audit.canReview).toBe(
        false,
      );
      // Another manager may.
      await verdict(item._id.toString(), { verdict: 'pass' }).expect(200);
    });

    it('a pass verifies the item; approve waits until every item has one', async () => {
      const dealId = await sale();
      const items = await itemsOf(dealId);
      expect(items.length).toBeGreaterThan(1);

      const blocked = await review(dealId, { decision: 'approve' }).expect(409);
      expect(blocked.body).toMatchObject({ code: 'audit_items_not_passed' });
      expect((blocked.body as { unmet: unknown[] }).unmet).toHaveLength(
        items.length,
      );

      const first = await verdict(items[0]._id.toString(), {
        verdict: 'pass',
        note: 'Matches the application.',
      }).expect(200);
      const ruled = first.body as SetAuditItemVerdictResponse;
      expect(ruled.item).toMatchObject({
        isResolved: true,
        open: false,
        review: { verdict: 'pass', note: 'Matches the application.' },
      });
      expect(ruled.item.review.reviewedByName).toBeTruthy();
      expect(ruled.counts).toEqual({
        passed: 1,
        failed: 0,
        remaining: items.length - 1,
      });
      expect(ruled.canApprove).toBe(false);

      // The manager's verification closes a manager-only item.
      const stored = await itemModel.findById(items[0]._id);
      expect(stored).toMatchObject({
        isResolved: true,
        updateStatus: 'complete',
        reviewVerdict: 'pass',
      });

      // A note alone leaves the ruling as it is.
      const noted = await verdict(items[0]._id.toString(), {
        note: 'Matches the application (page 2).',
      }).expect(200);
      expect(
        (noted.body as SetAuditItemVerdictResponse).item.review,
      ).toMatchObject({
        verdict: 'pass',
        note: 'Matches the application (page 2).',
      });

      // Withdrawing a ruling puts the item back in the remaining pile.
      const cleared = await verdict(items[0]._id.toString(), {
        verdict: null,
      }).expect(200);
      expect((cleared.body as SetAuditItemVerdictResponse).counts.passed).toBe(
        0,
      );

      await ruleAll(dealId, 'pass');
      const page = await reviewView(dealId);
      expect(page.audit).toMatchObject({ canApprove: true, unmet: [] });

      const approved = await review(dealId, {
        decision: 'approve',
        notes: 'All verified.',
      }).expect(201);
      expect((approved.body as { auditStatus: string }).auditStatus).toBe(
        'Pass',
      );
      expect((await dealModel.findById(dealId))!.dealAuditStatus).toBe('Pass');
      expect((await auditOf(dealId))!.openFailedCount).toBe(0);

      /*
       * The sign-off stands (PAC-106 review). A submit on `Pass` used to flip
       * it back to `Pending` on the producer's say-so; the board never offered
       * it, but the API allowed it.
       */
      const resubmitted = await submit(dealId).expect(409);
      expect((resubmitted.body as { message: string }).message).toMatch(
        /approved/,
      );
      expect((await auditOf(dealId))!.auditStatus).toBe('Pass');
      expect((approved.body as { canSubmit: boolean }).canSubmit).toBe(false);

      // Approving twice is a 409 too, not a second write.
      await review(dealId, { decision: 'approve' }).expect(409);
    });

    it('rejects a request with neither a verdict nor a note', async () => {
      const dealId = await sale();
      const [item] = await itemsOf(dealId);
      await verdict(item._id.toString(), {}).expect(400);
      await verdict(item._id.toString(), { verdict: 'maybe' }).expect(400);
    });
  });

  describe('the send-back loop', () => {
    let dealId: string;

    beforeAll(async () => {
      dealId = await studentSale();
      await submit(dealId).expect(201);
    });

    it('needs a failed item and a note', async () => {
      await ruleAll(dealId, 'pass');

      const nothingFailed = await review(dealId, {
        decision: 'request_changes',
        notes: 'Please look again.',
      }).expect(409);
      expect(nothingFailed.body).toMatchObject({
        code: 'audit_nothing_failed',
      });

      const good = await itemNamed(dealId, 'Good Student');
      await verdict(good._id.toString(), {
        verdict: 'fail',
        note: 'The transcript is from 2019.',
      }).expect(200);

      await review(dealId, { decision: 'request_changes' }).expect(400);
      expect((await auditOf(dealId))!.auditStatus).toBe('Pending');
    });

    it("reopens the failed items on the producer's board, red, with the manager's notes", async () => {
      // A manager-only item can fail too — the sale itself is wrong.
      const soldDate = await itemNamed(dealId, 'Correct Sold Date');
      await verdict(soldDate._id.toString(), {
        verdict: 'fail',
        note: 'The client signed on the 14th.',
      }).expect(200);

      inngest.sent.length = 0;
      const sent = await review(dealId, {
        decision: 'request_changes',
        notes: 'Two things to fix.',
      }).expect(201);
      expect((sent.body as { auditStatus: string }).auditStatus).toBe('Fail');
      expect((sent.body as { sentBack: unknown }).sentBack).toMatchObject({
        note: 'Two things to fix.',
        failedItemCount: 2,
      });

      for (const name of ['Good Student', 'Correct Sold Date']) {
        const item = await itemNamed(dealId, name);
        expect(item).toMatchObject({
          isFailed: true,
          isResolved: false,
          reviewVerdict: 'fail',
        });
      }

      const row = await boardRow(dealId);
      expect(row).toMatchObject({
        auditStatus: 'Fail',
        itemCount: 2,
        openCount: 2,
        readyToSubmit: false,
        sentBack: { note: 'Two things to fix.', failedItemCount: 2 },
      });
      expect(row!.sentBack!.byName).toBeTruthy();
      // Only what failed: the manager-only items that passed stay off it.
      expect(row!.items.map((item) => item.missing).sort()).toEqual([
        'Correct Sold Date',
        'Good Student',
      ]);
      expect(
        row!.items.find((item) => item.missing === 'Correct Sold Date'),
      ).toMatchObject({
        managerOnly: true,
        review: { verdict: 'fail', note: 'The client signed on the 14th.' },
      });

      // The notification's link opens this card wherever it sits in the
      // board's paging.
      const one = await request(app.getHttpServer())
        .get(`${BOARD}?dealId=${dealId}`)
        .set(authHeader(producerToken))
        .expect(200);
      expect(
        (one.body as DealAuditListResponse).items.map((item) => item.dealId),
      ).toEqual([dealId]);
      // A deal that is not waiting on the producer is an empty page, not 404.
      const withManager = await sale();
      const none = await request(app.getHttpServer())
        .get(`${BOARD}?dealId=${withManager}`)
        .set(authHeader(producerToken))
        .expect(200);
      expect((none.body as DealAuditListResponse).items).toEqual([]);

      // One notification, to the producer the audit is assigned to.
      const events = sentBackEvents();
      expect(events).toHaveLength(1);
      const audit = await auditOf(dealId);
      expect(events[0].data).toMatchObject({
        recipientIds: [producerId],
        actorId: managerId,
        entity: { kind: 'dealAudit', id: audit!._id.toString() },
        data: { dealId, note: 'Two things to fix.', failedItemCount: 2 },
      });
      expect(events[0].data.dedupeKey).toBe(
        `audit.sent_back:${audit!._id.toString()}:${audit!.sentBack!.at.getTime()}`,
      );

      // The audit is the producer's again: nothing to rule on until resubmit.
      await verdict(soldDate._id.toString(), { verdict: 'pass' }).expect(409);
    });

    it('resubmitting clears the failed rulings and keeps the passed ones', async () => {
      const soldDate = await itemNamed(dealId, 'Correct Sold Date');
      await request(app.getHttpServer())
        .patch(`${BOARD}/${soldDate._id.toString()}/resolve`)
        .set(authHeader(producerToken))
        .send({ note: 'Corrected the sold date to the 14th.' })
        .expect(200);
      expect((await boardRow(dealId))!.openCount).toBe(1);

      const passedBefore = (await itemsOf(dealId)).filter(
        (item) => item.reviewVerdict === 'pass',
      );
      expect(passedBefore.length).toBeGreaterThan(0);

      await submit(dealId).expect(201);

      const audit = await auditOf(dealId);
      expect(audit!.auditStatus).toBe('Pending');
      expect(audit!.sentBack ?? null).toBeNull();

      const items = await itemsOf(dealId);
      for (const name of ['Good Student', 'Correct Sold Date']) {
        const item = items.find((entry) => entry.itemName === name)!;
        expect(item.reviewVerdict).toBeNull();
        expect(item.reviewNote).toBeUndefined();
      }
      expect(items.filter((item) => item.reviewVerdict === 'pass').length).toBe(
        passedBefore.length,
      );

      // With the manager again, so off the producer's board.
      expect(await boardRow(dealId)).toBeUndefined();
      expect(await queueRow(dealId, 'status=pending')).toMatchObject({
        canReview: true,
        sentBack: null,
      });
    });

    it('notifies every active holder of a role the audit is assigned to', async () => {
      const roleDeal = await studentSale();
      await auditModel.updateOne(
        { dealId: new Types.ObjectId(roleDeal) },
        {
          $set: {
            auditAssignee: {
              type: 'role',
              id: new Types.ObjectId(seed.producerRoleId),
            },
          },
        },
      );
      await submit(roleDeal).expect(201);
      const good = await itemNamed(roleDeal, 'Good Student');
      await verdict(good._id.toString(), {
        verdict: 'fail',
        note: 'Missing the transcript.',
      }).expect(200);

      inngest.sent.length = 0;
      await review(roleDeal, {
        decision: 'request_changes',
        notes: 'Missing the transcript.',
      }).expect(201);

      const events = sentBackEvents();
      expect(events).toHaveLength(1);
      // The seeded producer holds the role; the one who left does not count.
      expect(events[0].data.recipientIds).toEqual([producerId]);
    });
  });

  /**
   * Search, filters and sort on the queue (20 Oct 2026).
   *
   * The second seller is the **owner** rather than another producer-role
   * user: the send-back loop above asserts the producer role's recipients
   * exactly, and a second holder would change that answer.
   *
   * Every query says `status=all`, so a deal's audit state never decides
   * whether a filter "found" it — only the filter does.
   */
  describe("the queue's search, filters and sort", () => {
    let ownerId: string;
    const ids: Record<string, string> = {};
    const dealIdsIn = async (query: string) =>
      (await queue(`status=all&${query}`)).items.map((row) => row.dealId);
    const dayBefore = (n: number) => toIsoDate(addBusinessDays(today, -n));

    beforeAll(async () => {
      const owner = await app
        .get<Model<User>>(getModelToken(User.name))
        .findOne({ email: seed.ownerEmail });
      ownerId = owner!._id.toString();

      ids.zeta = await sale({ fields: { clientName: 'Quixote Zeta' } });
      ids.alpha = await sale({ fields: { clientName: 'alpha Search' } });
      ids.bravo = await sale({
        sellerId: ownerId,
        fields: { clientName: 'Bravo Search' },
      });
      ids.hearth = await sale({
        fields: {
          clientName: 'Hearth Search',
          policyTypes: ['Home'],
          dealType: 'Home',
        },
      });
      ids.fresh = await studentSale({
        soldDate: soldBusinessDaysAgo(3),
        fields: { clientName: 'Fresh Search' },
      });
      ids.stale = await studentSale({
        soldDate: soldBusinessDaysAgo(8),
        fields: { clientName: 'Stale Search' },
      });
      ids.approved = await sale({
        soldDate: soldBusinessDaysAgo(9),
        fields: { clientName: 'Approved Search' },
      });
      await auditModel.updateOne(
        { dealId: new Types.ObjectId(ids.approved) },
        { $set: { auditStatus: 'Pass' } },
      );
      ids.today = await sale({
        soldDate: new Date(),
        fields: { clientName: 'Today Search' },
      });

      // The key is what the search reads; nothing computes it on create.
      await policyModel.create({
        agencyId: seed.agencyId,
        branchId: seed.branchId,
        dealId: new Types.ObjectId(ids.zeta),
        policyNumber: 'AS-998877',
        policyNumberKey: 'AS998877',
        policyType: 'Auto',
      });
    });

    it('finds a deal by client name, producer name or policy number', async () => {
      expect(await dealIdsIn('q=zeta')).toEqual([ids.zeta]);

      // A producer's name narrows to that producer's sales.
      const byOwner = await dealIdsIn('q=owner');
      expect(byOwner).toContain(ids.bravo);
      expect(byOwner).not.toContain(ids.zeta);

      // The policy number is read whole — the tokenizer would split it.
      expect(await dealIdsIn('q=as-9988')).toEqual([ids.zeta]);
      expect(await dealIdsIn('q=AS998877')).toEqual([ids.zeta]);
    });

    it('needs every word to match somewhere', async () => {
      expect(await dealIdsIn('q=bravo%20owner')).toEqual([ids.bravo]);
      // Zeta was sold by the producer, not the owner.
      expect(await dealIdsIn('q=zeta%20owner')).toEqual([]);
    });

    it('answers a search that matches nothing with an empty page', async () => {
      const page = await queue('status=all&q=zzz9999');
      expect(page).toMatchObject({ total: 0, items: [] });
      // A cleared box is no search at all.
      expect((await queue('status=all&q=')).total).toBeGreaterThan(0);
    });

    it('filters by producer and by line of business', async () => {
      expect(await dealIdsIn(`producerIds=${ownerId}`)).toEqual([ids.bravo]);

      const home = await dealIdsIn('policyTypes=Home');
      expect(home).toContain(ids.hearth);
      expect(home).not.toContain(ids.zeta);
    });

    it('shows only aging deals, never an approved one', async () => {
      const { items } = await queue('status=all&aging=true');
      const found = items.map((row) => row.dealId);
      expect(found).toContain(ids.stale);
      expect(found).not.toContain(ids.fresh);
      // Older than the stale one, but approved: finished, not aging.
      expect(found).not.toContain(ids.approved);
      expect(items.every((row) => row.aging)).toBe(true);

      // Approved and aging cannot both hold.
      expect((await queue('status=pass&aging=true')).total).toBe(0);
    });

    it('narrows to a sold-date window', async () => {
      const day = dayBefore(8);
      const inWindow = await dealIdsIn(`range=custom&from=${day}&to=${day}`);
      expect(inWindow).toContain(ids.stale);
      expect(inWindow).not.toContain(ids.fresh);

      const todays = await dealIdsIn('range=today');
      expect(todays).toContain(ids.today);
      expect(todays).not.toContain(ids.zeta);
    });

    it('sorts by client, case-insensitively', async () => {
      const { items } = await queue('status=all&q=search&sort=client');
      const names = items.map((row) => row.clientName);
      expect(names).toEqual(
        [...names].sort((a, b) =>
          a.localeCompare(b, undefined, { sensitivity: 'base' }),
        ),
      );
      // A plain code-point sort would put "Bravo" before "alpha".
      expect(names.indexOf('alpha Search')).toBeLessThan(
        names.indexOf('Bravo Search'),
      );
    });

    it('sorts by producer name', async () => {
      const { items } = await queue('status=all&q=search&sort=producer');
      // "Test Owner" before "Test Producer".
      expect(items[0].dealId).toBe(ids.bravo);
      expect(items.slice(1).every((row) => row.producerId === producerId)).toBe(
        true,
      );
    });

    it('sorts by submission, newest first and never-submitted last', async () => {
      await submit(ids.fresh).expect(201);

      const { items } = await queue('status=all&q=search&sort=submitted');
      expect(items[0].dealId).toBe(ids.fresh);
      const stamps = items.map((row) => row.submittedAt);
      const firstNull = stamps.indexOf(null);
      expect(firstNull).toBeGreaterThan(0);
      expect(stamps.slice(firstNull).every((stamp) => stamp === null)).toBe(
        true,
      );
      const submitted = stamps.slice(0, firstNull) as string[];
      expect(submitted).toEqual([...submitted].sort().reverse());
    });

    it('offers the sellers in reach as the producer filter, to managers only', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BOARD}/queue/options`)
        .set(authHeader(managerToken))
        .expect(200);
      const producers = (
        res.body as { producers: Array<{ id: string; name: string }> }
      ).producers;
      expect(producers).toEqual(
        expect.arrayContaining([
          { id: producerId, name: 'Test Producer' },
          { id: ownerId, name: 'Test Owner' },
        ]),
      );

      for (const token of [producerToken, csrToken]) {
        await request(app.getHttpServer())
          .get(`${BOARD}/queue/options`)
          .set(authHeader(token))
          .expect(403);
      }
    });

    it('refuses a malformed filter', async () => {
      for (const query of [
        'sort=bogus',
        'producerIds=nope',
        'range=custom',
        'aging=yes',
      ]) {
        await request(app.getHttpServer())
          .get(`${BOARD}/queue?${query}`)
          .set(authHeader(managerToken))
          .expect(400);
      }
    });
  });

  /*
   * PAC-106 review: the flags are copied onto an item at generation, so a
   * template change used to leave every item already raised on the old one.
   * `reconcileDealAudits` re-stamps them on audits not yet approved.
   *
   * Last on purpose: the reconcile runs over the whole agency.
   */
  describe('re-stamping template flags', () => {
    it('moves open items onto a changed template, and leaves an approved audit alone', async () => {
      const templateModel = app.get<Model<AuditTemplate>>(
        getModelToken(AuditTemplate.name),
      );
      const open = await studentSale();
      const approved = await studentSale();
      await auditModel.updateOne(
        { dealId: new Types.ObjectId(approved) },
        { $set: { auditStatus: 'Pass' } },
      );
      expect(await boardRow(open)).toBeDefined();

      // David makes the transcript a manager-only check.
      await templateModel.updateMany(
        { agencyId: seed.agencyId, name: 'Good Student' },
        { $set: { producerVisible: false } },
      );
      try {
        const result = await reconcileDealAudits(
          { itemModel, dealAuditModel: auditModel, dealModel, templateModel },
          seed.agencyId,
        );
        expect(result.flagsRestamped).toBeGreaterThanOrEqual(1);

        expect((await itemNamed(open, 'Good Student')).producerVisible).toBe(
          false,
        );
        // Nothing left for the producer: off the board, and with the manager
        // as a system submission — the generator's own rule.
        const audit = await auditOf(open);
        expect(audit!.producerItemCount).toBe(0);
        expect(audit!.auditStatus).toBe('Pending');
        expect(audit!.submittedById ?? null).toBeNull();
        expect(await boardRow(open)).toBeUndefined();

        // History is not rewritten.
        expect(
          (await itemNamed(approved, 'Good Student')).producerVisible,
        ).toBe(true);

        // A re-run with nothing changed writes nothing.
        const again = await reconcileDealAudits(
          { itemModel, dealAuditModel: auditModel, dealModel, templateModel },
          seed.agencyId,
        );
        expect(again.flagsRestamped).toBe(0);
      } finally {
        await templateModel.updateMany(
          { agencyId: seed.agencyId, name: 'Good Student' },
          { $set: { producerVisible: true } },
        );
      }
    });
  });
});
