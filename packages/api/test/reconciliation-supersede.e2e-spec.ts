import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import type {
  ReconciliationPresignResponse,
  ReconciliationRowListResponse,
  ReconciliationRunDetail,
} from '@sfa/shared';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import * as XLSX from 'xlsx';
import { ReconciliationRow } from '../src/carrier-reconciliation/schemas/reconciliation-row.schema';
import { ReconciliationRun } from '../src/carrier-reconciliation/schemas/reconciliation-run.schema';
import { Carrier } from '../src/carriers/schemas/carrier.schema';
import { RoleAssignmentsService } from '../src/permissions/role-assignments.service';
import { Agency } from '../src/platform/schemas/agency.schema';
import { StorageService } from '../src/storage/storage.service';
import { User } from '../src/users/schemas/user.schema';
import { authHeader, login } from './helpers/auth.helper';
import { FakeStorage } from './helpers/fake-storage';
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
 * PAC-173 review — replacing a run is one step, and the upload never deletes
 * a file a run still uses.
 *
 * Every report goes through the real endpoints: presign, the browser's PUT
 * into a `FakeStorage`, then `POST /runs`, so the engine, the swap and the
 * carry-forward all run as they do in production.
 */
describe('Dash Reconciliation re-upload (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestSeedContext;
  let storage: FakeStorage;
  let ownerToken: string;
  let runs: Model<ReconciliationRun>;
  let rows: Model<ReconciliationRow>;

  const api = () => request(app.getHttpServer());
  const base = '/api/v1/carrier-reconciliation';

  /** A Dash export as the reader expects it: metadata rows, then the header. */
  function dashFile(
    lines: (string | number)[][],
    downloadedAt: string,
    period: { start: string; end: string } = {
      start: '09/01/2026',
      end: '09/30/2026',
    },
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
      ['Start Date', period.start],
      ['End Date', period.end],
      ['Product Category', 'All'],
      [],
      header,
      ...lines,
    ]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'New Business Details');
    return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }

  /** A line of the agency's own, missing from the app. */
  const agencyLine = (policyNumber: string, issued = '09/10/2026') => [
    '0B9049',
    '',
    '',
    'SOKOTHER',
    'SOMEONE ELSE',
    policyNumber,
    'AVERY QUINN',
    issued,
    issued,
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

  async function presignAndPut(bytes: Buffer, filename: string) {
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
    return key;
  }
  const createRun = (key: string, bytes: Buffer, filename: string) =>
    api().post(`${base}/runs`).set(authHeader(ownerToken)).send({
      storageKey: key,
      uploadedFilename: filename,
      size: bytes.byteLength,
    });
  async function upload(bytes: Buffer, filename = 'NB-Details.xlsx') {
    const key = await presignAndPut(bytes, filename);
    const res = await createRun(key, bytes, filename).expect(201);
    return { run: res.body as ReconciliationRunDetail, key };
  }
  const rowsOf = async (runId: string) =>
    (
      (
        await api()
          .get(`${base}/runs/${runId}/rows`)
          .query({ pageSize: 100 })
          .set(authHeader(ownerToken))
          .expect(200)
      ).body as ReconciliationRowListResponse
    ).items;
  const review = (runId: string, rowId: string, body: object) =>
    api()
      .patch(`${base}/runs/${runId}/rows/${rowId}/review`)
      .set(authHeader(ownerToken))
      .send(body);
  /** The runs that count as current for September. */
  const currentSeptember = () =>
    runs
      .find({
        agencyId: ctx.agencyId,
        status: 'ready',
        supersededByRunId: null,
        'window.from': '2026-09-01',
      })
      .lean();

  beforeAll(async () => {
    storage = new FakeStorage();
    app = await createTestApp({
      overrides: [{ provide: StorageService, useValue: storage.asService() }],
    });
    const model = <T>(name: string) => app.get<Model<T>>(getModelToken(name));
    runs = model(ReconciliationRun.name);
    rows = model(ReconciliationRow.name);

    await dropTestDatabase(app);
    /*
     * ⚠ `dropTestDatabase` runs after `app.init()`, so `autoIndex` has already
     * built the indexes it just dropped. Everything here leans on the unique
     * ones — one current run per period, the same bytes reconciled once, one
     * holder per Bind ID — so rebuild them.
     */
    await Promise.all([
      runs.syncIndexes(),
      rows.syncIndexes(),
      model<User>(User.name).syncIndexes(),
    ]);
    ctx = await seedTestData(app);

    const carrier = await model<Carrier>(Carrier.name).create({
      agencyId: null,
      name: 'Allstate',
      slug: 'allstate',
      active: true,
    });
    await model<Agency>(Agency.name).updateOne(
      { _id: ctx.agencyId },
      {
        $set: {
          carrierAppointments: [
            {
              carrierId: carrier._id,
              carrierAgencyCode: '0B9049',
              codeKey: 'A0B9049',
              isPrimary: true,
              active: true,
            },
          ],
        },
      },
    );
    ownerToken = (await login(app, ctx.ownerEmail, TEST_PASSWORD)).accessToken;
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  describe('replacing a run', () => {
    let first: ReconciliationRunDetail;
    let second: ReconciliationRunDetail;
    let firstRowId: string;

    beforeAll(async () => {
      ({ run: first } = await upload(
        dashFile(
          [agencyLine('900500001'), agencyLine('900500002')],
          'Thu, 01 Oct 2026 09:00:00 GMT',
        ),
      ));
      const [row] = (await rowsOf(first.id)).filter(
        (r) => r.dash?.policyNumber === '900500001',
      );
      firstRowId = row.id;
      await review(first.id, firstRowId, {
        status: 'resolved',
        resolution: 'entered_in_app',
        note: 'Typed in by hand.',
      }).expect(200);

      // The same period, downloaded again: other bytes, the same lines.
      ({ run: second } = await upload(
        dashFile(
          [agencyLine('900500001'), agencyLine('900500002')],
          'Fri, 02 Oct 2026 09:00:00 GMT',
        ),
      ));
    });

    it('carries the decision to the row that still says the same thing', async () => {
      expect(second.supersedesRunId).toBe(first.id);
      const [carried] = (await rowsOf(second.id)).filter(
        (r) => r.dash?.policyNumber === '900500001',
      );
      expect(carried.review.status).toBe('resolved');
      expect(carried.review.note).toBe('Typed in by hand.');
      expect(carried.review.carriedForward).toBe(true);
      const stored = await rows.findById(carried.id).lean();
      expect(stored!.review.carriedForwardFromRowId).toBe(firstRowId);
    });

    it('retires the old run and every one of its rows in the same step', async () => {
      const old = await runs.findById(first.id).lean();
      expect(String(old!.supersededByRunId)).toBe(second.id);
      expect(old!.currentKey).toBeNull();
      const now = await runs.findById(second.id).lean();
      expect(now!.currentKey).toBe('0B9049|2026-09-01|2026-09-30');
      expect(
        await rows.countDocuments({
          runId: new Types.ObjectId(first.id),
          supersededAt: null,
        }),
      ).toBe(0);
    });

    it("refuses a decision on the replaced run's rows instead of losing it", async () => {
      await review(first.id, firstRowId, { status: 'open' }).expect(409);
      const stored = await rows.findById(firstRowId).lean();
      expect(stored!.review.status).toBe('resolved');
    });

    it('refuses to re-check a replaced run', async () => {
      await api()
        .post(`${base}/runs/${first.id}/reclassify`)
        .set(authHeader(ownerToken))
        .expect(409);
    });
  });

  describe('two uploads of one period at once', () => {
    it('leaves exactly one current run, with its rows', async () => {
      const period = { start: '10/01/2026', end: '10/31/2026' };
      const files = [
        dashFile(
          [agencyLine('900600001', '10/05/2026')],
          'Mon, 02 Nov 2026 09:00:00 GMT',
          period,
        ),
        dashFile(
          [agencyLine('900600001', '10/05/2026')],
          'Mon, 02 Nov 2026 10:00:00 GMT',
          period,
        ),
      ];
      const keys = await Promise.all(
        files.map((bytes, i) => presignAndPut(bytes, `oct-${i}.xlsx`)),
      );
      const results = await Promise.all(
        files.map((bytes, i) => createRun(keys[i], bytes, `oct-${i}.xlsx`)),
      );
      // Either the second replaced the first (both 201), or they raced for
      // the empty period and one lost (409). Never two current runs.
      for (const res of results) expect([201, 409]).toContain(res.status);

      const current = await runs
        .find({
          agencyId: ctx.agencyId,
          'window.from': '2026-10-01',
          status: 'ready',
          supersededByRunId: null,
        })
        .lean();
      expect(current).toHaveLength(1);
      expect(
        await rows.countDocuments({
          runId: current[0]._id,
          supersededAt: null,
        }),
      ).toBe(1);

      for (const failed of await runs
        .find({ agencyId: ctx.agencyId, status: 'failed' })
        .lean()) {
        expect(failed.file.storageKey).toBeNull();
        expect(await rows.countDocuments({ runId: failed._id })).toBe(0);
      }
      expect(await storage.objectExists(current[0].file.storageKey!)).toBe(
        true,
      );
    });
  });

  describe('carrying an assignment', () => {
    it('keeps it with someone who can still take rows, and drops it for someone who cannot', async () => {
      const users = app.get<Model<User>>(getModelToken(User.name));
      const producer = await users.findOne({ email: ctx.producerEmail }).lean();
      const producerId = String(producer!._id);
      const period = { start: '12/01/2026', end: '12/31/2026' };
      const lines = [
        agencyLine('900800001', '12/03/2026'),
        agencyLine('900800002', '12/04/2026'),
      ];
      const { run: first } = await upload(
        dashFile(lines, 'Fri, 01 Jan 2027 09:00:00 GMT', period),
      );
      const byNumber = async (runId: string) =>
        new Map(
          (await rowsOf(runId)).map((row) => [row.dash?.policyNumber, row]),
        );
      const firstRows = await byNumber(first.id);
      // The rows are missing from the app, so each goes to someone who can
      // book a sale: the producer, and the read-only user lent the rights.
      const roleAssignments = app.get(RoleAssignmentsService);
      const salesRights = [
        'leads:read',
        'leads:write',
        'deal_audits:read',
        'deal_audits:write',
      ];
      await roleAssignments.setUserOverrides(
        ctx.agencyId,
        ctx.readOnlyUserId,
        salesRights,
        [],
      );
      for (const [number, userId] of [
        ['900800001', producerId],
        ['900800002', ctx.readOnlyUserId],
      ] as const) {
        await api()
          .patch(
            `${base}/runs/${first.id}/rows/${firstRows.get(number)!.id}/assignment`,
          )
          .set(authHeader(ownerToken))
          .send({ userId })
          .expect(200);
      }

      // The read-only user loses those rights before the report is uploaded
      // again, so is no longer in the pool.
      await roleAssignments.setUserOverrides(
        ctx.agencyId,
        ctx.readOnlyUserId,
        [],
        [],
      );
      try {
        const { run: second } = await upload(
          dashFile(lines, 'Sat, 02 Jan 2027 09:00:00 GMT', period),
        );
        const secondRows = await byNumber(second.id);
        const stored = async (number: string) =>
          (await rows.findById(secondRows.get(number)!.id).lean())!.assignment;
        expect((await stored('900800001'))?.userId).toBe(producerId);
        expect(await stored('900800002')).toBeNull();
      } finally {
        await roleAssignments.setUserOverrides(
          ctx.agencyId,
          ctx.readOnlyUserId,
          [],
          [],
        );
      }
    });
  });

  /** PAC-173 review: closing is about the month, not one file of it. */
  describe('a closed month', () => {
    it('stays closed when its report is uploaded again', async () => {
      const period = { start: '11/01/2026', end: '11/30/2026' };
      const lines = [agencyLine('900700001', '11/05/2026')];
      const monthState = (runId: string, verb: 'close' | 'reopen') =>
        api().post(`${base}/runs/${runId}/${verb}`).set(authHeader(ownerToken));

      const { run: first } = await upload(
        dashFile(lines, 'Tue, 01 Dec 2026 09:00:00 GMT', period),
      );
      const closed = (await monthState(first.id, 'close').expect(201))
        .body as ReconciliationRunDetail;

      const { run: second } = await upload(
        dashFile(lines, 'Wed, 02 Dec 2026 09:00:00 GMT', period),
      );
      expect(second.supersedesRunId).toBe(first.id);
      expect(second.closedAt).toBe(closed.closedAt);
      expect(second.closedBy?.id).toBe(closed.closedBy?.id);

      // The month is reopened on the run that replaced it, not the old one.
      await monthState(first.id, 'reopen').expect(409);
      const reopened = (await monthState(second.id, 'reopen').expect(201))
        .body as ReconciliationRunDetail;
      expect(reopened.closedAt).toBeNull();
    });
  });

  describe('a replayed upload', () => {
    it("keeps the live run's file when the same request arrives twice", async () => {
      const bytes = dashFile(
        [agencyLine('900700001', '11/04/2026')],
        'Tue, 01 Dec 2026 09:00:00 GMT',
        { start: '11/01/2026', end: '11/30/2026' },
      );
      const key = await presignAndPut(bytes, 'nov.xlsx');
      await createRun(key, bytes, 'nov.xlsx').expect(201);
      const replay = await createRun(key, bytes, 'nov.xlsx').expect(409);
      expect((replay.body as { code: string }).code).toBe(
        'RECONCILIATION_DUPLICATE_FILE',
      );
      expect(await storage.objectExists(key)).toBe(true);
    });

    it('still deletes a duplicate uploaded under a new key', async () => {
      const bytes = dashFile(
        [agencyLine('900700002', '11/05/2026')],
        'Wed, 02 Dec 2026 09:00:00 GMT',
        { start: '11/01/2026', end: '11/30/2026' },
      );
      await upload(bytes, 'nov-b.xlsx');
      const again = await presignAndPut(bytes, 'nov-b-again.xlsx');
      await createRun(again, bytes, 'nov-b-again.xlsx').expect(409);
      expect(await storage.objectExists(again)).toBe(false);
    });
  });

  it('has one current September run after everything above', async () => {
    expect(await currentSeptember()).toHaveLength(1);
  });

  describe("an owner's details", () => {
    it('are changed only by an owner or a platform admin', async () => {
      const users = app.get<Model<User>>(getModelToken(User.name));
      const owner = await users.findOne({ email: ctx.ownerEmail }).lean();
      const producer = await users.findOne({ email: ctx.producerEmail }).lean();
      // A producer handed `agency:users:write`, and nothing to do with owners.
      await app
        .get(RoleAssignmentsService)
        .setUserOverrides(
          ctx.agencyId,
          producer!._id,
          ['agency:users:write'],
          [],
        );
      const producerToken = (await login(app, ctx.producerEmail, TEST_PASSWORD))
        .accessToken;

      await api()
        .patch(`/api/v1/users/${String(owner!._id)}/details`)
        .set(authHeader(producerToken))
        .send({ allstateBindId: 'SOKTAKEN' })
        .expect(403);
      await api()
        .patch(`/api/v1/users/${String(owner!._id)}/details`)
        .set(authHeader(ownerToken))
        .send({ allstateBindId: 'SOKOWNER' })
        .expect(200);
      // Someone who is not an owner is still theirs to edit.
      await api()
        .patch(`/api/v1/users/${ctx.csrUserId}/details`)
        .set(authHeader(producerToken))
        .send({ allstateBindId: 'SOKCSR01' })
        .expect(200);
      await app
        .get(RoleAssignmentsService)
        .setUserOverrides(ctx.agencyId, producer!._id, [], []);
    });

    it("refuse Allstate codes on a platform admin's own profile", async () => {
      const adminToken = (await login(app, ctx.superAdminEmail, TEST_PASSWORD))
        .accessToken;
      await api()
        .patch('/api/v1/me/profile')
        .set(authHeader(adminToken))
        .send({ allstateBindId: 'SOKADMIN' })
        .expect(400);
      await api()
        .patch('/api/v1/me/profile')
        .set(authHeader(adminToken))
        .send({ firstName: 'Test' })
        .expect(200);
    });

    it('lets two people share a sub-producer code', async () => {
      const users = app.get<Model<User>>(getModelToken(User.name));
      await users.updateOne(
        { email: ctx.ownerEmail },
        { $set: { allstateSubProducerCode: '034' } },
      );
      await api()
        .patch('/api/v1/me/profile')
        .set(authHeader(ownerToken))
        .send({ allstateSubProducerCode: '034' })
        .expect(200);
      await api()
        .patch(`/api/v1/users/${ctx.csrUserId}/details`)
        .set(authHeader(ownerToken))
        .send({ allstateSubProducerCode: '034' })
        .expect(200);
    });
  });
});
