import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import {
  ModuleKey,
  type ReconciliationAssignedListResponse,
  type ReconciliationAssignedRow,
  type ReconciliationOptionsResponse,
  type ReconciliationRowListResponse,
  type ReconciliationRowView,
  type ReconciliationRunDetail,
} from '@sfa/shared';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { ReconciliationRow } from '../src/carrier-reconciliation/schemas/reconciliation-row.schema';
import { ReconciliationRun } from '../src/carrier-reconciliation/schemas/reconciliation-run.schema';
import { InngestService } from '../src/inngest/inngest.service';
import { AccessResolverService } from '../src/permissions/access-resolver.service';
import { Agency } from '../src/platform/schemas/agency.schema';
import { User } from '../src/users/schemas/user.schema';
import { authHeader, login } from './helpers/auth.helper';
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
 * PAC-173 PR 3 — the owner hands a Dash Reconciliation row to a Producer or
 * CSR, who is notified and works it from their own page.
 *
 * Runs and rows are written straight to the models: a real run needs an
 * uploaded xlsx in storage, and nothing here is about reading one. What is
 * under test is the hand-off and the assignee's side of it, which is reached
 * with `leads:read` — no Producer or CSR holds `carrier_reconciliation:read`.
 *
 * Ids on these rows are **strings** (`agencyId`, `assignment.userId`), so the
 * stored shape is asserted as well as the response.
 */
const NOTIFICATION = 'notification/requested.v1';

interface SeededRow {
  runId: string;
  rowId: string;
}

type AssignBody = { userId: string | null; note?: string | null };

describe('Dash Reconciliation row assignment (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestSeedContext;
  let inngest: CapturedInngestService;
  let ownerToken: string;
  let producerToken: string;
  let csrToken: string;
  let ownerId: string;
  let producerId: string;
  let csrId: string;

  let users: Model<User>;
  let runs: Model<ReconciliationRun>;
  let rows: Model<ReconciliationRow>;

  let seq = 0;
  const api = () => request(app.getHttpServer());
  const base = '/api/v1/carrier-reconciliation';

  const assign = (row: SeededRow, body: AssignBody, token = ownerToken) =>
    api()
      .patch(`${base}/runs/${row.runId}/rows/${row.rowId}/assignment`)
      .set(authHeader(token))
      .send(body);
  const assigned = async (token: string, query: Record<string, unknown> = {}) =>
    (
      await api()
        .get(`${base}/assigned`)
        .query(query)
        .set(authHeader(token))
        .expect(200)
    ).body as ReconciliationAssignedListResponse;
  const rowIds = async (runId: string, query: Record<string, unknown>) =>
    (
      (
        await api()
          .get(`${base}/runs/${runId}/rows`)
          .query(query)
          .set(authHeader(ownerToken))
          .expect(200)
      ).body as ReconciliationRowListResponse
    ).items.map((item) => item.id);
  const runDetail = async (runId: string) =>
    (
      await api()
        .get(`${base}/runs/${runId}`)
        .set(authHeader(ownerToken))
        .expect(200)
    ).body as ReconciliationRunDetail;
  const notifications = () =>
    inngest.sent.filter((event) => event.name === NOTIFICATION);

  /** A finished upload, current unless a re-upload replaced it. */
  async function seedRun(extra: Partial<ReconciliationRun> = {}) {
    const run = await runs.create({
      agencyId: ctx.agencyId,
      carrierId: new Types.ObjectId(),
      status: 'ready',
      file: {
        storageKey: `agencies/${ctx.agencyId}/carrier-reconciliation/ra-${++seq}.xlsx`,
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

  /** A Dash line missing from the app, waiting on a decision, with nobody on it. */
  async function seedRow(
    runId?: string,
    extra: Partial<ReconciliationRow> = {},
  ): Promise<SeededRow> {
    const run = runId ?? (await seedRun());
    const row = await rows.create({
      agencyId: ctx.agencyId,
      runId: new Types.ObjectId(run),
      rowKey: `ra-row-${++seq}`,
      side: 'dash',
      match: 'dash_only',
      dash: {
        rowNumber: seq,
        policyNumber: 'DASH-0001',
        customerName: 'Jane Client',
        writtenPremium: 1200,
      },
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
      ...extra,
    });
    return { runId: run, rowId: row._id.toString() };
  }

  /** Stored as the service writes it, for rows a test seeds already assigned. */
  const assignedTo = (userId: string, assignedAt = new Date()) => ({
    userId,
    assignedById: ownerId,
    assignedAt,
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
    // Our own instance of the suite's stub, so the test can read what was sent.
    inngest = new CapturedInngestService();
    app = await createTestApp({
      overrides: [{ provide: InngestService, useValue: inngest }],
    });
    const model = <T>(name: string) => app.get<Model<T>>(getModelToken(name));
    users = model(User.name);
    runs = model(ReconciliationRun.name);
    rows = model(ReconciliationRow.name);

    // Drop BEFORE seeding — suites share one database and jest reorders them.
    await dropTestDatabase(app);
    ctx = await seedTestData(app);
    ownerToken = (await login(app, ctx.ownerEmail, TEST_PASSWORD)).accessToken;
    producerToken = (await login(app, ctx.producerEmail, TEST_PASSWORD))
      .accessToken;
    csrToken = (await login(app, ctx.csrEmail, TEST_PASSWORD)).accessToken;
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

  describe('options', () => {
    it('lists the agency’s Producers and CSRs, and nobody else', async () => {
      const res = await api()
        .get(`${base}/options`)
        .set(authHeader(ownerToken))
        .expect(200);
      const { assignees } = res.body as ReconciliationOptionsResponse;

      // `canRecordSale` (PAC-173 PR 4): only a Producer's template books a
      // sale, so only they can be given a row missing from the app.
      expect(assignees).toEqual(
        expect.arrayContaining([
          {
            id: producerId,
            name: 'Test Producer',
            email: ctx.producerEmail,
            roles: ['producer'],
            canRecordSale: true,
          },
          {
            id: csrId,
            name: 'Test Csr',
            email: ctx.csrEmail,
            roles: ['csr'],
            canRecordSale: false,
          },
        ]),
      );
      const ids = assignees.map((a) => a.id);
      // The owner assigns; they are not on the list. Nor is a role that
      // only reads, or a Producer in someone else's agency.
      expect(ids).not.toContain(ownerId);
      expect(ids).not.toContain(ctx.readOnlyUserId);
      expect(ids).not.toContain(ctx.otherAgencyUserId);
    });
  });

  describe('assigning', () => {
    it('hands an open row to a producer, who is notified exactly once', async () => {
      const row = await seedRow();

      const res = await assign(row, {
        userId: producerId,
        note: 'Check the premium',
      }).expect(200);
      const view = res.body as ReconciliationRowView;
      expect(view.assignment).toMatchObject({
        user: { id: producerId, name: 'Test Producer' },
        assignedBy: { id: ownerId, name: 'Test Owner' },
        note: 'Check the premium',
      });

      const stored = await rows.findById(row.rowId).lean();
      expect(typeof stored?.assignment?.userId).toBe('string');
      expect(stored?.assignment?.userId).toBe(producerId);

      expect(notifications()).toHaveLength(1);
      expect(notifications()[0].data).toEqual({
        type: 'reconciliation.row_assigned',
        recipientIds: [producerId],
        agencyId: ctx.agencyId,
        actorId: ownerId,
        entity: { kind: 'reconciliationRow', id: row.rowId },
        data: {
          rowId: row.rowId,
          runId: row.runId,
          policyNumber: 'DASH-0001',
          customerName: 'Jane Client',
          tabLabel: 'Missing from app',
          assignerName: 'Test Owner',
        },
        // The moment is part of the key: assigning the row away and back
        // later is a new notification, a retried send is not.
        dedupeKey: `reconciliation.row_assigned:${row.rowId}:${producerId}:${Date.parse(view.assignment!.assignedAt)}`,
      });

      // The owner's page shows it too: on the row, in the filter, in the count.
      expect(await rowIds(row.runId, { assignee: producerId })).toEqual([
        row.rowId,
      ]);
      expect((await runDetail(row.runId)).assigned).toBe(1);
    });

    it('stores an id sent in upper case the way rows compare it', async () => {
      const row = await seedRow();

      await assign(row, { userId: producerId.toUpperCase() }).expect(200);

      expect((await rows.findById(row.rowId).lean())?.assignment?.userId).toBe(
        producerId,
      );
      expect((await assigned(producerToken)).total).toBe(1);
    });

    it.each([
      ['the owner', () => ownerId],
      ['someone whose role is neither', () => ctx.readOnlyUserId],
      ['a Producer in another agency', () => ctx.otherAgencyUserId],
      ['nobody at all', () => new Types.ObjectId().toHexString()],
    ])('refuses %s with a 400', async (_label, userId) => {
      const row = await seedRow();

      await assign(row, { userId: userId() }).expect(400);

      expect((await rows.findById(row.rowId).lean())?.assignment).toBeNull();
      expect(notifications()).toHaveLength(0);
    });

    it.each([
      ['a resolved row', { review: decided('resolved') }],
      ['a dismissed row', { review: decided('dismissed') }],
      ['a row that needs no decision', { needsReview: false }],
    ])('refuses %s with a 409', async (_label, extra) => {
      const row = await seedRow(undefined, extra);

      await assign(row, { userId: producerId }).expect(409);

      expect((await rows.findById(row.rowId).lean())?.assignment).toBeNull();
      expect(notifications()).toHaveLength(0);
    });

    it.each([
      ['a re-upload replaced', { supersededByRunId: new Types.ObjectId() }],
      ['that failed', { status: 'failed' as const }],
    ])('refuses a row on a run %s with a 409', async (_label, extra) => {
      const row = await seedRow(await seedRun(extra));

      await assign(row, { userId: producerId }).expect(409);

      expect(notifications()).toHaveLength(0);
    });

    it('changes the note for the same person without notifying them again', async () => {
      const row = await seedRow();
      const first = (await assign(row, { userId: producerId }).expect(200))
        .body as ReconciliationRowView;
      inngest.sent.length = 0;

      const res = await assign(row, {
        userId: producerId,
        note: 'Call the client first',
      }).expect(200);
      const view = res.body as ReconciliationRowView;
      expect(view.assignment).toMatchObject({
        user: { id: producerId },
        note: 'Call the client first',
        // Still the same hand-off.
        assignedAt: first.assignment!.assignedAt,
      });
      expect(notifications()).toHaveLength(0);

      // Leaving the note out keeps it.
      const again = (await assign(row, { userId: producerId }).expect(200))
        .body as ReconciliationRowView;
      expect(again.assignment?.note).toBe('Call the client first');
      expect(notifications()).toHaveLength(0);
    });

    it('reassigns to a CSR, who is notified, and moves the row between their pages', async () => {
      // A 1-800 line: a row missing from the app goes only to someone who
      // can book a sale (PAC-173 PR 4), which a standard CSR cannot — that
      // rule is `reconciliation-outcomes.e2e-spec.ts`'s.
      const row = await seedRow(undefined, { tabs: ['review_1800'] });
      await assign(row, { userId: producerId }).expect(200);
      expect((await assigned(producerToken)).total).toBe(1);
      inngest.sent.length = 0;

      const res = await assign(row, { userId: csrId }).expect(200);
      const view = res.body as ReconciliationRowView;
      expect(view.assignment?.user.id).toBe(csrId);

      expect(notifications()).toHaveLength(1);
      expect(notifications()[0].data).toMatchObject({
        recipientIds: [csrId],
        dedupeKey: `reconciliation.row_assigned:${row.rowId}:${csrId}:${Date.parse(view.assignment!.assignedAt)}`,
      });

      expect((await assigned(producerToken)).items).toEqual([]);
      expect((await assigned(csrToken)).items.map((item) => item.id)).toEqual([
        row.rowId,
      ]);
      await api()
        .get(`${base}/assigned/${row.rowId}`)
        .set(authHeader(producerToken))
        .expect(404);
    });

    it('takes a row back without notifying anyone, and it reads as unassigned', async () => {
      const row = await seedRow();
      await assign(row, { userId: producerId }).expect(200);
      inngest.sent.length = 0;
      // A row stored before assignment existed has no field at all; the
      // filter must find it as well.
      const legacy = await seedRow(row.runId);
      await rows.updateOne(
        { _id: new Types.ObjectId(legacy.rowId) },
        { $unset: { assignment: 1 } },
      );

      const res = await assign(row, { userId: null }).expect(200);
      expect((res.body as ReconciliationRowView).assignment).toBeNull();
      expect(notifications()).toHaveLength(0);

      expect((await assigned(producerToken)).total).toBe(0);
      const unassigned = await rowIds(row.runId, { assignee: 'unassigned' });
      expect(unassigned).toEqual(
        expect.arrayContaining([row.rowId, legacy.rowId]),
      );
      expect(await rowIds(row.runId, { assignee: producerId })).toEqual([]);
      expect((await runDetail(row.runId)).assigned).toBe(0);
    });

    /**
     * The re-upload carried the assignment to its own copy of the row, which
     * is what the assignee's page reads — so that is where it changes, both
     * ways. Clearing this copy would change nothing anyone sees.
     */
    it('refuses to change who has a row on a run a re-upload replaced', async () => {
      const runId = await seedRun({ supersededByRunId: new Types.ObjectId() });
      const row = await seedRow(runId, { assignment: assignedTo(producerId) });

      await assign(row, { userId: null }).expect(409);

      expect((await rows.findById(row.rowId).lean())?.assignment).toMatchObject(
        { userId: producerId },
      );
    });
  });

  describe("the assignee's page", () => {
    it('lists my open rows with the upload each came from, and opens one', async () => {
      const row = await seedRow();
      await assign(row, { userId: producerId, note: 'Over to you' }).expect(
        200,
      );

      const list = await assigned(producerToken);
      expect(list).toMatchObject({
        total: 1,
        page: 1,
        totalPages: 1,
      });
      expect(list.items[0]).toMatchObject({
        id: row.rowId,
        runId: row.runId,
        assignment: {
          user: { id: producerId },
          assignedBy: { id: ownerId, name: 'Test Owner' },
          note: 'Over to you',
        },
        run: {
          id: row.runId,
          filename: 'NB-Details-Sep-2026.xlsx',
          startDate: '2026-09-01',
          endDate: '2026-09-30',
        },
      });

      const detail = await api()
        .get(`${base}/assigned/${row.rowId}`)
        .set(authHeader(producerToken))
        .expect(200);
      expect((detail.body as ReconciliationAssignedRow).id).toBe(row.rowId);
    });

    it('lists only open rows on current runs, oldest hand-off first, a page at a time', async () => {
      const runId = await seedRun();
      const later = await seedRow(runId, {
        assignment: assignedTo(producerId, new Date('2026-10-05T00:00:00Z')),
      });
      const earlier = await seedRow(runId, {
        assignment: assignedTo(producerId, new Date('2026-10-01T00:00:00Z')),
      });
      // None of these is on the list.
      await seedRow(runId, {
        assignment: assignedTo(producerId),
        review: decided('resolved'),
      });
      await seedRow(runId, {
        assignment: assignedTo(producerId),
        needsReview: false,
      });
      await seedRow(runId, { assignment: assignedTo(csrId) });
      await seedRow(
        await seedRun({ supersededByRunId: new Types.ObjectId(runId) }),
        { assignment: assignedTo(producerId) },
      );
      await seedRow(await seedRun({ status: 'failed' }), {
        assignment: assignedTo(producerId),
      });

      const all = await assigned(producerToken);
      expect(all.total).toBe(2);
      expect(all.items.map((item) => item.id)).toEqual([
        earlier.rowId,
        later.rowId,
      ]);

      const first = await assigned(producerToken, { pageSize: 1 });
      expect(first).toMatchObject({ total: 2, totalPages: 2, pageSize: 1 });
      expect(first.items.map((item) => item.id)).toEqual([earlier.rowId]);
    });

    /**
     * A decision replaces `review` whole and must not drop who the row is
     * with: the row leaves the list, but an old notification still opens it.
     */
    it('drops a decided row from my list, and still opens it from the notification', async () => {
      const row = await seedRow();
      await assign(row, { userId: producerId }).expect(200);

      const reviewed = await api()
        .patch(`${base}/runs/${row.runId}/rows/${row.rowId}/review`)
        .set(authHeader(ownerToken))
        .send({ status: 'resolved', resolution: 'entered_in_app' })
        .expect(200);
      expect((reviewed.body as ReconciliationRowView).assignment?.user.id).toBe(
        producerId,
      );

      expect((await assigned(producerToken)).total).toBe(0);
      expect((await runDetail(row.runId)).assigned).toBe(0);
      const detail = await api()
        .get(`${base}/assigned/${row.rowId}`)
        .set(authHeader(producerToken))
        .expect(200);
      expect((detail.body as ReconciliationAssignedRow).review.status).toBe(
        'resolved',
      );
    });
  });

  describe('a notification from before a re-upload', () => {
    /**
     * It names the row on the upload it was assigned on. The run a re-upload
     * replaced is frozen history; the current copy says where things stand.
     */
    it('opens the current copy of the row, while it is still theirs', async () => {
      const current = await seedRun();
      const old = await seedRun({
        supersededByRunId: new Types.ObjectId(current),
      });
      const stale = await seedRow(old, {
        rowKey: 'ra-same-line',
        assignment: assignedTo(producerId),
      });
      const fresh = await seedRow(current, {
        rowKey: 'ra-same-line',
        assignment: assignedTo(producerId),
      });
      const open = () =>
        api()
          .get(`${base}/assigned/${stale.rowId}`)
          .set(authHeader(producerToken));

      const opened = await open().expect(200);
      expect((opened.body as ReconciliationAssignedRow).id).toBe(fresh.rowId);

      // Handed to someone else on the current run: no longer theirs.
      await rows.updateOne(
        { _id: new Types.ObjectId(fresh.rowId) },
        { $set: { assignment: assignedTo(csrId) } },
      );
      await open().expect(404);

      // Gone from the newer file altogether.
      await rows.deleteOne({ _id: new Types.ObjectId(fresh.rowId) });
      await open().expect(404);
    });
  });

  describe('access', () => {
    it('lets neither a producer assign rows nor list who can take them', async () => {
      const row = await seedRow();

      await assign(row, { userId: producerId }, producerToken).expect(403);
      await api()
        .get(`${base}/options`)
        .set(authHeader(producerToken))
        .expect(403);
      expect((await rows.findById(row.rowId).lean())?.assignment).toBeNull();
    });

    it('keeps one assignee’s rows from a colleague', async () => {
      const row = await seedRow();
      await assign(row, { userId: producerId }).expect(200);

      await api()
        .get(`${base}/assigned/${row.rowId}`)
        .set(authHeader(csrToken))
        .expect(404);
      await api()
        .get(`${base}/assigned`)
        .query({ userId: csrId })
        .set(authHeader(producerToken))
        .expect(403);
    });

    it('lets whoever reads the whole report see anyone’s rows', async () => {
      const row = await seedRow();
      await assign(row, { userId: producerId }).expect(200);

      const list = await assigned(ownerToken, { userId: producerId });
      expect(list.items.map((item) => item.id)).toEqual([row.rowId]);
      await api()
        .get(`${base}/assigned/${row.rowId}`)
        .set(authHeader(ownerToken))
        .expect(200);
    });

    it('refuses the assignee’s page while the module is disabled', async () => {
      const row = await seedRow();
      await assign(row, { userId: producerId }).expect(200);
      const agencies = app.get<Model<Agency>>(getModelToken(Agency.name));
      const resolver = app.get(AccessResolverService);
      const path = `modules.${ModuleKey.CarrierReconciliation}.enabled`;

      await agencies.updateOne(
        { _id: ctx.agencyId },
        { $set: { [path]: false } },
      );
      await resolver.invalidateAgency(ctx.agencyId);
      try {
        await api()
          .get(`${base}/assigned`)
          .set(authHeader(producerToken))
          .expect(403);
        await api()
          .get(`${base}/assigned/${row.rowId}`)
          .set(authHeader(producerToken))
          .expect(403);
      } finally {
        await agencies.updateOne(
          { _id: ctx.agencyId },
          { $set: { [path]: true } },
        );
        await resolver.invalidateAgency(ctx.agencyId);
      }
    });
  });
});
