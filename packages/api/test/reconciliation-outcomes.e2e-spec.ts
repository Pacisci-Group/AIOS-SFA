import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { parse } from 'csv-parse';
import {
  ModuleKey,
  RECONCILIATION_ASSIGNEE_CANNOT_SELL,
  RECONCILIATION_CHARGEBACK_POLICY_UNMATCHED,
  RECONCILIATION_OUTCOME_FORBIDDEN,
  RECONCILIATION_OUTCOME_LOCKED,
  RECONCILIATION_OUTCOME_NOT_ALLOWED,
  RECONCILIATION_OUTCOME_RESOLUTIONS,
  type ReconciliationAssignedListResponse,
  type ReconciliationAssignedRowDetail,
  type ReconciliationCancelPolicyResponse,
  type ReconciliationOptionsResponse,
  type ReconciliationPrefill,
  type ReconciliationRowListResponse,
  type ReconciliationRowView,
  type ReconciliationRunDetail,
} from '@sfa/shared';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { ReconciliationOutcomesService } from '../src/carrier-reconciliation/reconciliation-outcomes.service';
import { ReconciliationRow } from '../src/carrier-reconciliation/schemas/reconciliation-row.schema';
import { ReconciliationRun } from '../src/carrier-reconciliation/schemas/reconciliation-run.schema';
import { Carrier } from '../src/carriers/schemas/carrier.schema';
import { Chargeback } from '../src/chargebacks/schemas/chargeback.schema';
import {
  reconciliationPolicyKey,
  type DashRow,
} from '../src/common/carrier-reconciliation/dash-file-reader';
import { Deal } from '../src/deals/schemas/deal.schema';
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
 * PAC-173 PR 4 — the assignee records what became of a Dash row: **Sold**,
 * **Cancel rewrite** or **Other** — and, since PR 6, **Chargeback**: the sale,
 * then the policy cancelled with its chargeback, dated on the carrier's day.
 *
 * Runs and rows are written straight to the models, as in the PR 3 suite: a
 * real run needs an uploaded xlsx, and nothing here is about reading one. The
 * rows carry a **full Dash line**, because the prefill is read off it and the
 * sale hook finds the Dash policy on a deal by its number key.
 *
 * The sale itself is booked through the real endpoints — `POST /leads`, the
 * NBA presign, `POST /sold-deals` — never by writing a deal, because what is
 * under test is that those two requests carry the row id and move the row on
 * after they commit. Object storage is a `FakeStorage`, so the new business
 * application the sale insists on is presigned, "uploaded" and verified for
 * real.
 *
 * Rows are seeded **already assigned** to the Test Producer, straight to the
 * model: the assignment rule for rows missing from the app is tested through
 * the endpoint, in its own block.
 */
const NOTIFICATION = 'notification/requested.v1';
const SECOND_PRODUCER_EMAIL = 'second-producer@sfa.local';

/** The Dash line's dates: written the 2nd, issued the 3rd. */
const WRITTEN = '2026-09-02';
const ISSUED = '2026-09-03';
/** When a cancel rewrite's replacement is booked. */
const REWRITE_DAY = '2026-09-20';
/** The carrier's cancellation dates: inside a month of the sale, and after it. */
const CANCELLED_INSIDE = '2026-09-20';
const CANCELLED_OUTSIDE = '2026-10-15';
/** The Dash line's written premium — what a chargeback takes back. */
const PREMIUM = 2210.5;

/** The smallest thing storage would call a PDF; only its type and size are read. */
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n');

interface SeededRow {
  runId: string;
  rowId: string;
  policyNumber: string;
}

type OutcomeBody = {
  kind?: string;
  note?: string | null;
};
type AssignBody = { userId: string | null; note?: string | null };

describe('Dash Reconciliation row outcomes (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestSeedContext;
  let inngest: CapturedInngestService;
  let storage: FakeStorage;
  let ownerToken: string;
  let producerToken: string;
  let csrToken: string;
  let secondToken: string;
  let ownerId: string;
  let producerId: string;
  let csrId: string;
  let secondId: string;
  let carrierId: Types.ObjectId;

  let users: Model<User>;
  let runs: Model<ReconciliationRun>;
  let rows: Model<ReconciliationRow>;
  let deals: Model<Deal>;
  let policies: Model<Policy>;
  let leads: Model<Lead>;
  let chargebacks: Model<Chargeback>;
  let households: Model<Household>;
  let roleAssignments: RoleAssignmentsService;

  let seq = 0;
  const api = () => request(app.getHttpServer());
  const base = '/api/v1/carrier-reconciliation';
  const oid = (id: string) => new Types.ObjectId(id);

  // ── The assignee's side ────────────────────────────────────────────────

  const record = (row: SeededRow, body: OutcomeBody, token = producerToken) =>
    api()
      .patch(`${base}/assigned/${row.rowId}/outcome`)
      .set(authHeader(token))
      .send(body);
  const detail = async (rowId: string, token = producerToken) =>
    (
      await api()
        .get(`${base}/assigned/${rowId}`)
        .set(authHeader(token))
        .expect(200)
    ).body as ReconciliationAssignedRowDetail;
  const assignedList = async (token: string) =>
    (await api().get(`${base}/assigned`).set(authHeader(token)).expect(200))
      .body as ReconciliationAssignedListResponse;
  /** Start a sale kind and hand back the prefill the forms are seeded from. */
  const start = async (
    row: SeededRow,
    kind: 'sold' | 'cancel_rewrite' | 'chargeback',
    note?: string,
  ) => {
    const res = await record(row, { kind, note }).expect(200);
    return (res.body as ReconciliationAssignedRowDetail).prefill!;
  };

  /** A Chargeback's second step: cancel the policy its sale booked (PR 6). */
  const cancelPolicy = (
    row: SeededRow,
    body: Record<string, unknown>,
    token = producerToken,
  ) =>
    api()
      .post(`${base}/assigned/${row.rowId}/cancel-policy`)
      .set(authHeader(token))
      .send(body);

  // ── The owner's side ───────────────────────────────────────────────────

  const review = (row: SeededRow, body: Record<string, unknown>) =>
    api()
      .patch(`${base}/runs/${row.runId}/rows/${row.rowId}/review`)
      .set(authHeader(ownerToken))
      .send(body);
  const assign = (row: SeededRow, body: AssignBody) =>
    api()
      .patch(`${base}/runs/${row.runId}/rows/${row.rowId}/assignment`)
      .set(authHeader(ownerToken))
      .send(body);
  const listRows = async (runId: string, query: Record<string, unknown>) =>
    (
      await api()
        .get(`${base}/runs/${runId}/rows`)
        .query(query)
        .set(authHeader(ownerToken))
        .expect(200)
    ).body as ReconciliationRowListResponse;
  const rowIds = async (runId: string, query: Record<string, unknown>) =>
    (await listRows(runId, query)).items.map((item) => item.id);
  const runDetail = async (runId: string) =>
    (
      await api()
        .get(`${base}/runs/${runId}`)
        .set(authHeader(ownerToken))
        .expect(200)
    ).body as ReconciliationRunDetail;
  const options = async () =>
    (
      (
        await api()
          .get(`${base}/options`)
          .set(authHeader(ownerToken))
          .expect(200)
      ).body as ReconciliationOptionsResponse
    ).assignees;
  const notifications = () =>
    inngest.sent.filter((event) => event.name === NOTIFICATION);

  /**
   * The row's line in the CSV export, by column, and the header — the order
   * of `assigned_to, outcome, outcome_note` is part of what the owner hands on.
   */
  async function exported(row: SeededRow) {
    const res = await api()
      .get(`${base}/runs/${row.runId}/export`)
      .query({ format: 'csv' })
      .set(authHeader(ownerToken))
      .expect(200);
    const [header, ...lines] = await new Promise<string[][]>(
      (resolve, reject) =>
        parse(res.text, { bom: true }, (error, records: string[][]) =>
          error ? reject(error) : resolve(records),
        ),
    );
    const cells = lines.find(
      (line) => line[header.indexOf('policy_number')] === row.policyNumber,
    );
    return {
      header,
      line: Object.fromEntries(
        header.map((key, index) => [key, cells?.[index] ?? null]),
      ),
    };
  }

  const stored = async (rowId: string) => rows.findById(rowId).lean();

  // ── Booking the sale, as the New Lead and Sold forms do ────────────────

  let person = 0;
  /**
   * The New Lead form's body, seeded from the prefill. The birthday is unique
   * per lead: the contact matcher folds a same-name, same-birthday person
   * into one contact, and each test's client is somebody new.
   */
  const leadBody = (
    row: SeededRow,
    prefill: ReconciliationPrefill,
    extra: Record<string, unknown> = {},
  ) => {
    const n = ++person;
    return {
      createdDate: prefill.lead!.createdDate,
      primaryContact: {
        firstName: prefill.lead!.firstName,
        lastName: prefill.lead!.lastName,
        dateOfBirth: `${1940 + n}-04-12`,
        phone: `(555) 410-${1000 + n}`,
        email: `dash.client.${n}@example.com`,
      },
      address: {
        street: `${n} Dash Way`,
        city: 'Tulsa',
        state: 'OK',
        zip: '74101',
      },
      members: [],
      leadSourceId: ctx.leadSourceIds.other,
      reconciliationRowId: row.rowId,
      ...extra,
    };
  };
  const createLead = async (body: object, token = producerToken) =>
    (
      (
        await api()
          .post('/api/v1/leads')
          .set(authHeader(token))
          .send(body)
          .expect(201)
      ).body as { id: string }
    ).id;

  /** Presign the new business application, then the browser's PUT to storage. */
  const nba = async (leadId: string, token = producerToken) => {
    const res = await api()
      .post('/api/v1/sold-deals/documents/presign')
      .set(authHeader(token))
      .send({
        leadId,
        kind: 'new_business_application',
        filename: 'application.pdf',
        contentType: 'application/pdf',
        size: PDF.byteLength,
      })
      .expect(201);
    const { key } = res.body as { key: string };
    await storage.putObject(key, PDF, 'application/pdf');
    return {
      key,
      filename: 'application.pdf',
      contentType: 'application/pdf',
      size: PDF.byteLength,
    };
  };

  /** A policy row on the Sold form, seeded from the prefill as the wizard is. */
  const policyRow = async (
    leadId: string,
    prefill: ReconciliationPrefill,
    extra: Record<string, unknown> = {},
    token = producerToken,
  ) => ({
    policyType: prefill.policy.policyType,
    effectiveDate: prefill.policy.effectiveDate,
    carrier: prefill.policy.carrier,
    policyNumber: prefill.policy.policyNumber,
    premium: prefill.policy.premium,
    itemCount: prefill.policy.itemCount,
    newBusinessApplication: await nba(leadId, token),
    priorInsurance: { none: true },
    cancellation: { cancelled: false },
    ...extra,
  });
  const saleBody = async (
    row: SeededRow | null,
    leadId: string,
    prefill: ReconciliationPrefill,
    token = producerToken,
  ) => ({
    leadId,
    soldDate: prefill.policy.soldDate,
    submissionToken: `dash-sale-${++seq}-${leadId}`,
    ...(row ? { reconciliationRowId: row.rowId } : {}),
    policies: [await policyRow(leadId, prefill, {}, token)],
  });
  const sell = (body: object, token = producerToken) =>
    api().post('/api/v1/sold-deals').set(authHeader(token)).send(body);

  // ── Fixtures ───────────────────────────────────────────────────────────

  /** A finished upload for the seeded Allstate, current unless a re-upload replaced it. */
  async function seedRun(extra: Partial<ReconciliationRun> = {}) {
    const run = await runs.create({
      agencyId: ctx.agencyId,
      carrierId,
      status: 'ready',
      file: {
        storageKey: `agencies/${ctx.agencyId}/carrier-reconciliation/ro-${++seq}.xlsx`,
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
      ...extra,
    });
    return run._id.toString();
  }

  /** A Dash line as the reader stores it — every field, the key consistent with the number. */
  function dashLine(n: number, extra: Partial<DashRow> = {}): DashRow {
    const policyNumber =
      extra.policyNumber ?? `9003${String(n).padStart(5, '0')}`;
    return {
      rowNumber: n,
      agentNumber: '0B9049',
      subProducerCode: '101',
      subProducerName: 'TEST PRODUCER',
      bindId: 'SOKTESTP',
      bindIdKey: 'SOKTESTP',
      bindIdName: 'TEST PRODUCER',
      policyNumber,
      policyKey: reconciliationPolicyKey(policyNumber),
      customerName: "MARY-JANE O'NEIL SMITH",
      issuedDate: ISSUED,
      dateWritten: WRITTEN,
      product: 'Homeowners',
      productDescription: 'Homeowners',
      lineGroup: '330-OK-0001',
      packageName: null,
      transactionType: 'New Issued Transaction - First Term',
      dispositionCode: 'New Policy Issued',
      itemCount: 1,
      writtenPremium: 2210.5,
      channel: 'Agency',
      channelIndicator: 'Agency',
      scenarioName: 'Agency',
      ...extra,
    };
  }

  /**
   * A Dash line missing from the app, waiting on a decision, assigned to the
   * Test Producer unless told otherwise.
   */
  async function seedRow(
    runId?: string,
    extra: Partial<ReconciliationRow> = {},
  ): Promise<SeededRow> {
    const run = runId ?? (await seedRun());
    const n = ++seq;
    const dash = 'dash' in extra ? (extra.dash ?? null) : dashLine(n);
    const row = await rows.create({
      agencyId: ctx.agencyId,
      runId: oid(run),
      rowKey: `ro-row-${n}`,
      side: 'dash',
      match: 'dash_only',
      dash,
      credit: { name: null, userId: null, via: 'none' },
      producerKey: 'none',
      tabs: ['missing_from_app'],
      needsReview: true,
      review: {
        status: 'open',
        resolution: null,
        note: null,
        reviewedById: null,
        reviewedAt: null,
        carriedForwardFromRowId: null,
      },
      assignment: assignedTo(producerId),
      ...extra,
    });
    return {
      runId: run,
      rowId: row._id.toString(),
      policyNumber: dash?.policyNumber ?? '',
    };
  }

  /** Stored as the service writes it. */
  const assignedTo = (userId: string) => ({
    userId,
    assignedById: ownerId,
    assignedAt: new Date(),
    note: null,
  });

  const decided = (status: 'resolved' | 'dismissed') => ({
    status,
    resolution: status === 'resolved' ? ('entered_in_app' as const) : null,
    note: null,
    reviewedById: ownerId,
    reviewedAt: new Date(),
    carriedForwardFromRowId: null,
  });

  beforeAll(async () => {
    inngest = new CapturedInngestService();
    storage = new FakeStorage();
    app = await createTestApp({
      overrides: [
        { provide: InngestService, useValue: inngest },
        { provide: StorageService, useValue: storage.asService() },
      ],
    });
    const model = <T>(name: string) => app.get<Model<T>>(getModelToken(name));
    users = model(User.name);
    runs = model(ReconciliationRun.name);
    rows = model(ReconciliationRow.name);
    deals = model(Deal.name);
    policies = model(Policy.name);
    leads = model(Lead.name);
    chargebacks = model(Chargeback.name);
    households = model(Household.name);
    roleAssignments = app.get(RoleAssignmentsService);

    // Drop BEFORE seeding — suites share one database and jest reorders them.
    await dropTestDatabase(app);
    ctx = await seedTestData(app);

    // The carrier the runs are for, so the prefill can name it. Not the core
    // seed's: under test the catalog is empty, and no number pattern is set,
    // so nothing here leans on Allstate's digits-only rule.
    const carrier = await model<Carrier>(Carrier.name).create({
      agencyId: null,
      name: 'Allstate',
      slug: 'allstate',
      active: true,
    });
    carrierId = carrier._id;

    // A second seller — someone to hand a row on to, and someone whose row
    // it is not.
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
    secondToken = (await login(app, SECOND_PRODUCER_EMAIL, TEST_PASSWORD))
      .accessToken;
    const owner = await users.findOne({ email: ctx.ownerEmail }).lean();
    ownerId = owner!._id.toString();
    const producer = await users.findOne({ email: ctx.producerEmail }).lean();
    producerId = producer!._id.toString();
    csrId = ctx.csrUserId;
  });

  afterAll(async () => {
    await dropTestDatabase(app);
    await closeTestApp(app);
  });

  beforeEach(async () => {
    await Promise.all([runs.deleteMany({}), rows.deleteMany({})]);
    inngest.sent.length = 0;
  });

  describe('who a row missing from the app can go to', () => {
    it('marks on the picker who can book a sale', async () => {
      const assignees = await options();

      expect(assignees).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: producerId, canRecordSale: true }),
          expect.objectContaining({ id: secondId, canRecordSale: true }),
          // The CSR template holds `leads:write` but not `deal_audits:write`.
          expect.objectContaining({ id: csrId, canRecordSale: false }),
        ]),
      );
    });

    it('refuses it to someone who cannot book a sale, who may still take any other row', async () => {
      const missing = await seedRow(undefined, { assignment: null });

      const res = await assign(missing, { userId: csrId }).expect(400);
      expect((res.body as { code: string }).code).toBe(
        RECONCILIATION_ASSIGNEE_CANNOT_SELL,
      );
      expect((await stored(missing.rowId))?.assignment).toBeNull();
      expect(notifications()).toHaveLength(0);

      // A row in any other tab only ever takes Other.
      const review1800 = await seedRow(undefined, {
        assignment: null,
        tabs: ['review_1800'],
      });
      await assign(review1800, { userId: csrId }).expect(200);
    });

    it('goes by permission, not role: a CSR the agency lets sell qualifies', async () => {
      await roleAssignments.setUserOverrides(
        ctx.agencyId,
        csrId,
        ['deal_audits:write'],
        [],
      );
      try {
        expect(await options()).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: csrId, canRecordSale: true }),
          ]),
        );
        const row = await seedRow(undefined, { assignment: null });

        await assign(row, { userId: csrId }).expect(200);
        await record(row, { kind: 'sold' }, csrToken).expect(200);
      } finally {
        await roleAssignments.setUserOverrides(ctx.agencyId, csrId, [], []);
      }
    });
  });

  describe('Other', () => {
    it.each([
      ['no note', { kind: 'other' }],
      ['a blank note', { kind: 'other', note: '   ' }],
      ['a null note', { kind: 'other', note: null }],
    ])(
      'needs a note to say what became of it — %s is a 400',
      async (_label, body) => {
        const row = await seedRow();

        const res = await record(row, body).expect(400);
        expect(
          (res.body as { errors: { fieldErrors: Record<string, string[]> } })
            .errors.fieldErrors.note,
        ).toBeDefined();
        expect((await stored(row.rowId))?.outcome).toBeNull();
      },
    );

    it('finishes the row at once, decided by the assignee, and the owner sees it', async () => {
      const row = await seedRow();

      const res = await record(row, {
        kind: 'other',
        note: '  Client cancelled before it issued  ',
      }).expect(200);
      const view = res.body as ReconciliationAssignedRowDetail;
      expect(view.outcome).toMatchObject({
        kind: 'other',
        status: 'done',
        step: null,
        note: 'Client cancelled before it issued',
        leadId: null,
        dealId: null,
        startedBy: { id: producerId, name: 'Test Producer' },
        completedBy: { id: producerId, name: 'Test Producer' },
      });
      expect(view.outcome!.completedAt).toBe(view.outcome!.startedAt);
      // The decision is written in the same write, by whoever finished it.
      expect(view.review).toMatchObject({
        status: 'resolved',
        resolution: 'other_recorded',
        note: 'Client cancelled before it issued',
        reviewedBy: { id: producerId, name: 'Test Producer' },
        carriedForward: false,
      });
      expect(view.prefill).not.toBeNull();

      const raw = await stored(row.rowId);
      expect(typeof raw?.outcome?.startedById).toBe('string');
      expect(raw?.review.reviewedById).toBe(producerId);

      // Off my list — decided — but it still opens from the notification.
      expect((await assignedList(producerToken)).total).toBe(0);
      expect((await detail(row.rowId)).outcome?.kind).toBe('other');

      // The owner's page: on the row, in the filters, in the counts.
      expect(await rowIds(row.runId, { outcome: 'done' })).toEqual([row.rowId]);
      expect(await rowIds(row.runId, { outcome: 'other' })).toEqual([
        row.rowId,
      ]);
      expect(await rowIds(row.runId, { outcome: 'in_progress' })).toEqual([]);
      expect(await rowIds(row.runId, { outcome: 'sold' })).toEqual([]);
      const [ownerView] = (await listRows(row.runId, {})).items;
      expect(ownerView.outcome).toEqual(view.outcome);
      expect(await runDetail(row.runId)).toMatchObject({
        assigned: 0,
        inProgress: 0,
      });

      const { header, line } = await exported(row);
      const at = header.indexOf('assigned_to');
      expect(header.slice(at, at + 3)).toEqual([
        'assigned_to',
        'outcome',
        'outcome_note',
      ]);
      expect(line).toMatchObject({
        assigned_to: 'Test Producer',
        outcome: 'Other — done',
        outcome_note: 'Client cancelled before it issued',
      });
    });

    it('answers asking again with the row as it is — a double click', async () => {
      const row = await seedRow();
      const first = (
        await record(row, { kind: 'other', note: 'Not ours' }).expect(200)
      ).body as ReconciliationAssignedRowDetail;

      const again = (
        await record(row, { kind: 'other', note: 'Something else' }).expect(200)
      ).body as ReconciliationAssignedRowDetail;
      expect(again.outcome).toEqual(first.outcome);
      expect(again.review).toEqual(first.review);
    });

    it('refuses an outcome filter it does not know', async () => {
      const row = await seedRow();

      await api()
        .get(`${base}/runs/${row.runId}/rows`)
        .query({ outcome: 'sold_recorded' })
        .set(authHeader(ownerToken))
        .expect(400);
    });
  });

  describe('which outcomes a row can take, and who records them', () => {
    it.each(['sold', 'cancel_rewrite', 'chargeback'])(
      'refuses %s on a row that is not missing from the app',
      async (kind) => {
        const row = await seedRow(undefined, {
          side: 'both',
          match: 'matched',
          tabs: ['matched', 'premium_mismatch'],
          issues: ['premium_mismatch'],
        });

        const res = await record(row, { kind }).expect(400);
        expect((res.body as { code: string }).code).toBe(
          RECONCILIATION_OUTCOME_NOT_ALLOWED,
        );
        expect((await stored(row.rowId))?.outcome).toBeNull();

        // Other is what such a row takes.
        await record(row, { kind: 'other', note: 'Dash rounds it' }).expect(
          200,
        );
      },
    );

    /**
     * Checked on every call, not only when the row was handed over:
     * permissions can change in between.
     */
    it('refuses a sale kind to an assignee who can no longer book a sale, and still takes Other', async () => {
      const row = await seedRow();
      await roleAssignments.setUserOverrides(
        ctx.agencyId,
        producerId,
        [],
        ['deal_audits:write'],
      );
      try {
        for (const kind of ['sold', 'cancel_rewrite', 'chargeback']) {
          const res = await record(row, { kind }).expect(403);
          expect((res.body as { code: string }).code).toBe(
            RECONCILIATION_OUTCOME_FORBIDDEN,
          );
        }
        expect((await stored(row.rowId))?.outcome).toBeNull();

        await record(row, { kind: 'other', note: 'Not a sale' }).expect(200);
      } finally {
        await roleAssignments.setUserOverrides(
          ctx.agencyId,
          producerId,
          [],
          [],
        );
      }
    });

    it('answers 404 to anyone but the assignee — the owner included', async () => {
      const row = await seedRow();
      const nobodys = await seedRow(undefined, { assignment: null });
      // Another agency's row, naming this producer — ids are only strings.
      const foreign = await seedRow(undefined, {
        agencyId: ctx.otherAgencyId,
      });
      const body = { kind: 'other', note: 'Mine now' };

      await record(row, body, secondToken).expect(404);
      await record(row, body, csrToken).expect(404);
      // The owner reads every row, and records on none.
      await record(row, body, ownerToken).expect(404);
      await record(nobodys, body).expect(404);
      await record(foreign, body).expect(404);
      await record(
        { ...row, rowId: new Types.ObjectId().toHexString() },
        body,
      ).expect(404);

      for (const { rowId } of [row, nobodys, foreign]) {
        expect((await stored(rowId))?.outcome).toBeNull();
      }
    });

    it.each([
      ['a re-upload replaced', { supersededByRunId: new Types.ObjectId() }],
      ['that failed', { status: 'failed' as const }],
    ])('refuses a row on a run %s with a 409', async (_label, extra) => {
      const row = await seedRow(await seedRun(extra));

      await record(row, { kind: 'sold' }).expect(409);

      expect((await stored(row.rowId))?.outcome).toBeNull();
    });

    it.each([
      ['a resolved row', { review: decided('resolved') }],
      ['a dismissed row', { review: decided('dismissed') }],
      ['a row that needs no decision', { needsReview: false }],
    ])('refuses %s with a 409', async (_label, extra) => {
      const row = await seedRow(undefined, extra);

      await record(row, { kind: 'other', note: 'Too late' }).expect(409);

      expect((await stored(row.rowId))?.outcome).toBeNull();
    });

    it('refuses a kind it does not know', async () => {
      const row = await seedRow();

      await record(row, { kind: 'refund' }).expect(400);
      await record(row, { kind: 'other', note: 'x'.repeat(2001) }).expect(400);
    });
  });

  describe('the prefill', () => {
    it('reads the Dash line as the New Lead and Sold forms want it', async () => {
      const row = await seedRow(undefined, {
        dash: dashLine(++seq, { itemCount: null }),
      });

      const { prefill } = await detail(row.rowId);

      expect(prefill).toEqual({
        lead: {
          firstName: 'Mary-Jane',
          lastName: "O'Neil Smith",
          // The day Dash says it was written: a sale may not predate its lead.
          createdDate: WRITTEN,
        },
        policy: {
          policyNumber: row.policyNumber,
          policyType: 'Home',
          carrier: 'Allstate',
          premium: 2210.5,
          itemCount: 1,
          effectiveDate: ISSUED,
          soldDate: WRITTEN,
        },
        // Only a 1-800 row the app lacks offers a service intake (PR 5).
        serviceIntake: null,
      });
    });

    it('maps what it can, and leaves the rest for the form to ask', async () => {
      const auto = await seedRow(undefined, {
        dash: dashLine(++seq, {
          product: 'Non-Standard Auto',
          productDescription: 'Non-Standard Auto',
          itemCount: 3,
          dateWritten: null,
          customerName: 'CHER',
        }),
      });
      const unmapped = await seedRow(
        // A carrier the catalog does not have.
        await seedRun({ carrierId: new Types.ObjectId() }),
        {
          dash: dashLine(++seq, {
            product: 'Motor Club',
            productDescription: 'Motor Club',
            customerName: null,
          }),
        },
      );
      const appOnly = await seedRow(undefined, {
        side: 'app',
        match: 'app_only',
        tabs: ['not_in_dash'],
        dash: null,
      });

      expect((await detail(auto.rowId)).prefill).toMatchObject({
        lead: { firstName: 'Cher', lastName: '', createdDate: ISSUED },
        policy: {
          policyType: 'Auto',
          itemCount: 3,
          effectiveDate: ISSUED,
          soldDate: ISSUED,
        },
      });
      expect((await detail(unmapped.rowId)).prefill).toMatchObject({
        lead: null,
        policy: { policyType: null, carrier: null },
      });
      expect((await detail(appOnly.rowId)).prefill).toBeNull();
    });
  });

  describe('Sold, end to end', () => {
    it('books the Dash line as an ordinary sale, links what it booked, and credits the assignee', async () => {
      const row = await seedRow();

      const started = (
        await record(row, { kind: 'sold', note: 'Found it in Dash' }).expect(
          200,
        )
      ).body as ReconciliationAssignedRowDetail;
      expect(started.outcome).toMatchObject({
        kind: 'sold',
        status: 'in_progress',
        step: 'record_sale',
        note: 'Found it in Dash',
        leadId: null,
        dealId: null,
        startedBy: { id: producerId, name: 'Test Producer' },
        completedBy: null,
        completedAt: null,
      });
      expect(started.review.status).toBe('open');
      const prefill = started.prefill!;

      // Under way: still on my list, and counted on the owner's page.
      expect((await assignedList(producerToken)).total).toBe(1);
      expect(await runDetail(row.runId)).toMatchObject({
        assigned: 1,
        inProgress: 1,
      });
      expect(await rowIds(row.runId, { outcome: 'in_progress' })).toEqual([
        row.rowId,
      ]);
      expect(await rowIds(row.runId, { outcome: 'sold' })).toEqual([row.rowId]);
      expect((await exported(row)).line).toMatchObject({
        outcome: 'Sold — recording the sale',
        outcome_note: 'Found it in Dash',
      });

      // Step one: the lead, stamped on the row as soon as it exists.
      const leadId = await createLead(leadBody(row, prefill));
      expect((await stored(row.rowId))?.outcome).toMatchObject({
        status: 'in_progress',
        step: 'record_sale',
        leadId,
      });

      // Step two: the sale. A second line sold on the same visit is listed
      // first, so the Dash policy is found by its number, not its position.
      const body = {
        ...(await saleBody(row, leadId, prefill)),
        policies: [
          await policyRow(leadId, prefill, {
            policyType: 'Auto',
            policyNumber: `AUTO-${row.policyNumber}`,
            premium: 800,
            itemCount: 2,
          }),
          await policyRow(leadId, prefill),
        ],
      };
      const sale = await sell(body).expect(201);
      const dealId = (sale.body as { id: string }).id;

      const deal = await deals.findById(dealId).lean();
      // Credit is the assignee's: the sale path's own rule, unchanged.
      expect(String(deal?.producerId)).toBe(producerId);
      const dashPolicy = await policies
        .findOne({ dealId: oid(dealId), policyNumber: row.policyNumber })
        .lean();
      expect(dashPolicy).not.toBeNull();

      const done = await detail(row.rowId);
      expect(done.outcome).toMatchObject({
        kind: 'sold',
        status: 'done',
        step: null,
        note: 'Found it in Dash',
        leadId,
        dealId,
        policyId: String(dashPolicy!._id),
        householdId: String(deal?.householdId),
        replacementPolicyId: null,
        chargebackId: null,
        completedBy: { id: producerId, name: 'Test Producer' },
      });
      expect(done.review).toMatchObject({
        status: 'resolved',
        resolution: 'sold_recorded',
        note: 'Found it in Dash',
        reviewedBy: { id: producerId },
      });
      const raw = (await stored(row.rowId))!.outcome!;
      expect(typeof raw.dealId).toBe('string');
      expect(typeof raw.policyId).toBe('string');

      // Finished: off my list and out of the owner's in-progress count.
      expect((await assignedList(producerToken)).total).toBe(0);
      expect(await runDetail(row.runId)).toMatchObject({
        assigned: 0,
        inProgress: 0,
      });
      expect(await rowIds(row.runId, { outcome: 'done' })).toEqual([row.rowId]);
      expect((await exported(row)).line).toMatchObject({
        outcome: 'Sold — done',
      });

      // A replay of the same submission books nothing and changes nothing.
      const replay = await sell(body).expect(201);
      expect((replay.body as { id: string }).id).toBe(dealId);
      expect((await stored(row.rowId))?.outcome).toEqual(raw);
      expect(await deals.countDocuments({ leadId: oid(leadId) })).toBe(1);
    });

    it('makes the assignee a lead of their own, never one an address match would merge into', async () => {
      const row = await seedRow();
      const prefill = await start(row, 'sold');
      const body = leadBody(row, prefill);
      const stranger = {
        firstName: 'Someone',
        lastName: 'Else',
        dateOfBirth: '1970-01-01',
        phone: '(555) 499-0001',
        email: 'someone.else@example.com',
      };
      // An open lead at the same street and zip, the owner's.
      const theirs = await createLead(
        {
          primaryContact: stranger,
          address: body.address,
          members: [],
          leadSourceId: ctx.leadSourceIds.other,
        },
        ownerToken,
      );
      // Without a row, the 90-day address dedupe folds a new one into it.
      const folded = await createLead({
        primaryContact: { ...stranger, firstName: 'Another' },
        address: body.address,
        members: [],
        leadSourceId: ctx.leadSourceIds.other,
      });
      expect(folded).toBe(theirs);

      const mine = await createLead(body);

      expect(mine).not.toBe(theirs);
      const lead = await leads.findById(mine).lean();
      expect(String(lead?.producerId)).toBe(producerId);
      expect((await stored(row.rowId))?.outcome?.leadId).toBe(mine);
    });

    /**
     * The hook runs after the sale commits, so a request that died in
     * between leaves the row behind its sale — and the Sold form refuses a
     * second sale on a sold lead. Resuming the outcome finds the sale.
     */
    it('finishes on Continue a sale whose hook never ran', async () => {
      const row = await seedRow();
      const prefill = await start(row, 'sold', 'Booked from Dash');
      const leadId = await createLead(leadBody(row, prefill));
      const sale = await sell(await saleBody(null, leadId, prefill)).expect(
        201,
      );
      expect((await stored(row.rowId))?.outcome).toMatchObject({
        status: 'in_progress',
        dealId: null,
      });

      const resumed = (await record(row, { kind: 'sold' }).expect(200))
        .body as ReconciliationAssignedRowDetail;

      expect(resumed.outcome).toMatchObject({
        status: 'done',
        leadId,
        dealId: (sale.body as { id: string }).id,
        note: 'Booked from Dash',
      });
      expect(resumed.review).toMatchObject({
        status: 'resolved',
        resolution: 'sold_recorded',
      });
    });

    it('resumes an outcome under way, keeping its note unless a new one is sent', async () => {
      const row = await seedRow();
      const first = (
        (await record(row, { kind: 'sold', note: 'Call first' }).expect(200))
          .body as ReconciliationAssignedRowDetail
      ).outcome!;

      const again = (
        (await record(row, { kind: 'sold' }).expect(200))
          .body as ReconciliationAssignedRowDetail
      ).outcome!;
      // Resumed, not restarted.
      expect(again).toEqual(first);

      const noted = (
        (
          await record(row, {
            kind: 'sold',
            note: 'Called; booking it',
          }).expect(200)
        ).body as ReconciliationAssignedRowDetail
      ).outcome!;
      expect(noted).toMatchObject({
        note: 'Called; booking it',
        startedAt: first.startedAt,
      });
    });

    it('follows a re-upload to the current copy of the row the page held', async () => {
      const current = await seedRun();
      const old = await seedRun({ supersededByRunId: oid(current) });
      const stale = await seedRow(old, { rowKey: 'ro-same-line' });
      const fresh = await seedRow(current, { rowKey: 'ro-same-line' });

      // Writes never follow: a page holding the replaced row reloads.
      await record(stale, { kind: 'sold' }).expect(409);
      const prefill = await start(fresh, 'sold');

      // The forms kept the id the old notification opened; the hooks follow it.
      const leadId = await createLead(leadBody(stale, prefill));
      expect((await stored(fresh.rowId))?.outcome?.leadId).toBe(leadId);
      await sell(await saleBody(stale, leadId, prefill)).expect(201);

      expect((await stored(fresh.rowId))?.outcome?.status).toBe('done');
      expect((await stored(stale.rowId))?.outcome).toBeNull();
    });

    /**
     * Both hooks run on a submission-token replay too: a request that
     * committed and died before its hook ran is retried by the form, and the
     * retry is what moves the row on. The first call of each is swallowed
     * here, exactly as if the request had died after its commit.
     */
    it('moves the row on from a retried request whose hook never ran', async () => {
      const outcomes = app.get(ReconciliationOutcomesService);
      const row = await seedRow();
      const prefill = await start(row, 'sold');
      const lead = {
        ...leadBody(row, prefill),
        submissionToken: `dash-lead-${row.rowId}`,
      };
      const linkLead = jest
        .spyOn(outcomes, 'linkLead')
        .mockResolvedValueOnce(undefined);
      const recordSale = jest
        .spyOn(outcomes, 'recordSale')
        .mockResolvedValueOnce(undefined);
      try {
        const leadId = await createLead(lead);
        expect((await stored(row.rowId))?.outcome?.leadId).toBeNull();
        expect(await createLead(lead)).toBe(leadId);
        expect((await stored(row.rowId))?.outcome?.leadId).toBe(leadId);

        const sale = await saleBody(row, leadId, prefill);
        const dealId = ((await sell(sale).expect(201)).body as { id: string })
          .id;
        expect((await stored(row.rowId))?.outcome?.status).toBe('in_progress');
        const replay = await sell(sale).expect(201);
        expect((replay.body as { id: string }).id).toBe(dealId);
        expect((await stored(row.rowId))?.outcome).toMatchObject({
          status: 'done',
          dealId,
        });
      } finally {
        linkLead.mockRestore();
        recordSale.mockRestore();
      }
    });

    it('leaves the row alone while Dash Reconciliation is off for the agency', async () => {
      const row = await seedRow();
      const prefill = await start(row, 'sold');
      const agencies = app.get<Model<Agency>>(getModelToken(Agency.name));
      const resolver = app.get(AccessResolverService);
      const path = `modules.${ModuleKey.CarrierReconciliation}.enabled`;

      await agencies.updateOne(
        { _id: ctx.agencyId },
        { $set: { [path]: false } },
      );
      await resolver.invalidateAgency(ctx.agencyId);
      try {
        // The lead and the sale are booked all the same.
        const leadId = await createLead(leadBody(row, prefill));
        await sell(await saleBody(row, leadId, prefill)).expect(201);
      } finally {
        await agencies.updateOne(
          { _id: ctx.agencyId },
          { $set: { [path]: true } },
        );
        await resolver.invalidateAgency(ctx.agencyId);
      }

      expect((await stored(row.rowId))?.outcome).toMatchObject({
        status: 'in_progress',
        leadId: null,
        dealId: null,
      });
    });

    it("changes nothing on a row that is not the seller's", async () => {
      const row = await seedRow();
      const prefill = await start(row, 'sold');

      // A colleague's lead and sale, naming the producer's row.
      const leadId = await createLead(leadBody(row, prefill), secondToken);
      await sell(
        await saleBody(row, leadId, prefill, secondToken),
        secondToken,
      ).expect(201);

      expect((await stored(row.rowId))?.outcome).toMatchObject({
        status: 'in_progress',
        leadId: null,
        dealId: null,
      });
    });
  });

  describe('Cancel rewrite, end to end', () => {
    it('books the sale, then its replacement, and links the rewrite and its chargeback', async () => {
      const row = await seedRow();
      const prefill = await start(row, 'cancel_rewrite', 'Rewritten in Sept');
      const first = leadBody(row, prefill);
      const leadId = await createLead(first);

      // The sale: linked, and on to the replacement.
      const body = await saleBody(row, leadId, prefill);
      const dealId = ((await sell(body).expect(201)).body as { id: string }).id;
      const dashPolicy = await policies.findOne({ dealId: oid(dealId) }).lean();
      const writing = await detail(row.rowId);
      expect(writing.outcome).toMatchObject({
        kind: 'cancel_rewrite',
        status: 'in_progress',
        step: 'write_replacement',
        leadId,
        dealId,
        policyId: String(dashPolicy!._id),
        replacementPolicyId: null,
      });
      expect(writing.review.status).toBe('open');
      expect(await runDetail(row.runId)).toMatchObject({ inProgress: 1 });
      expect((await exported(row)).line).toMatchObject({
        outcome: 'Cancel rewrite — writing the replacement',
        outcome_note: 'Rewritten in Sept',
      });

      // The sale again is not its replacement.
      await sell(body).expect(201);
      expect((await detail(row.rowId)).outcome).toEqual(writing.outcome);
      // Booked: what it is recorded as is settled.
      const locked = await record(row, { kind: 'sold' }).expect(409);
      expect((locked.body as { code: string }).code).toBe(
        RECONCILIATION_OUTCOME_LOCKED,
      );

      // The replacement, through the normal cancel-rewrite chain. Its own
      // lead is not stamped on the row: the outcome keeps the sale's.
      const replacementLeadId = await createLead({
        ...first,
        createdDate: REWRITE_DAY,
        replacementIntent: {
          policyId: String(dashPolicy!._id),
          reason: 'cancel_rewrite',
        },
      });
      expect((await stored(row.rowId))?.outcome?.leadId).toBe(leadId);
      const rewrite = await sell({
        leadId: replacementLeadId,
        soldDate: REWRITE_DAY,
        submissionToken: `dash-rewrite-${row.rowId}`,
        reconciliationRowId: row.rowId,
        policies: [
          await policyRow(replacementLeadId, prefill, {
            policyNumber: `${row.policyNumber}R`,
            effectiveDate: REWRITE_DAY,
            premium: 2400,
          }),
        ],
      }).expect(201);

      const replacement = await policies
        .findOne({ transferredFromPolicyId: dashPolicy!._id })
        .lean();
      expect(String(replacement?.dealId)).toBe(
        (rewrite.body as { id: string }).id,
      );
      const chargeback = await chargebacks
        .findOne({ policyId: dashPolicy!._id, reason: 'cancel_rewrite' })
        .lean();
      expect(chargeback).not.toBeNull();

      const done = await detail(row.rowId);
      expect(done.outcome).toMatchObject({
        kind: 'cancel_rewrite',
        status: 'done',
        step: null,
        leadId,
        dealId,
        policyId: String(dashPolicy!._id),
        replacementPolicyId: String(replacement!._id),
        chargebackId: String(chargeback!._id),
        completedBy: { id: producerId },
      });
      expect(done.review).toMatchObject({
        status: 'resolved',
        resolution: 'cancel_rewrite_recorded',
        note: 'Rewritten in Sept',
        reviewedBy: { id: producerId },
      });
      expect((await exported(row)).line).toMatchObject({
        outcome: 'Cancel rewrite — done',
      });
    });

    /** Both hooks lost: one Continue walks the outcome through both steps. */
    it('finishes on Continue when neither the sale nor its replacement carried the row', async () => {
      const row = await seedRow();
      const prefill = await start(row, 'cancel_rewrite');
      const first = leadBody(row, prefill);
      const leadId = await createLead(first);
      const sale = await sell(await saleBody(null, leadId, prefill)).expect(
        201,
      );
      const dealId = (sale.body as { id: string }).id;
      const dashPolicy = await policies.findOne({ dealId: oid(dealId) }).lean();
      const replacementLeadId = await createLead({
        ...first,
        createdDate: REWRITE_DAY,
        reconciliationRowId: undefined,
        replacementIntent: {
          policyId: String(dashPolicy!._id),
          reason: 'cancel_rewrite',
        },
      });
      await sell({
        leadId: replacementLeadId,
        soldDate: REWRITE_DAY,
        policies: [
          await policyRow(replacementLeadId, prefill, {
            policyNumber: `${row.policyNumber}R`,
            effectiveDate: REWRITE_DAY,
          }),
        ],
      }).expect(201);
      expect((await stored(row.rowId))?.outcome).toMatchObject({
        step: 'record_sale',
        dealId: null,
      });

      const resumed = (
        await record(row, { kind: 'cancel_rewrite' }).expect(200)
      ).body as ReconciliationAssignedRowDetail;

      const replacement = await policies
        .findOne({ transferredFromPolicyId: dashPolicy!._id })
        .lean();
      const chargeback = await chargebacks
        .findOne({ policyId: dashPolicy!._id, reason: 'cancel_rewrite' })
        .lean();
      expect(resumed.outcome).toMatchObject({
        status: 'done',
        leadId,
        dealId,
        policyId: String(dashPolicy!._id),
        replacementPolicyId: String(replacement!._id),
        chargebackId: String(chargeback!._id),
      });
      expect(resumed.review.resolution).toBe('cancel_rewrite_recorded');
    });
  });

  describe('Chargeback, end to end', () => {
    /** Start a Chargeback and book its sale, as the New Lead and Sold forms do. */
    async function bookChargebackSale(row: SeededRow, note?: string) {
      const prefill = await start(row, 'chargeback', note);
      const leadId = await createLead(leadBody(row, prefill));
      const sale = await sell(await saleBody(row, leadId, prefill)).expect(201);
      const dealId = (sale.body as { id: string }).id;
      const dashPolicy = await policies.findOne({ dealId: oid(dealId) }).lean();
      return {
        prefill,
        leadId,
        dealId,
        policyId: String(dashPolicy!._id),
        householdId: String(dashPolicy!.householdId),
      };
    }

    /** Days from today, as the date input submits it. */
    const daysFromToday = (days: number) =>
      new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

    it('books the sale, then cancels it with the carrier’s date — inside the month, the credit comes back too', async () => {
      const row = await seedRow();
      const { leadId, dealId, policyId, householdId } =
        await bookChargebackSale(row, 'Carrier cancelled in Sept');

      const waiting = await detail(row.rowId);
      expect(waiting.outcome).toMatchObject({
        kind: 'chargeback',
        status: 'in_progress',
        step: 'cancel_policy',
        leadId,
        dealId,
        policyId,
        householdId,
        chargebackId: null,
      });
      expect(waiting.review.status).toBe('open');
      expect(await runDetail(row.runId)).toMatchObject({ inProgress: 1 });
      expect((await exported(row)).line).toMatchObject({
        outcome: 'Chargeback — cancelling the policy',
      });
      // Booked: what it is recorded as is settled.
      const locked = await record(row, { kind: 'sold' }).expect(409);
      expect((locked.body as { code: string }).code).toBe(
        RECONCILIATION_OUTCOME_LOCKED,
      );
      // Continue with nothing cancelled yet: the row as it is.
      expect(
        (
          (await record(row, { kind: 'chargeback' }).expect(200))
            .body as ReconciliationAssignedRowDetail
        ).outcome,
      ).toEqual(waiting.outcome);

      const res = await cancelPolicy(row, {
        reason: 'other',
        note: '  Non-payment  ',
        cancelledOn: CANCELLED_INSIDE,
      }).expect(201);
      const answer = res.body as ReconciliationCancelPolicyResponse;

      const chargeback = await chargebacks
        .findOne({ policyId: oid(policyId), reason: 'cancellation' })
        .lean();
      expect(chargeback).toMatchObject({
        amount: PREMIUM,
        soldAdjustment: -PREMIUM,
        withinClawbackWindow: true,
        replacementPolicyId: null,
        source: 'app',
      });
      expect(String(chargeback!.dealId)).toBe(dealId);
      // Charged to the producer credited on the deal — here, the assignee.
      expect(String(chargeback!.producerId)).toBe(producerId);
      expect(chargeback!.producerName).toBeTruthy();
      expect(chargeback!.occurredAt.toISOString()).toBe(
        `${CANCELLED_INSIDE}T00:00:00.000Z`,
      );

      expect(answer.policy).toMatchObject({
        id: policyId,
        active: false,
        policyStatus: 'Cancelled',
        cancellation: {
          reason: 'other',
          note: 'Non-payment',
          cancelledOn: CANCELLED_INSIDE,
          chargebackId: String(chargeback!._id),
        },
      });
      expect(answer.row.outcome).toMatchObject({
        kind: 'chargeback',
        status: 'done',
        step: null,
        policyId,
        chargebackId: String(chargeback!._id),
        completedBy: { id: producerId },
      });
      expect(answer.row.review).toMatchObject({
        status: 'resolved',
        resolution: 'chargeback_recorded',
        note: 'Carrier cancelled in Sept',
        reviewedBy: { id: producerId },
      });

      const deal = await deals.findById(dealId).lean();
      expect(deal?.chargebackAdjustment).toBe(-PREMIUM);
      const household = await households.findById(householdId).lean();
      expect(household?.totalActivePolicies).toBe(0);
      expect((await exported(row)).line).toMatchObject({
        outcome: 'Chargeback — done',
      });
      expect(await runDetail(row.runId)).toMatchObject({ inProgress: 0 });
      // Off the assignee's list.
      expect(
        (await assignedList(producerToken)).items.map((item) => item.id),
      ).not.toContain(row.rowId);

      // Asking again — a double click — is the answer, unchanged.
      const again = (
        await cancelPolicy(row, {
          reason: 'sold',
          cancelledOn: CANCELLED_INSIDE,
        }).expect(201)
      ).body as ReconciliationCancelPolicyResponse;
      expect(again.row.outcome).toEqual(answer.row.outcome);
      expect(
        await chargebacks.countDocuments({ policyId: oid(policyId) }),
      ).toBe(1);

      // The policy's history names it.
      const history = await api()
        .get(`/api/v1/policies/${policyId}/history`)
        .set(authHeader(ownerToken))
        .expect(200);
      expect(
        (history.body as { entries: Record<string, unknown>[] }).entries,
      ).toEqual([
        expect.objectContaining({
          policyId,
          chargebackAmount: PREMIUM,
          withinClawbackWindow: true,
          chargebackReason: 'cancellation',
        }) as unknown,
      ]);
    });

    it('charges the premium back after the month without touching the credit — and the owner reopening leaves the cancel standing', async () => {
      const row = await seedRow();
      const { dealId, policyId } = await bookChargebackSale(row);

      await cancelPolicy(row, {
        reason: 'changed_carrier',
        cancelledOn: CANCELLED_OUTSIDE,
      }).expect(201);

      expect(
        await chargebacks
          .findOne({ policyId: oid(policyId), reason: 'cancellation' })
          .lean(),
      ).toMatchObject({
        amount: PREMIUM,
        soldAdjustment: 0,
        withinClawbackWindow: false,
      });
      expect((await deals.findById(dealId).lean())?.chargebackAdjustment).toBe(
        0,
      );

      // The owner takes the decision back: the outcome goes, the cancel and
      // its chargeback stay — the ledger is append-only.
      const reopened = await review(row, { status: 'open' }).expect(200);
      expect((reopened.body as ReconciliationRowView).outcome).toBeNull();
      expect((await policies.findById(policyId).lean())?.policyStatus).toBe(
        'Cancelled',
      );
      expect(
        await chargebacks.countDocuments({ policyId: oid(policyId) }),
      ).toBe(1);
    });

    it('cancels nothing until the sale is booked, on another kind, or for anyone but the assignee', async () => {
      const notStarted = await seedRow();
      const notBooked = await seedRow();
      const sold = await seedRow();
      const body = { reason: 'sold', cancelledOn: CANCELLED_INSIDE };

      let res = await cancelPolicy(notStarted, body).expect(400);
      expect((res.body as { code: string }).code).toBe(
        RECONCILIATION_OUTCOME_NOT_ALLOWED,
      );
      await start(sold, 'sold');
      res = await cancelPolicy(sold, body).expect(400);
      expect((res.body as { code: string }).code).toBe(
        RECONCILIATION_OUTCOME_NOT_ALLOWED,
      );
      await start(notBooked, 'chargeback');
      await cancelPolicy(notBooked, body).expect(409);

      const row = await seedRow();
      const { policyId } = await bookChargebackSale(row);
      await cancelPolicy(row, body, secondToken).expect(404);
      // The owner reads every row, and records on none.
      await cancelPolicy(row, body, ownerToken).expect(404);
      await cancelPolicy(row, body, csrToken).expect(404);

      expect((await stored(row.rowId))?.outcome).toMatchObject({
        step: 'cancel_policy',
      });
      expect((await policies.findById(policyId).lean())?.active).toBe(true);
      expect(
        await chargebacks.countDocuments({ policyId: oid(policyId) }),
      ).toBe(0);
    });

    it('refuses a carrier date in the future or before the sale, and a body it cannot read', async () => {
      const row = await seedRow();
      const { policyId } = await bookChargebackSale(row);

      for (const bad of [
        { reason: 'sold' },
        { reason: 'other', cancelledOn: CANCELLED_INSIDE },
        { reason: 'gone', cancelledOn: CANCELLED_INSIDE },
        { reason: 'sold', cancelledOn: '20/09/2026' },
      ]) {
        await cancelPolicy(row, bad).expect(400);
      }
      const future = await cancelPolicy(row, {
        reason: 'sold',
        cancelledOn: daysFromToday(3),
      }).expect(400);
      expect((future.body as { message: string }).message).toMatch(
        /cannot be in the future/,
      );
      const early = await cancelPolicy(row, {
        reason: 'sold',
        cancelledOn: '2026-09-01',
      }).expect(400);
      expect((early.body as { message: string }).message).toMatch(
        /cannot be before the sale/,
      );

      expect((await policies.findById(policyId).lean())?.active).toBe(true);
      expect(
        await chargebacks.countDocuments({ policyId: oid(policyId) }),
      ).toBe(0);
      expect((await stored(row.rowId))?.outcome?.status).toBe('in_progress');
    });

    it('needs the permission to book a sale for the cancel too', async () => {
      const row = await seedRow();
      const { policyId } = await bookChargebackSale(row);
      await roleAssignments.setUserOverrides(
        ctx.agencyId,
        producerId,
        [],
        ['deal_audits:write'],
      );
      try {
        const res = await cancelPolicy(row, {
          reason: 'sold',
          cancelledOn: CANCELLED_INSIDE,
        }).expect(403);
        expect((res.body as { code: string }).code).toBe(
          RECONCILIATION_OUTCOME_FORBIDDEN,
        );
      } finally {
        await roleAssignments.setUserOverrides(
          ctx.agencyId,
          producerId,
          [],
          [],
        );
      }
      expect(
        await chargebacks.countDocuments({ policyId: oid(policyId) }),
      ).toBe(0);
    });

    it('writes one chargeback when two cancels race', async () => {
      const row = await seedRow();
      const { policyId } = await bookChargebackSale(row);
      const body = { reason: 'sold', cancelledOn: CANCELLED_INSIDE };

      const statuses = (
        await Promise.all([cancelPolicy(row, body), cancelPolicy(row, body)])
      ).map((res) => res.status);

      expect(statuses).toContain(201);
      for (const status of statuses) expect([201, 409]).toContain(status);
      expect(
        await chargebacks.countDocuments({ policyId: oid(policyId) }),
      ).toBe(1);
      expect((await stored(row.rowId))?.outcome?.status).toBe('done');
    });

    it('finishes with a chargeback recorded from the household page — on Continue, or from the row', async () => {
      const onContinue = await seedRow();
      const fromRow = await seedRow();
      for (const row of [onContinue, fromRow]) {
        const { policyId, householdId } = await bookChargebackSale(row);
        await api()
          .post(`/api/v1/households/${householdId}/policies/${policyId}/cancel`)
          .set(authHeader(producerToken))
          .send({
            reason: 'sold',
            chargeback: { cancelledOn: CANCELLED_INSIDE },
          })
          .expect(201);
        const chargeback = await chargebacks
          .findOne({ policyId: oid(policyId), reason: 'cancellation' })
          .lean();

        const finished =
          row === onContinue
            ? ((await record(row, { kind: 'chargeback' }).expect(200))
                .body as ReconciliationAssignedRowDetail)
            : (
                (
                  await cancelPolicy(row, {
                    reason: 'sold',
                    cancelledOn: CANCELLED_INSIDE,
                  }).expect(201)
                ).body as ReconciliationCancelPolicyResponse
              ).row;
        expect(finished.outcome).toMatchObject({
          status: 'done',
          chargebackId: String(chargeback!._id),
        });
        expect(finished.review.resolution).toBe('chargeback_recorded');
        expect(
          await chargebacks.countDocuments({ policyId: oid(policyId) }),
        ).toBe(1);
      }
    });

    it('cancels only a policy numbered as the Dash line, and links it once the number is corrected', async () => {
      const row = await seedRow();
      const prefill = await start(row, 'chargeback');
      const leadId = await createLead(leadBody(row, prefill));
      // Two lines on the sale, neither numbered as Dash's: a guess would cancel
      // the wrong one.
      const sale = await sell({
        leadId,
        soldDate: prefill.policy.soldDate,
        submissionToken: `dash-sale-${++seq}-${leadId}`,
        reconciliationRowId: row.rowId,
        policies: [
          await policyRow(leadId, prefill, {
            policyNumber: `${row.policyNumber}1`,
            premium: 900,
          }),
          await policyRow(leadId, prefill, {
            policyNumber: `${row.policyNumber}2`,
          }),
        ],
      }).expect(201);
      const dealId = (sale.body as { id: string }).id;

      const waiting = await detail(row.rowId);
      expect(waiting.outcome).toMatchObject({
        step: 'cancel_policy',
        dealId,
        policyId: null,
      });
      expect(waiting.chargebackPolicy).toBeNull();
      const refused = await cancelPolicy(row, {
        reason: 'sold',
        cancelledOn: CANCELLED_INSIDE,
      }).expect(409);
      expect((refused.body as { code: string }).code).toBe(
        RECONCILIATION_CHARGEBACK_POLICY_UNMATCHED,
      );
      // Continue cannot link it either, yet.
      expect(
        (
          (await record(row, { kind: 'chargeback' }).expect(200))
            .body as ReconciliationAssignedRowDetail
        ).outcome?.policyId,
      ).toBeNull();

      // The assignee corrects the second line's number to Dash's.
      const corrected = await policies.findOneAndUpdate(
        { dealId: oid(dealId), policyNumber: `${row.policyNumber}2` },
        { $set: { policyNumber: row.policyNumber } },
        { new: true },
      );
      const continued = (await record(row, { kind: 'chargeback' }).expect(200))
        .body as ReconciliationAssignedRowDetail;
      expect(continued.outcome?.policyId).toBe(String(corrected!._id));
      expect(continued.chargebackPolicy).toMatchObject({
        id: String(corrected!._id),
        policyNumber: row.policyNumber,
        premium: PREMIUM,
      });

      await cancelPolicy(row, {
        reason: 'sold',
        cancelledOn: CANCELLED_INSIDE,
      }).expect(201);
      expect((await policies.findById(corrected!._id).lean())?.active).toBe(
        false,
      );
      const other = await policies
        .findOne({ dealId: oid(dealId), policyNumber: `${row.policyNumber}1` })
        .lean();
      expect(other?.active).toBe(true);
      expect(await chargebacks.countDocuments({ policyId: other!._id })).toBe(
        0,
      );
    });

    it('links the only policy on the sale even when its number differs from Dash', async () => {
      const row = await seedRow();
      const prefill = await start(row, 'chargeback');
      const leadId = await createLead(leadBody(row, prefill));
      const sale = await sell({
        leadId,
        soldDate: prefill.policy.soldDate,
        submissionToken: `dash-sale-${++seq}-${leadId}`,
        reconciliationRowId: row.rowId,
        policies: [
          await policyRow(leadId, prefill, {
            policyNumber: `${row.policyNumber}9`,
          }),
        ],
      }).expect(201);
      const only = await policies
        .findOne({ dealId: oid((sale.body as { id: string }).id) })
        .lean();

      expect((await detail(row.rowId)).outcome).toMatchObject({
        step: 'cancel_policy',
        policyId: String(only!._id),
      });
    });

    it('leaves the row waiting when the policy was cancelled without a chargeback', async () => {
      const row = await seedRow();
      const { policyId, householdId } = await bookChargebackSale(row);
      await api()
        .post(`/api/v1/households/${householdId}/policies/${policyId}/cancel`)
        .set(authHeader(producerToken))
        .send({ reason: 'sold' })
        .expect(201);

      await cancelPolicy(row, {
        reason: 'sold',
        cancelledOn: CANCELLED_INSIDE,
      }).expect(409);
      expect(
        (
          (await record(row, { kind: 'chargeback' }).expect(200))
            .body as ReconciliationAssignedRowDetail
        ).outcome,
      ).toMatchObject({ status: 'in_progress', step: 'cancel_policy' });
      expect(
        await chargebacks.countDocuments({ policyId: oid(policyId) }),
      ).toBe(0);
    });
  });

  describe('switching kind', () => {
    it('is allowed while nothing is booked, and keeps the lead', async () => {
      const row = await seedRow();
      const prefill = await start(row, 'sold');
      const leadId = await createLead(leadBody(row, prefill));

      const switched = (
        await record(row, { kind: 'cancel_rewrite' }).expect(200)
      ).body as ReconciliationAssignedRowDetail;
      expect(switched.outcome).toMatchObject({
        kind: 'cancel_rewrite',
        status: 'in_progress',
        step: 'record_sale',
        leadId,
      });

      // To a Chargeback too: nothing is booked yet.
      expect(
        (
          (await record(row, { kind: 'chargeback' }).expect(200))
            .body as ReconciliationAssignedRowDetail
        ).outcome,
      ).toMatchObject({ kind: 'chargeback', step: 'record_sale', leadId });

      const other = (
        await record(row, { kind: 'other', note: 'Not ours after all' }).expect(
          200,
        )
      ).body as ReconciliationAssignedRowDetail;
      expect(other.outcome).toMatchObject({
        kind: 'other',
        status: 'done',
        leadId,
      });
      expect(other.review.resolution).toBe('other_recorded');
    });

    it('is refused once a sale is booked on the lead, even one its hook never stamped', async () => {
      const row = await seedRow();
      const prefill = await start(row, 'sold');
      const leadId = await createLead(leadBody(row, prefill));
      await sell(await saleBody(null, leadId, prefill)).expect(201);

      for (const body of [
        { kind: 'cancel_rewrite' },
        { kind: 'other', note: 'Changed my mind' },
      ]) {
        const res = await record(row, body).expect(409);
        expect((res.body as { code: string }).code).toBe(
          RECONCILIATION_OUTCOME_LOCKED,
        );
      }
      expect((await stored(row.rowId))?.outcome).toMatchObject({
        kind: 'sold',
        status: 'in_progress',
      });
    });
  });

  describe("the owner's side", () => {
    it.each(RECONCILIATION_OUTCOME_RESOLUTIONS)(
      'refuses to decide a row as %s by hand',
      async (resolution) => {
        const row = await seedRow();

        const res = await review(row, {
          status: 'resolved',
          resolution,
        }).expect(400);
        expect((res.body as { message: string }).message).toBe(
          'Validation failed',
        );
        expect((await stored(row.rowId))?.review.status).toBe('open');
      },
    );

    it('reopening a row an outcome finished clears the outcome and hands the row back', async () => {
      const row = await seedRow();
      await record(row, { kind: 'other', note: 'Duplicate line' }).expect(200);

      const res = await review(row, { status: 'open' }).expect(200);
      const view = res.body as ReconciliationRowView;
      expect(view.review).toMatchObject({ status: 'open', resolution: null });
      expect(view.outcome).toBeNull();
      expect(view.assignment?.user.id).toBe(producerId);
      expect((await stored(row.rowId))?.outcome).toBeNull();

      // Back on their list, to record afresh.
      expect(
        (await assignedList(producerToken)).items.map((item) => item.id),
      ).toEqual([row.rowId]);
      await record(row, { kind: 'sold' }).expect(200);
    });

    it('deciding by hand while an outcome is under way clears it, and a later sale changes nothing', async () => {
      const row = await seedRow();
      const prefill = await start(row, 'sold');
      const leadId = await createLead(leadBody(row, prefill));

      const res = await review(row, {
        status: 'resolved',
        resolution: 'entered_in_app',
      }).expect(200);
      expect((res.body as ReconciliationRowView).outcome).toBeNull();

      // The sale is booked anyway; the row is the owner's decision.
      await sell(await saleBody(row, leadId, prefill)).expect(201);
      const after = await stored(row.rowId);
      expect(after?.outcome).toBeNull();
      expect(after?.review).toMatchObject({
        status: 'resolved',
        resolution: 'entered_in_app',
        reviewedById: ownerId,
      });
    });

    it('leaves a finished outcome alone when the owner changes the decision', async () => {
      const row = await seedRow();
      const done = (
        await record(row, { kind: 'other', note: 'Duplicate line' }).expect(200)
      ).body as ReconciliationAssignedRowDetail;

      const res = await review(row, { status: 'dismissed' }).expect(200);

      expect((res.body as ReconciliationRowView).outcome).toEqual(done.outcome);
    });

    it('handing the row on, or taking it back, clears an outcome under way; a note change does not', async () => {
      const row = await seedRow();
      await start(row, 'sold');

      // The same person, a new note: still theirs, still under way.
      const noted = await assign(row, {
        userId: producerId,
        note: 'Any luck?',
      }).expect(200);
      expect((noted.body as ReconciliationRowView).outcome).toMatchObject({
        status: 'in_progress',
      });

      // Someone else: they start over.
      const moved = await assign(row, { userId: secondId }).expect(200);
      expect((moved.body as ReconciliationRowView).outcome).toBeNull();
      await record(row, { kind: 'sold' }, secondToken).expect(200);

      // Nobody.
      const taken = await assign(row, { userId: null }).expect(200);
      expect((taken.body as ReconciliationRowView).outcome).toBeNull();
      expect((await stored(row.rowId))?.outcome).toBeNull();
    });

    it('keeps a finished outcome when the row is taken back', async () => {
      const row = await seedRow();
      await record(row, { kind: 'other', note: 'Duplicate line' }).expect(200);

      const taken = await assign(row, { userId: null }).expect(200);

      expect((taken.body as ReconciliationRowView).outcome).toMatchObject({
        kind: 'other',
        status: 'done',
      });
    });
  });
});
