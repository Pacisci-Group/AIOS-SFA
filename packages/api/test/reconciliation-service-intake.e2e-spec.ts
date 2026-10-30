import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { parse } from 'csv-parse';
import {
  ModuleKey,
  RECONCILIATION_ASSIGNEE_CANNOT_SERVICE,
  RECONCILIATION_HOUSEHOLD_NOT_VISIBLE,
  RECONCILIATION_OUTCOME_FORBIDDEN,
  RECONCILIATION_OUTCOME_LOCKED,
  RECONCILIATION_OUTCOME_NOT_ALLOWED,
  type ReconciliationAssignedRowDetail,
  type ReconciliationOptionsResponse,
  type ReconciliationPresignResponse,
  type ReconciliationRowListResponse,
  type ReconciliationRunDetail,
  type ReconciliationServiceIntakeOptions,
  type ReconciliationServiceIntakeResponse,
} from '@sfa/shared';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import * as XLSX from 'xlsx';
import { App } from 'supertest/types';
import { ReconciliationRow } from '../src/carrier-reconciliation/schemas/reconciliation-row.schema';
import { ReconciliationRun } from '../src/carrier-reconciliation/schemas/reconciliation-run.schema';
import { Carrier } from '../src/carriers/schemas/carrier.schema';
import {
  reconciliationPolicyKey,
  type DashRow,
} from '../src/common/carrier-reconciliation/dash-file-reader';
import { Contact } from '../src/contacts/schemas/contact.schema';
import { Onboarding } from '../src/crm/schemas/onboarding.schema';
import { ServiceTicket } from '../src/crm/schemas/service-ticket.schema';
import { Deal } from '../src/deals/schemas/deal.schema';
import { HouseholdMember } from '../src/households/schemas/household-member.schema';
import { Household } from '../src/households/schemas/household.schema';
import { InngestService } from '../src/inngest/inngest.service';
import { Lead } from '../src/leads/schemas/lead.schema';
import { AccessResolverService } from '../src/permissions/access-resolver.service';
import { RoleAssignmentsService } from '../src/permissions/role-assignments.service';
import { Agency } from '../src/platform/schemas/agency.schema';
import { Policy } from '../src/policies/schemas/policy.schema';
import { StorageService } from '../src/storage/storage.service';
import { User } from '../src/users/schemas/user.schema';
import { authHeader, login } from './helpers/auth.helper';
import { FakeStorage } from './helpers/fake-storage';
import {
  CapturedInngestService,
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
 * PAC-173 PR 5 — a 1-800 Dash row **set up for service**: the household
 * (captured as a lead's, but no lead), a `carrier_direct` policy with its
 * signed application and no deal, and the chosen CSR's welcome call.
 *
 * Runs and rows are written straight to the models, as in the PR 3 and PR 4
 * suites; the intake itself goes through the real endpoints — the row's PDF
 * presign, "upload" into a `FakeStorage`, then `POST …/service-intake` — and
 * what it wrote is read back from the collections.
 *
 * Rows are seeded **already assigned** to the Test CSR: the CSR is the person
 * this is for, and holds `leads:write` but no Deal Audits.
 */
const SECOND_PRODUCER_EMAIL = 'svc-second-producer@sfa.local';

/** The smallest thing storage would call a PDF; only its type and size are read. */
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n');

interface SeededRow {
  runId: string;
  rowId: string;
  policyNumber: string;
}

describe('Dash Reconciliation 1-800 service intake (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestSeedContext;
  let storage: FakeStorage;
  let ownerToken: string;
  let producerToken: string;
  let csrToken: string;
  let ownerId: string;
  let producerId: string;
  let csrId: string;
  let secondId: string;
  let carrierId: Types.ObjectId;

  let runs: Model<ReconciliationRun>;
  let rows: Model<ReconciliationRow>;
  let deals: Model<Deal>;
  let leads: Model<Lead>;
  let policies: Model<Policy>;
  let households: Model<Household>;
  let contacts: Model<Contact>;
  let memberships: Model<HouseholdMember>;
  let onboardings: Model<Onboarding>;
  let tickets: Model<ServiceTicket>;
  let agencies: Model<Agency>;
  let roleAssignments: RoleAssignmentsService;

  let seq = 0;
  let person = 0;
  const api = () => request(app.getHttpServer());
  const base = '/api/v1/carrier-reconciliation';
  const oid = (id: string) => new Types.ObjectId(id);

  // ── Requests ───────────────────────────────────────────────────────────

  const detail = async (rowId: string, token = csrToken) =>
    (
      await api()
        .get(`${base}/assigned/${rowId}`)
        .set(authHeader(token))
        .expect(200)
    ).body as ReconciliationAssignedRowDetail;
  const presign = (row: SeededRow, body: object = {}, token = csrToken) =>
    api()
      .post(`${base}/assigned/${row.rowId}/documents/presign`)
      .set(authHeader(token))
      .send({
        filename: 'application.pdf',
        contentType: 'application/pdf',
        size: PDF.byteLength,
        ...body,
      });
  /** Presign the application under the row, then the browser's PUT to storage. */
  const upload = async (row: SeededRow, token = csrToken) => {
    const res = await presign(row, {}, token).expect(201);
    const { key } = res.body as ReconciliationPresignResponse;
    await storage.putObject(key, PDF, 'application/pdf');
    return {
      key,
      filename: 'application.pdf',
      contentType: 'application/pdf',
      size: PDF.byteLength,
    };
  };
  const intakeOptions = (row: SeededRow, token = csrToken) =>
    api()
      .get(`${base}/assigned/${row.rowId}/service-intake/options`)
      .set(authHeader(token));
  /** The form's body, seeded from the prefill as the page is. */
  const intakeBody = (
    application: object,
    extra: Record<string, unknown> = {},
  ) => {
    const n = ++person;
    return {
      primaryContact: {
        firstName: 'Morgan',
        lastName: 'Hale',
        dateOfBirth: `${1950 + n}-02-14`,
        phone: `(555) 620-${1000 + n}`,
        email: `morgan.hale.${n}@example.com`,
      },
      address: {
        street: `${n} Service Rd`,
        city: 'Tulsa',
        state: 'OK',
        zip: '74103',
      },
      members: [
        {
          firstName: 'Riley',
          lastName: 'Hale',
          dateOfBirth: `${1952 + n}-07-01`,
          role: 'Spouse',
        },
      ],
      policy: {
        policyNumber: '',
        policyType: 'Auto',
        premium: 793.08,
        itemCount: 1,
        effectiveDate: '2026-09-15',
        newBusinessApplication: application,
      },
      assignedCsrId: csrId,
      ...extra,
    };
  };
  const submit = (row: SeededRow, body: object, token = csrToken) =>
    api()
      .post(`${base}/assigned/${row.rowId}/service-intake`)
      .set(authHeader(token))
      .send(body);
  /** The whole form, filled in for `row`, as its assignee sends it. */
  const setUp = async (
    row: SeededRow,
    status: number,
    extra: Record<string, unknown> = {},
    token = csrToken,
  ) => {
    const body = intakeBody(await upload(row, token), extra);
    body.policy.policyNumber = row.policyNumber;
    return submit(row, body, token).expect(status);
  };
  const record = (row: SeededRow, body: object, token = csrToken) =>
    api()
      .patch(`${base}/assigned/${row.rowId}/outcome`)
      .set(authHeader(token))
      .send(body);

  const review = (row: SeededRow, body: Record<string, unknown>) =>
    api()
      .patch(`${base}/runs/${row.runId}/rows/${row.rowId}/review`)
      .set(authHeader(ownerToken))
      .send(body);
  const assign = (row: SeededRow, userId: string | null) =>
    api()
      .patch(`${base}/runs/${row.runId}/rows/${row.rowId}/assignment`)
      .set(authHeader(ownerToken))
      .send({ userId });
  const options = async () =>
    (
      (
        await api()
          .get(`${base}/options`)
          .set(authHeader(ownerToken))
          .expect(200)
      ).body as ReconciliationOptionsResponse
    ).assignees;
  const stored = async (rowId: string) => rows.findById(rowId).lean();

  // ── Fixtures ───────────────────────────────────────────────────────────

  async function seedRun() {
    const run = await runs.create({
      agencyId: ctx.agencyId,
      carrierId,
      status: 'ready',
      file: {
        storageKey: `agencies/${ctx.agencyId}/carrier-reconciliation/si-${++seq}.xlsx`,
        filename: 'NB-Details-Sep-2026.xlsx',
        size: 1,
      },
      fileMeta: {
        agentNumber: null,
        agentName: null,
        downloadedBy: null,
        downloadedAt: null,
        startDate: '2026-09-01',
        endDate: '2026-09-30',
        sheetName: 'Sheet1',
        headerRowNumber: 1,
        rowCount: 1,
      },
    });
    return run._id.toString();
  }

  /** A 1-800 line: bound by an Allstate login on no user, unnamed, through 1-800. */
  function dashLine(n: number, extra: Partial<DashRow> = {}): DashRow {
    const policyNumber =
      extra.policyNumber ?? `9008${String(n).padStart(5, '0')}`;
    return {
      rowNumber: n,
      agentNumber: '0B9049',
      subProducerCode: null,
      subProducerName: null,
      bindId: 'OSCVANJ',
      bindIdKey: 'OSCVANJ',
      bindIdName: null,
      policyNumber,
      policyKey: reconciliationPolicyKey(policyNumber),
      customerName: 'MORGAN HALE',
      issuedDate: '2026-09-15',
      dateWritten: '2026-09-15',
      product: 'Standard Auto',
      productDescription: 'Standard Auto',
      lineGroup: null,
      packageName: null,
      transactionType: 'Sales Issued',
      dispositionCode: 'New Policy Issued',
      itemCount: 1,
      writtenPremium: 793.08,
      channel: '1-800',
      channelIndicator: '1-800',
      scenarioName: null,
      ...extra,
    };
  }

  /** A Dash-only 1-800 row, waiting on a decision, assigned to the Test CSR. */
  async function seedRow(
    extra: Partial<ReconciliationRow> = {},
  ): Promise<SeededRow> {
    const run = await seedRun();
    const n = ++seq;
    const dash = dashLine(n);
    const row = await rows.create({
      agencyId: ctx.agencyId,
      runId: oid(run),
      rowKey: `si-row-${n}`,
      side: 'dash',
      match: 'dash_only',
      isSale: true,
      dash,
      bindIdStatus: 'not_staff',
      issues: ['direct_channel', 'not_staff_bind_id'],
      credit: { name: null, userId: null, via: 'none' },
      producerKey: 'none',
      tabs: ['review_1800'],
      needsReview: true,
      review: {
        status: 'open',
        resolution: null,
        note: null,
        reviewedById: null,
        reviewedAt: null,
        carriedForwardFromRowId: null,
      },
      assignment: {
        userId: csrId,
        assignedById: ownerId,
        assignedAt: new Date(),
        note: null,
      },
      ...extra,
    });
    return {
      runId: run,
      rowId: row._id.toString(),
      policyNumber: dash.policyNumber!,
    };
  }

  /** Flip one of the agency's modules, with the permission cache flushed. */
  async function withModule(
    key: ModuleKey,
    enabled: boolean,
    body: () => Promise<void>,
  ) {
    const resolver = app.get(AccessResolverService);
    const path = `modules.${key}.enabled`;
    await agencies.updateOne(
      { _id: ctx.agencyId },
      { $set: { [path]: enabled } },
    );
    await resolver.invalidateAgency(ctx.agencyId);
    try {
      await body();
    } finally {
      await agencies.updateOne(
        { _id: ctx.agencyId },
        { $set: { [path]: !enabled } },
      );
      await resolver.invalidateAgency(ctx.agencyId);
    }
  }

  beforeAll(async () => {
    storage = new FakeStorage();
    app = await createTestApp({
      overrides: [
        { provide: InngestService, useValue: new CapturedInngestService() },
        { provide: StorageService, useValue: storage.asService() },
      ],
    });
    const model = <T>(name: string) => app.get<Model<T>>(getModelToken(name));
    runs = model(ReconciliationRun.name);
    rows = model(ReconciliationRow.name);
    deals = model(Deal.name);
    leads = model(Lead.name);
    policies = model(Policy.name);
    households = model(Household.name);
    contacts = model(Contact.name);
    memberships = model(HouseholdMember.name);
    onboardings = model(Onboarding.name);
    tickets = model(ServiceTicket.name);
    agencies = model(Agency.name);
    roleAssignments = app.get(RoleAssignmentsService);
    const users = model<User>(User.name);

    // Drop BEFORE seeding — suites share one database and jest reorders them.
    await dropTestDatabase(app);
    ctx = await seedTestData(app);

    const carrier = await model<Carrier>(Carrier.name).create({
      agencyId: null,
      name: 'Allstate',
      slug: 'allstate',
      active: true,
    });
    carrierId = carrier._id;

    // Someone who may lose `leads:write` without touching the CSR.
    const second = await users.create({
      agencyId: oid(ctx.agencyId),
      branchId: oid(ctx.branchId),
      email: SECOND_PRODUCER_EMAIL,
      passwordHash: await bcrypt.hash(TEST_PASSWORD, 4),
      firstName: 'Second',
      lastName: 'Producer',
      isActive: true,
    });
    secondId = second._id.toString();
    await roleAssignments.setUserRoles(
      { userId: secondId, isPlatformAdmin: true },
      ctx.agencyId,
      second._id,
      [ctx.producerRoleId],
    );

    ownerToken = (await login(app, ctx.ownerEmail, TEST_PASSWORD)).accessToken;
    producerToken = (await login(app, ctx.producerEmail, TEST_PASSWORD))
      .accessToken;
    csrToken = (await login(app, ctx.csrEmail, TEST_PASSWORD)).accessToken;
    ownerId = (await users
      .findOne({ email: ctx.ownerEmail })
      .lean())!._id.toString();
    producerId = (await users
      .findOne({ email: ctx.producerEmail })
      .lean())!._id.toString();
    csrId = ctx.csrUserId;
  });

  afterAll(async () => {
    await dropTestDatabase(app);
    await closeTestApp(app);
  });

  beforeEach(async () => {
    await Promise.all([runs.deleteMany({}), rows.deleteMany({})]);
  });

  describe('who a 1-800 row can go to', () => {
    it('marks on the picker who can set one up for service', async () => {
      expect(await options()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: producerId, canSetUpService: true }),
          expect.objectContaining({ id: csrId, canSetUpService: true }),
          expect.objectContaining({ id: secondId, canSetUpService: true }),
        ]),
      );
    });

    it('refuses a Dash-only one to someone without leads:write, who may still take a matched one', async () => {
      await roleAssignments.setUserOverrides(
        ctx.agencyId,
        secondId,
        [],
        ['leads:write'],
      );
      try {
        expect(await options()).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: secondId, canSetUpService: false }),
          ]),
        );
        const dashOnly = await seedRow({ assignment: null });
        const res = await assign(dashOnly, secondId).expect(400);
        expect((res.body as { code: string }).code).toBe(
          RECONCILIATION_ASSIGNEE_CANNOT_SERVICE,
        );

        // The policy is in the app already: Other only, so anyone may take it.
        const matched = await seedRow({
          assignment: null,
          match: 'matched',
          side: 'both',
          tabs: ['matched', 'review_1800'],
        });
        await assign(matched, secondId).expect(200);
      } finally {
        await roleAssignments.setUserOverrides(ctx.agencyId, secondId, [], []);
      }
    });
  });

  describe('what the form is given', () => {
    it('offers Set up for service, with the welcome call’s opening note', async () => {
      const row = await seedRow();
      const view = await detail(row.rowId);
      expect(view.prefill?.serviceIntake).toEqual({
        openingNote:
          '1-800 policy from Dash — bound by OSCVANJ on 2026-09-15 through 1-800, Standard Auto, written premium $793.08.',
      });
      expect(view.prefill?.lead).toMatchObject({
        firstName: 'Morgan',
        lastName: 'Hale',
      });
      expect(view.prefill?.policy).toMatchObject({
        policyNumber: row.policyNumber,
        policyType: 'Auto',
        carrier: 'Allstate',
      });
    });

    it('presigns the application under the row, PDF only, for its assignee only', async () => {
      const row = await seedRow();

      const res = await presign(row).expect(201);
      expect((res.body as ReconciliationPresignResponse).key).toContain(
        `agencies/${ctx.agencyId}/reconciliation-rows/${row.rowId}/nba/`,
      );
      await presign(row, { contentType: 'image/png' }).expect(400);
      await presign(row, { size: 11 * 1024 * 1024 }).expect(400);
      await presign(row, {}, producerToken).expect(404);
    });

    it('lists the CSRs the welcome call can go to', async () => {
      const row = await seedRow();
      const res = await intakeOptions(row).expect(200);
      expect(
        (res.body as ReconciliationServiceIntakeOptions).assignees.map(
          (a) => a.id,
        ),
      ).toContain(csrId);
    });

    it('offers nothing of the kind on a row that is not a 1-800 policy the app lacks', async () => {
      const matched = await seedRow({
        match: 'matched',
        side: 'both',
        tabs: ['matched', 'review_1800'],
      });
      expect((await detail(matched.rowId)).prefill?.serviceIntake).toBeNull();
      const res = await presign(matched).expect(400);
      expect((res.body as { code: string }).code).toBe(
        RECONCILIATION_OUTCOME_NOT_ALLOWED,
      );
      await intakeOptions(matched).expect(400);
    });
  });

  describe('set up for service, end to end', () => {
    it('saves the household and a carrier_direct policy, opens the CSR’s welcome call, and finishes the row', async () => {
      const row = await seedRow();
      const [dealsBefore, leadsBefore] = await Promise.all([
        deals.countDocuments({}),
        leads.countDocuments({}),
      ]);

      const res = await setUp(row, 201);
      const body = res.body as ReconciliationServiceIntakeResponse;

      // The row.
      expect(body.onboardingId).toEqual(expect.any(String));
      expect(body.ticketId).toEqual(expect.any(String));
      expect(body.row?.outcome).toMatchObject({
        kind: 'service_intake',
        status: 'done',
        step: null,
        householdId: body.householdId,
        policyId: body.policyId,
        onboardingId: body.onboardingId,
        ticketId: body.ticketId,
        dealId: null,
        leadId: null,
        startedBy: { id: csrId },
        completedBy: { id: csrId },
      });
      expect(body.row?.review).toMatchObject({
        status: 'resolved',
        resolution: 'service_intake_recorded',
        reviewedBy: { id: csrId },
      });

      // The household, captured as a lead's — with no lead.
      const household = await households.findById(body.householdId).lean();
      expect(household).toMatchObject({
        agencyId: ctx.agencyId,
        name: 'Hale Household',
        totalActivePolicies: 1,
      });
      expect(String(household!.assignedCrmId)).toBe(csrId);
      const primary = await contacts
        .findById(household!.primaryContactId)
        .lean();
      expect(primary).toMatchObject({ firstName: 'Morgan', lastName: 'Hale' });
      const roster = await memberships
        .find({ householdId: household!._id })
        .lean();
      expect(roster.map((m) => m.role).sort()).toEqual([
        'Named Insured',
        'Spouse',
      ]);

      // The policy: Allstate's, serviced, never sold.
      const policy = await policies.findById(body.policyId).lean();
      expect(policy).toMatchObject({
        origin: 'carrier_direct',
        policyNumber: row.policyNumber,
        policyNumberKey: row.policyNumber,
        policyType: 'Auto',
        carrier: 'Allstate',
        premium: 793.08,
        items: 1,
        active: true,
        policyStatus: 'Active',
      });
      expect(policy!.dealId).toBeUndefined();
      expect(policy!.renewalDate).toBeInstanceOf(Date);
      expect(policy!.effectiveDate?.toISOString()).toBe(
        '2026-09-15T00:00:00.000Z',
      );
      expect(policy!.newBusinessApplication?.key).toContain(
        `/reconciliation-rows/${row.rowId}/nba/`,
      );
      expect(await deals.countDocuments({})).toBe(dealsBefore);
      expect(await leads.countDocuments({})).toBe(leadsBefore);

      // The onboarding and its welcome call, the CSR's.
      const onboarding = await onboardings.findById(body.onboardingId).lean();
      expect(onboarding).toMatchObject({
        dealId: null,
        salesProducerName: 'Allstate 1-800 (OSCVANJ)',
        currentStepKey: 'welcome_call',
        clientName: 'Morgan Hale',
      });
      expect(String(onboarding!.assignedCsrId)).toBe(csrId);
      expect(String(onboarding!.policyId)).toBe(body.policyId);
      const ticket = await tickets.findById(body.ticketId).lean();
      expect(ticket).toMatchObject({
        category: 'Onboarding',
        status: 'open',
        policyNumber: row.policyNumber,
      });
      expect(ticket!.onboarding?.stepKey).toBe('welcome_call');
      expect(String(ticket!.assignedUserId)).toBe(csrId);
      expect(ticket!.timeline[0].content).toBe(
        '1-800 policy from Dash — bound by OSCVANJ on 2026-09-15 through 1-800, Standard Auto, written premium $793.08.',
      );

      // On the CSR's own desk, and on the household page they can open.
      const mine = await api()
        .get('/api/v1/crm/service-tickets')
        .query({ scope: 'own', pageSize: 100 })
        .set(authHeader(csrToken))
        .expect(200);
      expect(
        (mine.body as { items: { id: string }[] }).items.map((t) => t.id),
      ).toContain(body.ticketId);
      const page = await api()
        .get(`/api/v1/households/${body.householdId}`)
        .set(authHeader(csrToken))
        .expect(200);
      expect(
        (page.body as { policies: { id: string; origin: string | null }[] })
          .policies,
      ).toEqual([
        expect.objectContaining({
          id: body.policyId,
          origin: 'carrier_direct',
        }),
      ]);
    });

    it('lets a Producer do it too, handing the welcome call to the CSR', async () => {
      const row = await seedRow({
        assignment: {
          userId: producerId,
          assignedById: ownerId,
          assignedAt: new Date(),
          note: null,
        },
      });
      const res = await setUp(row, 201, {}, producerToken);
      const body = res.body as ReconciliationServiceIntakeResponse;
      expect(body.row?.outcome).toMatchObject({
        status: 'done',
        completedBy: { id: producerId },
      });
      const ticket = await tickets.findById(body.ticketId).lean();
      expect(String(ticket!.assignedUserId)).toBe(csrId);
    });

    it('adds the policy to an existing client when the form picks one', async () => {
      const first = await setUp(await seedRow(), 201);
      const { householdId } = first.body as ReconciliationServiceIntakeResponse;
      const client = await contacts
        .findById(
          (await households.findById(householdId).lean())!.primaryContactId,
        )
        .lean();
      const before = await households.countDocuments({});

      const row = await seedRow();
      const body = intakeBody(await upload(row), {
        householdId,
        members: [],
      });
      body.policy.policyNumber = row.policyNumber;
      body.primaryContact = {
        firstName: client!.firstName!,
        lastName: client!.lastName!,
        dateOfBirth: client!.dateOfBirth!.toISOString().slice(0, 10),
        phone: client!.phone!,
        email: client!.email!,
      };
      const res = await submit(row, body).expect(201);

      expect(
        (res.body as ReconciliationServiceIntakeResponse).householdId,
      ).toBe(householdId);
      expect(await households.countDocuments({})).toBe(before);
      expect(
        (await households.findById(householdId).lean())!.totalActivePolicies,
      ).toBe(2);
    });
  });

  describe('a client already on file', () => {
    it('keeps the stored phone and says the new one on the welcome call', async () => {
      const first = (await setUp(await seedRow(), 201))
        .body as ReconciliationServiceIntakeResponse;
      const household = await households.findById(first.householdId).lean();
      const client = await contacts
        .findById(household!.primaryContactId)
        .lean();

      const row = await seedRow();
      const body = intakeBody(await upload(row), { members: [] });
      body.policy.policyNumber = row.policyNumber;
      body.primaryContact = {
        firstName: client!.firstName!,
        lastName: client!.lastName!,
        dateOfBirth: client!.dateOfBirth!.toISOString().slice(0, 10),
        phone: '(555) 999-0000',
        email: client!.email!,
      };
      const res = (await submit(row, body).expect(201))
        .body as ReconciliationServiceIntakeResponse;

      expect(res.householdId).toBe(first.householdId);
      expect((await contacts.findById(client!._id).lean())?.phone).toBe(
        client!.phone,
      );
      const ticket = await tickets.findById(res.ticketId).lean();
      expect(ticket!.timeline[0].content).toContain(
        // Both as stored: digits only, as lead intake's own conflict entry has them.
        `The phone on file is ${client!.phone}; the form gave 5559990000. The one on file was kept.`,
      );
      // Stored with the outcome at the commit, so a retried hand-off says it too.
      expect((await stored(row.rowId))?.outcome?.note).toContain(
        'the form gave 5559990000',
      );
    });
  });

  describe('what it refuses, before writing anything', () => {
    it('an application that never reached storage, or was presigned for another row', async () => {
      const row = await seedRow();
      const other = await seedRow();
      const missing = {
        key: (
          (await presign(row).expect(201)).body as ReconciliationPresignResponse
        ).key,
        filename: 'application.pdf',
        contentType: 'application/pdf',
        size: PDF.byteLength,
      };
      const body = intakeBody(missing);
      body.policy.policyNumber = row.policyNumber;
      await submit(row, body).expect(404);

      const foreign = intakeBody(await upload(other));
      foreign.policy.policyNumber = row.policyNumber;
      await submit(row, foreign).expect(400);
      expect((await stored(row.rowId))?.outcome).toBeNull();
    });

    it('a welcome call for someone outside the CSR pool', async () => {
      const row = await seedRow();
      await setUp(row, 400, { assignedCsrId: producerId });
      expect((await stored(row.rowId))?.outcome).toBeNull();
    });

    it('a 1-800 policy the app already has', async () => {
      const row = await seedRow({
        match: 'matched',
        side: 'both',
        tabs: ['matched', 'review_1800'],
      });
      const body = intakeBody({
        key: `agencies/${ctx.agencyId}/reconciliation-rows/${row.rowId}/nba/2026/x.pdf`,
        filename: 'x.pdf',
        contentType: 'application/pdf',
        size: 1,
      });
      body.policy.policyNumber = row.policyNumber;
      const res = await submit(row, body).expect(400);
      expect((res.body as { code: string }).code).toBe(
        RECONCILIATION_OUTCOME_NOT_ALLOWED,
      );
    });

    it('someone who has lost leads:write', async () => {
      const row = await seedRow();
      const application = await upload(row);
      await roleAssignments.setUserOverrides(
        ctx.agencyId,
        csrId,
        [],
        ['leads:write'],
      );
      try {
        const body = intakeBody(application);
        body.policy.policyNumber = row.policyNumber;
        const res = await submit(row, body).expect(403);
        expect((res.body as { code: string }).code).toBe(
          RECONCILIATION_OUTCOME_FORBIDDEN,
        );
      } finally {
        await roleAssignments.setUserOverrides(ctx.agencyId, csrId, [], []);
      }
    });

    it('an agency with CRM service off, where no welcome call can open', async () => {
      const row = await seedRow();
      const application = await upload(row);
      await withModule(ModuleKey.CrmService, false, async () => {
        expect((await detail(row.rowId)).prefill?.serviceIntake).toBeNull();
        const body = intakeBody(application);
        body.policy.policyNumber = row.policyNumber;
        await submit(row, body).expect(409);
      });
      expect((await stored(row.rowId))?.outcome).toBeNull();
    });

    it('a number already on a sale in the app — the row is stale', async () => {
      const row = await seedRow();
      await policies.create({
        agencyId: ctx.agencyId,
        branchId: ctx.branchId,
        policyNumber: row.policyNumber,
        policyNumberKey: row.policyNumber,
        policyType: 'Auto',
        carrier: 'Allstate',
        active: true,
        dealId: new Types.ObjectId(),
        isTestRecord: false,
      });
      const before = await households.countDocuments({});
      await setUp(row, 409);
      expect(await households.countDocuments({})).toBe(before);
    });

    it('anyone but the assignee, a decided row, and a second submit', async () => {
      const row = await seedRow();
      const mine = intakeBody(await upload(row));
      mine.policy.policyNumber = row.policyNumber;
      await submit(row, mine, producerToken).expect(404);

      const decided = await seedRow({
        review: {
          status: 'resolved',
          resolution: 'service_set_up',
          note: null,
          reviewedById: ownerId,
          reviewedAt: new Date(),
          carriedForwardFromRowId: null,
        },
      });
      // Nothing is even uploaded for it.
      await presign(decided).expect(409);
      const forDecided = intakeBody(mine.policy.newBusinessApplication);
      forDecided.policy.policyNumber = decided.policyNumber;
      await submit(decided, forDecided).expect(409);

      await submit(row, mine).expect(201);
      const before = await policies.countDocuments({});
      await presign(row).expect(409);
      await submit(row, mine).expect(409);
      expect(await policies.countDocuments({})).toBe(before);
    });

    it('a household outside the caller’s branch, with its own code so the form stays', async () => {
      const elsewhere = await households.create({
        agencyId: ctx.agencyId,
        branchId: new Types.ObjectId().toHexString(),
        name: 'Elsewhere Household',
        totalActivePolicies: 0,
        isTestRecord: false,
      });
      const row = await seedRow();
      const body = intakeBody(await upload(row), {
        householdId: String(elsewhere._id),
      });
      body.policy.policyNumber = row.policyNumber;
      const res = await submit(row, body).expect(404);
      expect((res.body as { code: string }).code).toBe(
        RECONCILIATION_HOUSEHOLD_NOT_VISIBLE,
      );
      expect((await stored(row.rowId))?.outcome).toBeNull();
    });

    it('a client whose one household is outside the caller’s branch, found by who they are', async () => {
      const first = (await setUp(await seedRow(), 201))
        .body as ReconciliationServiceIntakeResponse;
      const household = await households.findById(first.householdId).lean();
      const client = await contacts
        .findById(household!.primaryContactId)
        .lean();
      await households.updateOne(
        { _id: first.householdId },
        { $set: { branchId: new Types.ObjectId().toHexString() } },
      );

      const row = await seedRow();
      const body = intakeBody(await upload(row), { members: [] });
      body.policy.policyNumber = row.policyNumber;
      body.primaryContact = {
        firstName: client!.firstName!,
        lastName: client!.lastName!,
        dateOfBirth: client!.dateOfBirth!.toISOString().slice(0, 10),
        phone: client!.phone!,
        email: client!.email!,
      };
      const before = await policies.countDocuments({});
      const res = await submit(row, body).expect(404);
      expect((res.body as { code: string }).code).toBe(
        RECONCILIATION_HOUSEHOLD_NOT_VISIBLE,
      );
      expect(await policies.countDocuments({})).toBe(before);
      expect((await stored(row.rowId))?.outcome).toBeNull();
    });

    it('a policy number that is not the Dash line’s', async () => {
      const row = await seedRow();
      const other = await seedRow();
      const body = intakeBody(await upload(row));
      body.policy.policyNumber = other.policyNumber;
      const res = await submit(row, body).expect(400);
      expect((res.body as { message: string }).message).toContain(
        row.policyNumber,
      );
      expect((await stored(row.rowId))?.outcome).toBeNull();
    });

    it('presign and the CSR list without leads:write', async () => {
      const row = await seedRow();
      await roleAssignments.setUserOverrides(
        ctx.agencyId,
        csrId,
        [],
        ['leads:write'],
      );
      try {
        await presign(row).expect(403);
        await intakeOptions(row).expect(403);
      } finally {
        await roleAssignments.setUserOverrides(ctx.agencyId, csrId, [], []);
      }
    });

    it('starting it without the form', async () => {
      const row = await seedRow();
      const res = await record(row, { kind: 'service_intake' }).expect(400);
      expect((res.body as { code: string }).code).toBe(
        RECONCILIATION_OUTCOME_NOT_ALLOWED,
      );
    });
  });

  /** As if the hand-off had died after the commit: the row back at `start_onboarding`. */
  const backToStartOnboarding = (rowId: string) =>
    rows.updateOne(
      { _id: rowId },
      {
        $set: {
          'outcome.status': 'in_progress',
          'outcome.step': 'start_onboarding',
          'outcome.onboardingId': null,
          'outcome.ticketId': null,
          'outcome.completedById': null,
          'outcome.completedAt': null,
          review: {
            status: 'open',
            resolution: null,
            note: null,
            reviewedById: null,
            reviewedAt: null,
            carriedForwardFromRowId: null,
          },
        },
      },
    );

  describe('Continue, when the welcome call did not open', () => {
    it('repairs an onboarding whose welcome call never opened, rather than finishing without one', async () => {
      const row = await seedRow();
      const done = (await setUp(row, 201))
        .body as ReconciliationServiceIntakeResponse;
      // The onboarding was written, its ticket was not.
      await tickets.deleteOne({ _id: done.ticketId });
      await backToStartOnboarding(row.rowId);

      const res = await record(row, { kind: 'service_intake' }).expect(200);
      const resumed = res.body as ReconciliationAssignedRowDetail;
      expect(resumed.outcome?.status).toBe('done');
      expect(resumed.outcome?.onboardingId).toBe(done.onboardingId);
      expect(resumed.outcome?.ticketId).toEqual(expect.any(String));
      expect(resumed.outcome?.ticketId).not.toBe(done.ticketId);
      expect(
        await onboardings.countDocuments({ policyId: oid(done.policyId) }),
      ).toBe(1);
      const welcome = await tickets.findById(resumed.outcome?.ticketId).lean();
      expect(welcome?.onboarding?.stepKey).toBe('welcome_call');
      expect(String(welcome?.assignedUserId)).toBe(csrId);
    });

    it('is opened first when the owner decides, reassigns or takes the row back', async () => {
      for (const act of ['decide', 'reassign', 'unassign'] as const) {
        const row = await seedRow();
        const done = (await setUp(row, 201))
          .body as ReconciliationServiceIntakeResponse;
        await onboardings.deleteOne({ _id: done.onboardingId });
        await tickets.deleteOne({ _id: done.ticketId });
        await backToStartOnboarding(row.rowId);

        if (act === 'decide') {
          await review(row, { status: 'resolved', resolution: 'other' }).expect(
            200,
          );
        } else if (act === 'reassign') {
          // Finished first, the row is decided: no hand-over left to make.
          await assign(row, producerId).expect(409);
        } else {
          // Taking a row back always works; the finished outcome stays.
          await assign(row, null).expect(200);
        }
        const after = await stored(row.rowId);
        expect(after?.outcome).toMatchObject({
          kind: 'service_intake',
          status: 'done',
          policyId: done.policyId,
        });
        expect(after?.outcome?.ticketId).toEqual(expect.any(String));
        expect(
          await onboardings.countDocuments({ policyId: oid(done.policyId) }),
        ).toBe(1);
      }
    });

    it('opens a late call unassigned when its CSR is no longer one', async () => {
      const row = await seedRow();
      const done = (await setUp(row, 201))
        .body as ReconciliationServiceIntakeResponse;
      await onboardings.deleteOne({ _id: done.onboardingId });
      await tickets.deleteOne({ _id: done.ticketId });
      await backToStartOnboarding(row.rowId);
      // The CSR named at submit is not a CSR or CRM any more.
      await rows.updateOne(
        { _id: row.rowId },
        { $set: { 'outcome.csrId': producerId } },
      );

      const res = await record(row, { kind: 'service_intake' }).expect(200);
      const ticket = await tickets
        .findById(
          (res.body as ReconciliationAssignedRowDetail).outcome?.ticketId,
        )
        .lean();
      expect(ticket?.onboarding?.stepKey).toBe('welcome_call');
      expect(ticket?.assignedUserId ?? null).toBeNull();
    });

    it('lets one caller open it at a time', async () => {
      const row = await seedRow();
      const done = (await setUp(row, 201))
        .body as ReconciliationServiceIntakeResponse;
      await onboardings.deleteOne({ _id: done.onboardingId });
      await tickets.deleteOne({ _id: done.ticketId });
      await backToStartOnboarding(row.rowId);

      // Someone else is opening it right now: Continue leaves it to them.
      await rows.updateOne(
        { _id: row.rowId },
        { $set: { 'outcome.handOffAt': new Date() } },
      );
      const held = await record(row, { kind: 'service_intake' }).expect(200);
      expect((held.body as ReconciliationAssignedRowDetail).outcome?.step).toBe(
        'start_onboarding',
      );
      expect(
        await onboardings.countDocuments({ policyId: oid(done.policyId) }),
      ).toBe(0);

      // A claim left behind by a crash lapses.
      await rows.updateOne(
        { _id: row.rowId },
        {
          $set: { 'outcome.handOffAt': new Date(Date.now() - 10 * 60 * 1000) },
        },
      );
      const opened = await record(row, { kind: 'service_intake' }).expect(200);
      expect(
        (opened.body as ReconciliationAssignedRowDetail).outcome?.status,
      ).toBe('done');
      expect(
        await onboardings.countDocuments({ policyId: oid(done.policyId) }),
      ).toBe(1);
    });

    it('is not cleared by the owner while someone is opening it', async () => {
      const row = await seedRow();
      const done = (await setUp(row, 201))
        .body as ReconciliationServiceIntakeResponse;
      await onboardings.deleteOne({ _id: done.onboardingId });
      await tickets.deleteOne({ _id: done.ticketId });
      await backToStartOnboarding(row.rowId);
      await rows.updateOne(
        { _id: row.rowId },
        { $set: { 'outcome.handOffAt': new Date() } },
      );

      await review(row, { status: 'resolved', resolution: 'other' }).expect(
        409,
      );
      await review(row, { status: 'open' }).expect(409);
      await assign(row, producerId).expect(409);
      await assign(row, null).expect(409);
      expect((await stored(row.rowId))?.outcome).toMatchObject({
        status: 'in_progress',
        step: 'start_onboarding',
        policyId: done.policyId,
      });

      // Once the claim lapses, taking it back opens the call first.
      await rows.updateOne(
        { _id: row.rowId },
        {
          $set: { 'outcome.handOffAt': new Date(Date.now() - 10 * 60 * 1000) },
        },
      );
      await assign(row, null).expect(200);
      expect((await stored(row.rowId))?.outcome).toMatchObject({
        status: 'done',
        ticketId: expect.any(String) as unknown,
      });
    });

    it('refuses while CRM service is off, as the form does', async () => {
      const row = await seedRow();
      await setUp(row, 201);
      await backToStartOnboarding(row.rowId);
      await withModule(ModuleKey.CrmService, false, async () => {
        await record(row, { kind: 'service_intake' }).expect(409);
      });
      expect((await stored(row.rowId))?.outcome?.step).toBe('start_onboarding');
    });

    it('opens it from the row alone, once', async () => {
      const row = await seedRow();
      const done = (await setUp(row, 201))
        .body as ReconciliationServiceIntakeResponse;
      // As if the hand-off had died after the commit.
      await onboardings.deleteOne({ _id: done.onboardingId });
      await tickets.deleteOne({ _id: done.ticketId });
      await rows.updateOne(
        { _id: row.rowId },
        {
          $set: {
            'outcome.status': 'in_progress',
            'outcome.step': 'start_onboarding',
            'outcome.onboardingId': null,
            'outcome.ticketId': null,
            'outcome.completedById': null,
            'outcome.completedAt': null,
            review: {
              status: 'open',
              resolution: null,
              note: null,
              reviewedById: null,
              reviewedAt: null,
              carriedForwardFromRowId: null,
            },
          },
        },
      );

      // Switching away is refused while it waits.
      const locked = await record(row, { kind: 'other', note: 'x' }).expect(
        409,
      );
      expect((locked.body as { code: string }).code).toBe(
        RECONCILIATION_OUTCOME_LOCKED,
      );

      const res = await record(row, { kind: 'service_intake' }).expect(200);
      const resumed = res.body as ReconciliationAssignedRowDetail;
      expect(resumed.outcome).toMatchObject({
        status: 'done',
        householdId: done.householdId,
        policyId: done.policyId,
      });
      expect(resumed.outcome?.onboardingId).toEqual(expect.any(String));
      expect(resumed.outcome?.ticketId).toEqual(expect.any(String));
      expect(resumed.review.resolution).toBe('service_intake_recorded');
      expect(
        await onboardings.countDocuments({ policyId: oid(done.policyId) }),
      ).toBe(1);

      // Asking again is the answer, unchanged.
      await record(row, { kind: 'service_intake' }).expect(200);
      expect(
        await onboardings.countDocuments({ policyId: oid(done.policyId) }),
      ).toBe(1);
    });
  });

  // ── The next upload: the engine, end to end through a real file ─────────

  /** A Dash export as the reader expects it: metadata rows, then the header. */
  function dashFile(
    lines: (string | number)[][],
    downloadedAt: string,
  ): Buffer {
    const header = [
      'Agent Number',
      'Sub Producer',
      'Sub-Producer Name',
      'Bind ID',
      'Bind ID Name',
      'Policy No',
      'Customer Name',
      'Issued Date',
      'Date Written',
      'Year',
      'Month ',
      'Product',
      'Line Group',
      'Product Description ',
      'Package',
      'Transaction Type',
      'Item Count',
      'Written Premium',
      'Disposition Code',
      'Channel',
      'Channel Indicator',
      'ADJ. Code',
      'Scenario Name',
      'Facility Auto',
      'Channel',
    ];
    const sheet = XLSX.utils.aoa_to_sheet([
      ['New Business Details'],
      ['Download Date', downloadedAt],
      ['Downloaded By', 'SOKOWNER - '],
      ['Start Date', '09/01/2026'],
      ['End Date', '09/30/2026'],
      ['Product Category', 'All'],
      [],
      header,
      ...lines,
    ]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'New Business Details');
    return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }
  /** Allstate sold it: an unnamed login on no user, through 1-800. */
  const directLine = (policyNumber: string) => [
    '',
    '',
    '',
    'OSCVTST',
    '',
    policyNumber,
    'MORGAN HALE',
    '09/15/2026',
    '09/15/2026',
    2026,
    9,
    'Standard Auto',
    '330-OK-0001',
    'Standard Auto',
    '',
    'Sales Issued',
    1,
    793.08,
    'New Policy Issued',
    '1-800',
    'CCC',
    '',
    'CCC',
    'Without Facility Auto',
    '1-800',
  ];
  /** A line of the agency's own, so a file without the 1-800 one still has a sale. */
  const agencyLine = [
    '',
    '',
    '',
    'SOKOTHER',
    'SOMEONE ELSE',
    '900877999',
    'AVERY QUINN',
    '09/10/2026',
    '09/10/2026',
    2026,
    9,
    'Homeowners',
    '330-OK-0001',
    'Homeowners',
    '',
    'New Issued Transaction - First Term',
    1,
    1200,
    'New Policy Issued',
    'Agency',
    'Agency',
    '',
    'Agency',
    'Without Facility Auto',
    'Agency',
  ];

  /** Upload as the owner does: presign, the browser's PUT, then the run. */
  async function uploadReport(bytes: Buffer, filename: string) {
    const presigned = await api()
      .post(`${base}/runs/presign`)
      .set(authHeader(ownerToken))
      .send({ filename, size: bytes.byteLength })
      .expect(201);
    const { key } = presigned.body as ReconciliationPresignResponse;
    await storage.putObject(
      key,
      bytes,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    const run = await api()
      .post(`${base}/runs`)
      .set(authHeader(ownerToken))
      .send({
        storageKey: key,
        uploadedFilename: filename,
        size: bytes.byteLength,
      })
      .expect(201);
    return run.body as ReconciliationRunDetail;
  }
  const rowsOf = async (runId: string, q: string) =>
    (
      (
        await api()
          .get(`${base}/runs/${runId}/rows`)
          .query({ q, pageSize: 100 })
          .set(authHeader(ownerToken))
          .expect(200)
      ).body as ReconciliationRowListResponse
    ).items;

  describe('the next upload', () => {
    beforeAll(async () => {
      // A report is refused for an agency with no Allstate agent code.
      await agencies.updateOne(
        { _id: ctx.agencyId },
        {
          $set: {
            carrierAppointments: [
              {
                carrierId,
                carrierAgencyCode: '0B9049',
                codeKey: 'A0B9049',
                isPrimary: true,
                active: true,
              },
            ],
          },
        },
      );
    });

    it('opens a welcome call that never opened before the next upload replaces the row', async () => {
      const number = '900877002';
      const first = await uploadReport(
        dashFile(
          [directLine(number), agencyLine],
          'Thu, 08 Oct 2026 09:00:00 GMT',
        ),
        'NB-Sep-2026-pending.xlsx',
      );
      const [line] = (await rowsOf(first.id, number)).filter(
        (r) => r.dash?.policyNumber === number,
      );
      await assign(
        { runId: first.id, rowId: line.id, policyNumber: number },
        csrId,
      ).expect(200);
      const served = (
        await setUp(
          { runId: first.id, rowId: line.id, policyNumber: number },
          201,
        )
      ).body as ReconciliationServiceIntakeResponse;
      await onboardings.deleteOne({ _id: served.onboardingId });
      await tickets.deleteOne({ _id: served.ticketId });
      await backToStartOnboarding(line.id);

      const second = await uploadReport(
        dashFile(
          [directLine(number), agencyLine],
          'Fri, 09 Oct 2026 09:00:00 GMT',
        ),
        'NB-Sep-2026-pending-again.xlsx',
      );
      const [matched] = (await rowsOf(second.id, number)).filter(
        (r) => r.dash?.policyNumber === number,
      );
      expect(matched).toMatchObject({ match: 'matched', tabs: ['matched'] });
      expect(matched.outcome).toMatchObject({
        kind: 'service_intake',
        status: 'done',
        policyId: served.policyId,
        onboardingId: expect.any(String) as unknown,
        ticketId: expect.any(String) as unknown,
      });
      expect(matched.review.resolution).toBe('service_intake_recorded');
      const welcome = await tickets.findById(matched.outcome?.ticketId).lean();
      expect(String(welcome?.assignedUserId)).toBe(csrId);
    });

    it('carries a call that still cannot open, and keeps the new row asking until it does', async () => {
      const number = '900877003';
      const first = await uploadReport(
        dashFile(
          [directLine(number), agencyLine],
          'Sat, 10 Oct 2026 09:00:00 GMT',
        ),
        'NB-Sep-2026-held.xlsx',
      );
      const [line] = (await rowsOf(first.id, number)).filter(
        (r) => r.dash?.policyNumber === number,
      );
      await assign(
        { runId: first.id, rowId: line.id, policyNumber: number },
        csrId,
      ).expect(200);
      const served = (
        await setUp(
          { runId: first.id, rowId: line.id, policyNumber: number },
          201,
        )
      ).body as ReconciliationServiceIntakeResponse;
      await onboardings.deleteOne({ _id: served.onboardingId });
      await tickets.deleteOne({ _id: served.ticketId });
      await backToStartOnboarding(line.id);

      // CRM service off: the upload cannot open it, so it travels.
      let second: ReconciliationRunDetail | null = null;
      await withModule(ModuleKey.CrmService, false, async () => {
        second = await uploadReport(
          dashFile(
            [directLine(number), agencyLine],
            'Sun, 11 Oct 2026 09:00:00 GMT',
          ),
          'NB-Sep-2026-held-again.xlsx',
        );
      });
      const [carried] = (await rowsOf(second!.id, number)).filter(
        (r) => r.dash?.policyNumber === number,
      );
      expect(carried).toMatchObject({
        match: 'matched',
        tabs: ['matched'],
        needsReview: true,
        review: expect.objectContaining({ status: 'open' }) as unknown,
        outcome: expect.objectContaining({
          kind: 'service_intake',
          status: 'in_progress',
          step: 'start_onboarding',
          policyId: served.policyId,
        }) as unknown,
      });
      expect(carried.assignment?.user.id).toBe(csrId);

      // Back on: Continue on the new row opens it and decides the row.
      const continued = await record(
        { runId: second!.id, rowId: carried.id, policyNumber: number },
        { kind: 'service_intake' },
      ).expect(200);
      expect(
        (continued.body as ReconciliationAssignedRowDetail).outcome,
      ).toMatchObject({
        status: 'done',
        ticketId: expect.any(String) as unknown,
      });
      expect(
        (continued.body as ReconciliationAssignedRowDetail).review.resolution,
      ).toBe('service_intake_recorded');
      // Past the welcome call, the clean row asks nothing.
      expect((await stored(carried.id))?.needsReview).toBe(false);
    });

    /** Set up `number`, leave its call unopened, and re-upload with CRM service off. */
    async function carryPending(
      number: string,
      [firstAt, secondAt]: [string, string],
      appPremium?: number,
    ) {
      const day = (offset: number) => (offset ? secondAt : firstAt);
      const first = await uploadReport(
        dashFile([directLine(number), agencyLine], day(0)),
        `NB-Sep-2026-${number}.xlsx`,
      );
      const [line] = (await rowsOf(first.id, number)).filter(
        (r) => r.dash?.policyNumber === number,
      );
      await assign(
        { runId: first.id, rowId: line.id, policyNumber: number },
        csrId,
      ).expect(200);
      const served = (
        await setUp(
          { runId: first.id, rowId: line.id, policyNumber: number },
          201,
        )
      ).body as ReconciliationServiceIntakeResponse;
      await onboardings.deleteOne({ _id: served.onboardingId });
      await tickets.deleteOne({ _id: served.ticketId });
      await backToStartOnboarding(line.id);
      if (appPremium !== undefined) {
        await policies.updateOne(
          { _id: served.policyId },
          { $set: { premium: appPremium } },
        );
      }
      let second: ReconciliationRunDetail | null = null;
      await withModule(ModuleKey.CrmService, false, async () => {
        second = await uploadReport(
          dashFile([directLine(number), agencyLine], day(1)),
          `NB-Sep-2026-${number}-again.xlsx`,
        );
      });
      const [carried] = (await rowsOf(second!.id, number)).filter(
        (r) => r.dash?.policyNumber === number,
      );
      return {
        served,
        row: { runId: second!.id, rowId: carried.id, policyNumber: number },
        carried,
      };
    }

    it('leaves a premium Dash and the app now disagree on to the owner when the carried call opens', async () => {
      const { row, carried } = await carryPending(
        '900877004',
        ['Mon, 12 Oct 2026 09:00:00 GMT', 'Tue, 13 Oct 2026 09:00:00 GMT'],
        850,
      );
      expect(carried.tabs.sort()).toEqual(['matched', 'premium_mismatch']);
      expect(carried.outcome?.step).toBe('start_onboarding');

      const continued = (
        await record(row, { kind: 'service_intake' }).expect(200)
      ).body as ReconciliationAssignedRowDetail;
      expect(continued.outcome).toMatchObject({
        status: 'done',
        ticketId: expect.any(String) as unknown,
      });
      // The intake answers 1-800, not the premium: that stays open.
      expect(continued.review.status).toBe('open');
      const after = await stored(row.rowId);
      expect(after?.needsReview).toBe(true);
      expect(after?.assignment?.userId).toBe(csrId);

      // Off the assignee's list, still on the owner's Premium tab.
      const mine = (
        await api()
          .get(`${base}/assigned`)
          .set(authHeader(csrToken))
          .expect(200)
      ).body as { items: { id: string }[] };
      expect(mine.items.map((item) => item.id)).not.toContain(row.rowId);
      const premium = (
        await api()
          .get(`${base}/runs/${row.runId}/rows`)
          .query({ tab: 'premium_mismatch', reviewStatus: 'open' })
          .set(authHeader(ownerToken))
          .expect(200)
      ).body as ReconciliationRowListResponse;
      expect(premium.items.map((item) => item.id)).toContain(row.rowId);

      // The owner decides it; the finished intake stays as the record.
      await review(row, { status: 'resolved', resolution: 'other' }).expect(
        200,
      );
      expect((await stored(row.rowId))?.outcome?.status).toBe('done');
    });

    it('lets a carried row ask nothing again once the owner clears the call it could not open', async () => {
      const { row, carried } = await carryPending('900877005', [
        'Thu, 15 Oct 2026 09:00:00 GMT',
        'Fri, 16 Oct 2026 09:00:00 GMT',
      ]);
      expect(carried).toMatchObject({ tabs: ['matched'], needsReview: true });
      await withModule(ModuleKey.CrmService, false, async () => {
        await assign(row, null).expect(200);
      });
      const after = await stored(row.rowId);
      expect(after?.outcome).toBeNull();
      expect(after?.needsReview).toBe(false);
    });

    it('matches the serviced policy clean, carries what set it up, and misses it when Dash does', async () => {
      const number = '900877001';
      const first = await uploadReport(
        dashFile(
          [directLine(number), agencyLine],
          'Tue, 06 Oct 2026 09:00:00 GMT',
        ),
        'NB-Sep-2026.xlsx',
      );
      const [line] = (await rowsOf(first.id, number)).filter(
        (r) => r.dash?.policyNumber === number,
      );
      expect(line).toMatchObject({
        match: 'dash_only',
        tabs: ['review_1800'],
        bindIdStatus: 'not_staff',
      });
      await assign(
        { runId: first.id, rowId: line.id, policyNumber: number },
        csrId,
      ).expect(200);
      const served = (
        await setUp(
          { runId: first.id, rowId: line.id, policyNumber: number },
          201,
        )
      ).body as ReconciliationServiceIntakeResponse;

      // Next month's file — the same period again — lists the policy.
      const second = await uploadReport(
        dashFile(
          [directLine(number), agencyLine],
          'Tue, 03 Nov 2026 09:00:00 GMT',
        ),
        'NB-Sep-2026-again.xlsx',
      );
      expect(second.supersedesRunId).toBe(first.id);
      const [matched] = (await rowsOf(second.id, number)).filter(
        (r) => r.dash?.policyNumber === number,
      );
      expect(matched).toMatchObject({
        match: 'matched',
        tabs: ['matched'],
        needsReview: false,
        app: expect.objectContaining({
          policyId: served.policyId,
          origin: 'carrier_direct',
          dealId: null,
        }) as unknown,
      });
      expect(matched.issues).toEqual(
        expect.arrayContaining(['direct_1800', 'not_staff_bind_id']),
      );
      expect(matched.issues).not.toContain('no_app_producer');
      expect(matched.issues).not.toContain('direct_recorded_as_sale');
      // Who set it up, and what it created, stay on the owner's page.
      expect(matched.outcome).toMatchObject({
        kind: 'service_intake',
        status: 'done',
        policyId: served.policyId,
        householdId: served.householdId,
        ticketId: served.ticketId,
      });
      expect(matched.review).toMatchObject({
        status: 'resolved',
        resolution: 'service_intake_recorded',
        carriedForward: true,
      });

      // A file that leaves it out: Dash ought to list a policy it assigned.
      const third = await uploadReport(
        dashFile([agencyLine], 'Wed, 04 Nov 2026 09:00:00 GMT'),
        'NB-Sep-2026-short.xlsx',
      );
      const missing = (await rowsOf(third.id, number)).find(
        (r) => r.app?.policyId === served.policyId,
      );
      expect(missing).toMatchObject({
        match: 'app_only',
        tabs: ['not_in_dash'],
        app: expect.objectContaining({ origin: 'carrier_direct' }) as unknown,
      });
    });
  });

  describe('the owner’s side', () => {
    it('filters and exports it, refuses its resolution by hand, and reopening clears it', async () => {
      const row = await seedRow();
      const done = (await setUp(row, 201))
        .body as ReconciliationServiceIntakeResponse;

      const listed = (
        await api()
          .get(`${base}/runs/${row.runId}/rows`)
          .query({ outcome: 'service_intake' })
          .set(authHeader(ownerToken))
          .expect(200)
      ).body as ReconciliationRowListResponse;
      expect(listed.items.map((item) => item.id)).toEqual([row.rowId]);

      const csv = await api()
        .get(`${base}/runs/${row.runId}/export`)
        .query({ format: 'csv' })
        .set(authHeader(ownerToken))
        .expect(200);
      const [header, ...lines] = await new Promise<string[][]>(
        (resolve, reject) =>
          parse(csv.text, { bom: true }, (error, records: string[][]) =>
            error ? reject(error) : resolve(records),
          ),
      );
      const line = lines.find(
        (cells) => cells[header.indexOf('policy_number')] === row.policyNumber,
      )!;
      expect(line[header.indexOf('outcome')]).toBe('Service intake — done');

      await review(row, {
        status: 'resolved',
        resolution: 'service_intake_recorded',
      }).expect(400);

      await review(row, { status: 'open' }).expect(200);
      expect((await stored(row.rowId))?.outcome).toBeNull();
      // What it created stays — a reopen takes back the decision, not the client.
      expect(await policies.exists({ _id: oid(done.policyId) })).toBeTruthy();
    });
  });
});
