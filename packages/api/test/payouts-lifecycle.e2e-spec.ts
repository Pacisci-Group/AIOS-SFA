import { createHash } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import {
  AgencyPermission,
  ANY_CARRIER,
  PAYOUT_RUN_GENERATING,
  PAYOUT_STATEMENT_CHANGED,
  PAYOUT_STATEMENT_NOT_EDITABLE,
  PAYOUT_STATEMENT_NOT_SENT,
  PAYOUT_STATEMENT_OWN_INPUTS,
  PAYOUT_STATEMENT_OWN_STATEMENT,
  type PayoutRunResponse,
  type PayStatementPdfLinkResponse,
  type PayStatementsResponse,
  type PayStatementView,
  type SendAllDraftsResponse,
  type UpsertPaymentStructureInput,
} from '@sfa/shared';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { businessDateInstant } from '../src/common/dates/business-dates';
import { Deal } from '../src/deals/schemas/deal.schema';
import {
  deterministicEventId,
  InngestService,
} from '../src/inngest/inngest.service';
import { PaymentStructure } from '../src/payouts/schemas/payment-structure.schema';
import { PayStatement } from '../src/payouts/schemas/pay-statement.schema';
import { PayoutRun } from '../src/payouts/schemas/payout-run.schema';
import { SEND_ALL_FAILED_MESSAGE } from '../src/payouts/statement-issue.service';
import { RoleAssignmentsService } from '../src/permissions/role-assignments.service';
import { Agency } from '../src/platform/schemas/agency.schema';
import { Policy } from '../src/policies/schemas/policy.schema';
import { AgencyRole } from '../src/roles/schemas/agency-role.schema';
import { StorageService } from '../src/storage/storage.service';
import { User } from '../src/users/schemas/user.schema';
import { authHeader, login } from './helpers/auth.helper';
import { FakeStorage } from './helpers/fake-storage';
import {
  seedTestData,
  TEST_PASSWORD,
  type TestSeedContext,
} from './helpers/seed-test-data';
import {
  CapturedInngestService,
  closeTestApp,
  createTestApp,
  dropTestDatabase,
} from './helpers/test-app';

const CHICAGO = 'America/Chicago';
const noon = (iso: string) =>
  new Date(businessDateInstant(iso, CHICAGO).getTime() + 12 * 3_600_000);

const MONTH = '2026-03';
const NOTIFICATION = 'notification/requested.v1';
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * supertest buffers JSON and text only; a PDF needs its own parser. In Node
 * the parser is handed the raw response stream, whatever superagent's
 * `Response` type says.
 */
function binary(
  res: request.Response,
  done: (err: Error | null, body: Buffer) => void,
): void {
  const stream = res as unknown as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(chunk));
  stream.on('end', () => done(null, Buffer.concat(chunks)));
}

const sha256 = (bytes: Buffer) =>
  createHash('sha256').update(bytes).digest('hex');

/**
 * PAC-181 — the Commission Statement PDF and sending, end to end.
 *
 * March 2026 in the seeded agency (Chicago). Structure "Producers":
 * Allstate 10%, any other carrier 5%; members P1 (the seeded producer, main
 * branch), C1 (the seeded CSR, main) and P2 (a producer in the other
 * branch). A branch manager for each branch: BM (main) and BM2 (other).
 *
 * | | sales | |
 * |---|---|---|
 * | P1 | Allstate Auto 3,000 + Progressive Home 2,000 (Mar 10) | |
 * | C1 | Allstate Auto 2,000 (Mar 5) | |
 * | P2 | Travelers Home 1,000 (Mar 6) | other branch |
 *
 * Object storage is a `FakeStorage`; Inngest is captured, so a notification
 * is asserted as the event the worker would deliver.
 */
describe('Payouts — sending statements and their PDF (e2e)', () => {
  let app: INestApplication<App>;
  let seed: TestSeedContext;
  let storage: FakeStorage;
  let inngest: CapturedInngestService;
  let ownerToken: string;
  let producerToken: string;
  let csrToken: string;
  let managerToken: string;
  let otherManagerToken: string;
  let ownerId: string;
  let p1: string;
  let c1: string;
  let p2: string;
  let otherBranchId: string;
  let structureId: string;
  let runId: string;
  let statements: Model<PayStatement>;
  let runs: Model<PayoutRun>;
  let structures: Model<PaymentStructure>;
  let agencies: Model<Agency>;
  let roleAssignments: RoleAssignmentsService;
  let managerId: string;
  let sell: (
    producerId: string,
    soldDate: Date,
    policies: [carrier: string, policyType: string, premium: number][],
    scope?: { agencyId: string; branchId: string },
  ) => Promise<void>;

  const api = () => request(app.getHttpServer());
  const base = '/api/v1/payouts';
  const main = () => ({ agencyId: seed.agencyId, branchId: seed.branchId });

  const statementOf = async (userId: string) =>
    String(
      (await statements
        .findOne({ userId: new Types.ObjectId(userId), month: MONTH })
        .select({ _id: 1 })
        .lean())!._id,
    );
  const stored = (id: string) =>
    statements.findById(id).lean<PayStatement & { _id: Types.ObjectId }>();
  const detail = async (id: string, token = ownerToken) =>
    (
      await api()
        .get(`${base}/statements/${id}`)
        .set(authHeader(token))
        .expect(200)
    ).body as PayStatementView;
  const send = (id: string, token = ownerToken) =>
    api().post(`${base}/statements/${id}/send`).set(authHeader(token));
  const reopen = (id: string, token = ownerToken) =>
    api().post(`${base}/statements/${id}/reopen`).set(authHeader(token));
  const pdfLink = (id: string, token = ownerToken, query = '') =>
    api().get(`${base}/statements/${id}/pdf${query}`).set(authHeader(token));
  const preview = (id: string, token = ownerToken) =>
    api()
      .get(`${base}/statements/${id}/pdf-preview`)
      .set(authHeader(token))
      .buffer(true)
      .parse(binary);
  const sendAll = (token = ownerToken, query = '') =>
    api().post(`${base}/runs/${runId}/send-all${query}`).set(authHeader(token));
  const sentNotifications = () =>
    inngest.sent.filter(
      (event) =>
        event.name === NOTIFICATION &&
        event.data.type === 'payouts.statement_sent',
    );
  /** The fake's own upload, for a test that puts something in its way once. */
  const realPut = (
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<{ key: string; size: number }> => {
    storage.objects.set(key, { body, contentType });
    return Promise.resolve({ key, size: body.byteLength });
  };
  const pdfKeys = () =>
    [...storage.objects.keys()].filter((key) =>
      key.startsWith(`agencies/${seed.agencyId}/pay-statements/`),
    );

  beforeAll(async () => {
    storage = new FakeStorage();
    app = await createTestApp({
      overrides: [{ provide: StorageService, useValue: storage.asService() }],
    });
    // `createTestApp` puts a capturing double in Inngest's place.
    inngest = app.get<InngestService, CapturedInngestService>(InngestService);
    await dropTestDatabase(app);
    seed = await seedTestData(app);

    const userModel = app.get<Model<User>>(getModelToken(User.name));
    const roleModel = app.get<Model<AgencyRole>>(
      getModelToken(AgencyRole.name),
    );
    const dealModel = app.get<Model<Deal>>(getModelToken(Deal.name));
    const policyModel = app.get<Model<Policy>>(getModelToken(Policy.name));
    statements = app.get<Model<PayStatement>>(getModelToken(PayStatement.name));
    runs = app.get<Model<PayoutRun>>(getModelToken(PayoutRun.name));
    structures = app.get<Model<PaymentStructure>>(
      getModelToken(PaymentStructure.name),
    );
    agencies = app.get<Model<Agency>>(getModelToken(Agency.name));
    await runs.syncIndexes();
    await statements.syncIndexes();
    roleAssignments = app.get(RoleAssignmentsService);

    const producer = await userModel
      .findOne({ email: seed.producerEmail })
      .select('+passwordHash');
    const owner = await userModel.findOne({ email: seed.ownerEmail });
    ownerId = String(owner!._id);
    p1 = String(producer!._id);
    c1 = seed.csrUserId;
    const agencyId = new Types.ObjectId(seed.agencyId);
    const branches = await userModel.db
      .collection('branches')
      .find({ agencyId })
      .toArray();
    otherBranchId = String(
      branches.find((branch) => String(branch._id) !== seed.branchId)!._id,
    );
    const roles = await roleModel.find({ agencyId }).lean();
    const roleId = (slug: string) =>
      roles.find((role) => role.slug === slug)!._id;
    const seedActor = { userId: ownerId, isPlatformAdmin: true };
    const person = async (email: string, slug: string, branchId: string) => {
      const user = await userModel.create({
        agencyId,
        branchId: new Types.ObjectId(branchId),
        email,
        passwordHash: (producer as unknown as { passwordHash: string })
          .passwordHash,
        firstName: email.split('@')[0],
        lastName: 'Fixture',
        isActive: true,
      });
      await roleAssignments.setUserRoles(seedActor, agencyId, user._id, [
        roleId(slug),
      ]);
      return String(user._id);
    };
    managerId = await person(
      'send-manager@sfa.local',
      'branch_manager',
      seed.branchId,
    );
    await person(
      'send-north-manager@sfa.local',
      'branch_manager',
      otherBranchId,
    );
    p2 = await person('send-north@sfa.local', 'producer', otherBranchId);

    ownerToken = (await login(app, seed.ownerEmail, TEST_PASSWORD)).accessToken;
    producerToken = (await login(app, seed.producerEmail, TEST_PASSWORD))
      .accessToken;
    csrToken = (await login(app, seed.csrEmail, TEST_PASSWORD)).accessToken;
    managerToken = (await login(app, 'send-manager@sfa.local', TEST_PASSWORD))
      .accessToken;
    otherManagerToken = (
      await login(app, 'send-north-manager@sfa.local', TEST_PASSWORD)
    ).accessToken;

    let sequence = 0;
    sell = async (producerId, soldDate, policies, scope = main()) => {
      sequence += 1;
      const deal = await dealModel.create({
        ...scope,
        producerId: new Types.ObjectId(producerId),
        clientName: `Client ${sequence}`,
        householdId: new Types.ObjectId(),
        dealType: 'Other',
        policyTypes: policies.map(([, type]) => type),
        premium: policies.reduce((sum, [, , premium]) => sum + premium, 0),
        itemCount: policies.length,
        premiumSource: 'rollup',
        soldDate,
        status: 'Sold',
      });
      await policyModel.create(
        policies.map(([carrier, policyType, premium], index) => ({
          ...scope,
          dealId: deal._id,
          householdId: deal.householdId,
          policyNumber: `SEND-${sequence}-${index}`,
          policyStatus: 'Active',
          policyType,
          carrier,
          premium,
          items: 1,
        })),
      );
    };
    await sell(p1, noon('2026-03-10'), [
      ['Allstate', 'Auto', 3000],
      ['Progressive', 'Home', 2000],
    ]);
    await sell(c1, noon('2026-03-05'), [['Allstate', 'Auto', 2000]]);
    await sell(p2, noon('2026-03-06'), [['Travelers', 'Home', 1000]], {
      agencyId: seed.agencyId,
      branchId: otherBranchId,
    });

    const body: UpsertPaymentStructureInput = {
      name: 'Producers',
      rules: [
        { carrier: 'Allstate', ratePercent: 10 },
        { carrier: ANY_CARRIER, ratePercent: 5 },
      ],
      leadSourceRules: [],
      hatTrick: { enabled: false, dealsPerDay: 3, bonusAmount: 50 },
      individualTiers: [],
      tiersStackable: false,
      teamBonusEligible: false,
      basePay: 2500,
      memberIds: [p1, c1, p2],
    };
    const created = await api()
      .post(`${base}/structures`)
      .set(authHeader(ownerToken))
      .send(body)
      .expect(201);
    structureId = (created.body as { id: string }).id;
    const generated = await api()
      .post(`${base}/runs`)
      .set(authHeader(ownerToken))
      .send({ month: MONTH })
      .expect(200);
    runId = (generated.body as PayoutRunResponse).run!.id;
  });

  afterAll(async () => {
    if (app) {
      await dropTestDatabase(app);
      await closeTestApp(app);
    }
  });

  describe('GET /payouts/statements/:id/pdf-preview', () => {
    it('streams a fresh render of a draft, stored nowhere', async () => {
      const id = await statementOf(p1);
      const res = await preview(id).expect(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-disposition']).toBe(
        'inline; filename="preview-commission-statement-2026-03-v1.pdf"',
      );
      expect(res.headers['cache-control']).toBe('no-store');
      expect((res.body as Buffer).subarray(0, 5).toString('latin1')).toBe(
        '%PDF-',
      );
      expect(pdfKeys()).toHaveLength(0);
    });

    it("is the reviewer's: their branch's manager may, others may not", async () => {
      const id = await statementOf(p1);
      await preview(id, managerToken).expect(200);
      await preview(id, otherManagerToken).expect(404);
      await preview(id, producerToken).expect(403);
    });
  });

  describe('POST /payouts/statements/:id/send', () => {
    it('has nothing to open before it is sent', async () => {
      await pdfLink(await statementOf(p1)).expect(404);
    });

    it("is refused to the employee and outside the reviewer's branch", async () => {
      const id = await statementOf(p1);
      await send(id, producerToken).expect(403);
      await send(id, otherManagerToken).expect(404);
      expect(sentNotifications()).toHaveLength(0);
    });

    // New figures are saved in one write and the statement recalculated in a
    // later one. A send landing between the two used to go out with the old
    // figures and leave the new ones on a sent statement.
    it('refuses a send that new figures raced, and says it changed', async () => {
      const id = await statementOf(p1);
      const notified = sentNotifications().length;
      storage.putObject = async (key, body, contentType) => {
        storage.putObject = realPut;
        // `updateInputs`' first write, landing while the PDF is stored.
        await statements.updateOne(
          {
            _id: new Types.ObjectId(id),
            status: { $in: ['draft', 'rejected'] },
          },
          {
            $set: {
              inputs: {
                compliancePercent: 95,
                retentionPercent: null,
                lifeReferrals: null,
                meetingAttendance: null,
              },
            },
          },
        );
        return realPut(key, body, contentType);
      };
      try {
        const res = await send(id).expect(409);
        expect((res.body as { code?: string }).code).toBe(
          PAYOUT_STATEMENT_CHANGED,
        );
      } finally {
        storage.putObject = realPut;
      }
      expect(await stored(id)).toMatchObject({ status: 'draft', version: 1 });
      // Its upload removed, nobody told.
      expect(pdfKeys()).toHaveLength(0);
      expect(sentNotifications()).toHaveLength(notified);
    });

    it('stores the PDF, marks the statement sent and tells the employee', async () => {
      const id = await statementOf(p1);
      const res = await send(id).expect(200);
      const view = res.body as PayStatementView;
      expect(view).toMatchObject({
        id,
        status: 'sent',
        version: 1,
        history: [],
        sentBy: { id: ownerId },
      });
      expect(view.sentAt).toEqual(expect.any(String));
      expect(view.sentBy!.name.length).toBeGreaterThan(0);
      expect(view.pdf).toEqual({
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/) as unknown,
        size: expect.any(Number) as unknown,
        renderedAt: expect.any(String) as unknown,
      });
      // The key stays in the API.
      expect(JSON.stringify(view)).not.toContain('pay-statements/');

      const keys = pdfKeys();
      expect(keys).toHaveLength(1);
      expect(keys[0]).toContain(`/${id}/`);
      expect(keys[0]).toMatch(/commission-statement-2026-03-v1\.pdf$/);
      const object = storage.objects.get(keys[0])!;
      expect(object.contentType).toBe('application/pdf');
      expect(sha256(object.body)).toBe(view.pdf!.sha256);
      expect(object.body.byteLength).toBe(view.pdf!.size);

      const events = sentNotifications();
      expect(events).toHaveLength(1);
      expect(events[0].id).toBe(
        deterministicEventId(
          'payouts.statement_sent',
          `${id}:v1`,
        ).toHexString(),
      );
      expect(events[0].data).toMatchObject({
        type: 'payouts.statement_sent',
        recipientIds: [p1],
        agencyId: seed.agencyId,
        actorId: ownerId,
        entity: { kind: 'payStatement', id },
        dedupeKey: `pay-statement:${id}:sent:v1`,
        data: {
          statementId: id,
          month: MONTH,
          monthLabel: 'March 2026',
          version: 1,
          senderName: view.sentBy!.name,
        },
      });
      // No amounts travel in a notification.
      expect(Object.keys(events[0].data.data as object).sort()).toEqual([
        'month',
        'monthLabel',
        'senderName',
        'statementId',
        'version',
      ]);
    });

    it('does not send, store or notify twice', async () => {
      const id = await statementOf(p1);
      const res = await send(id).expect(409);
      expect((res.body as { code?: string }).code).toBe(
        PAYOUT_STATEMENT_NOT_EDITABLE,
      );
      expect(pdfKeys()).toHaveLength(1);
      expect(sentNotifications()).toHaveLength(1);
    });

    it('freezes the statement: no recalculation, no new figures', async () => {
      const id = await statementOf(p1);
      await api()
        .post(`${base}/statements/${id}/recalculate`)
        .set(authHeader(ownerToken))
        .expect(409);
      await api()
        .patch(`${base}/statements/${id}/inputs`)
        .set(authHeader(ownerToken))
        .send({
          compliancePercent: 90,
          retentionPercent: null,
          lifeReferrals: null,
          meetingAttendance: null,
        })
        .expect(409);
    });

    it('counts it as sent on the run', async () => {
      const res = await api()
        .get(`${base}/runs?month=${MONTH}`)
        .set(authHeader(ownerToken))
        .expect(200);
      expect((res.body as PayoutRunResponse).run!.counts).toMatchObject({
        statements: 3,
        draft: 2,
        sent: 1,
      });
    });
  });

  describe('GET /payouts/statements/:id/pdf', () => {
    it('mints a short-lived inline link per read', async () => {
      const id = await statementOf(p1);
      const res = await pdfLink(id).expect(200);
      const link = res.body as PayStatementPdfLinkResponse;
      expect(link).toEqual({
        url: expect.stringContaining('pay-statements') as unknown,
        filename: 'commission-statement-2026-03-v1.pdf',
        expiresIn: 300,
      });
      const signed = storage.downloads.at(-1)!;
      expect(signed).toMatchObject({
        key: pdfKeys()[0],
        disposition: 'inline',
        contentType: 'application/pdf',
        filename: 'commission-statement-2026-03-v1.pdf',
        expiresIn: 300,
      });
      // Never stored on the statement.
      expect(JSON.stringify(await stored(id))).not.toContain('signed=1');
    });

    it('opens for the employee once it is theirs and sent', async () => {
      const id = await statementOf(p1);
      await pdfLink(id, producerToken).expect(200);
      expect((await detail(id, producerToken)).status).toBe('sent');
      const mine = await api()
        .get(`${base}/statements?mine=true`)
        .set(authHeader(producerToken))
        .expect(200);
      expect(
        (mine.body as PayStatementsResponse).statements.map((row) => row.id),
      ).toEqual([id]);
    });

    it('is a 404 to anyone who may not see the statement', async () => {
      const id = await statementOf(p1);
      await pdfLink(id, csrToken).expect(404);
      await pdfLink(id, otherManagerToken).expect(404);
      await pdfLink(id, ownerToken, '?version=2').expect(404);
    });
  });

  describe('POST /payouts/statements/:id/reopen', () => {
    it("is the reviewer's", async () => {
      const id = await statementOf(p1);
      await reopen(id, producerToken).expect(403);
      await reopen(id, otherManagerToken).expect(404);
    });

    it('takes it back to draft and keeps the issued version in history', async () => {
      const id = await statementOf(p1);
      const before = await stored(id);
      const res = await reopen(id).expect(200);
      const view = res.body as PayStatementView;
      expect(view).toMatchObject({
        status: 'draft',
        version: 2,
        pdf: null,
        sentAt: null,
        sentBy: null,
      });
      expect(view.history).toEqual([
        {
          version: 1,
          outcome: 'reopened',
          pdf: {
            sha256: before!.pdf!.sha256,
            size: before!.pdf!.size,
            renderedAt: before!.pdf!.renderedAt.toISOString(),
          },
          sentAt: before!.sentAt!.toISOString(),
          sentBy: { id: ownerId, name: before!.sentByName },
          at: expect.any(String) as unknown,
        },
      ]);
      // The employee no longer sees it.
      await api()
        .get(`${base}/statements/${id}`)
        .set(authHeader(producerToken))
        .expect(404);
      await pdfLink(id, producerToken, '?version=1').expect(404);
    });

    it('only reopens a sent statement', async () => {
      const res = await reopen(await statementOf(p1)).expect(409);
      expect((res.body as { code?: string }).code).toBe(
        PAYOUT_STATEMENT_NOT_SENT,
      );
    });

    it("still opens the reopened version's file for a reviewer", async () => {
      const id = await statementOf(p1);
      await pdfLink(id).expect(404);
      await pdfLink(id, ownerToken, '?version=1').expect(200);
      expect(storage.downloads.at(-1)!.key).toBe(pdfKeys()[0]);
    });

    it('survives a recalculation, even for someone who left the structure', async () => {
      const id = await statementOf(p1);
      const csrDraft = await statementOf(c1);
      const before = await stored(id);
      expect(before!.totals.grossPremium).toBe(5000);
      await structures.updateOne(
        { _id: new Types.ObjectId(structureId) },
        {
          $pull: {
            memberIds: { $in: [p1, c1].map((u) => new Types.ObjectId(u)) },
          },
        },
      );
      // A sale made since: the kept draft must not go out without it.
      await sell(p1, noon('2026-03-20'), [['Allstate', 'Auto', 1000]]);
      await api()
        .post(`${base}/runs`)
        .set(authHeader(ownerToken))
        .send({ month: MONTH })
        .expect(200);
      // An issued-then-reopened draft is a record of what was sent: kept.
      const kept = await stored(id);
      expect(kept).toMatchObject({ status: 'draft', version: 2 });
      expect(kept!.history).toHaveLength(1);
      // …and recalculated by the rules it was drafted with, saying why.
      expect(kept!.computedAt.getTime()).toBeGreaterThan(
        before!.computedAt.getTime(),
      );
      expect(kept!.totals.grossPremium).toBe(6000);
      expect(kept!.warnings).toEqual(
        expect.arrayContaining([
          expect.stringContaining('no longer on a payment structure'),
        ]),
      );
      // A draft never issued is deleted as before.
      expect(
        await statements.exists({ _id: new Types.ObjectId(csrDraft) }),
      ).toBeNull();

      await structures.updateOne(
        { _id: new Types.ObjectId(structureId) },
        {
          $addToSet: {
            memberIds: { $each: [p1, c1].map((u) => new Types.ObjectId(u)) },
          },
        },
      );
      await api()
        .post(`${base}/runs`)
        .set(authHeader(ownerToken))
        .send({ month: MONTH })
        .expect(200);
      expect(await stored(id)).toMatchObject({ status: 'draft', version: 2 });
      expect(await statementOf(c1)).toEqual(expect.any(String));
    });

    it('sends the reopened statement as version 2, with a file and a notice of its own', async () => {
      const id = await statementOf(p1);
      const res = await send(id).expect(200);
      const view = res.body as PayStatementView;
      expect(view).toMatchObject({ status: 'sent', version: 2 });
      expect(view.history).toHaveLength(1);

      const keys = pdfKeys();
      expect(keys).toHaveLength(2);
      expect(keys[1]).toMatch(/commission-statement-2026-03-v2\.pdf$/);
      const events = sentNotifications();
      expect(events).toHaveLength(2);
      expect(events[1].data).toMatchObject({
        dedupeKey: `pay-statement:${id}:sent:v2`,
        data: { version: 2 },
      });

      await pdfLink(id, producerToken).expect(200);
      expect(storage.downloads.at(-1)).toMatchObject({
        key: keys[1],
        filename: 'commission-statement-2026-03-v2.pdf',
      });
      await pdfLink(id, producerToken, '?version=1').expect(200);
      expect(storage.downloads.at(-1)!.key).toBe(keys[0]);
    });
  });

  describe('sending a disputed statement again', () => {
    it('supersedes the disputed version and issues the next one', async () => {
      const id = await statementOf(c1);
      await send(id).expect(200);
      const first = await stored(id);
      // PAC-182 writes the dispute; here it is set directly.
      await statements.updateOne(
        { _id: new Types.ObjectId(id) },
        { $set: { status: 'rejected' } },
      );
      const res = await send(id).expect(200);
      const view = res.body as PayStatementView;
      expect(view).toMatchObject({ status: 'sent', version: 2 });
      expect(view.history).toMatchObject([
        {
          version: 1,
          outcome: 'superseded',
          pdf: { sha256: first!.pdf!.sha256 },
        },
      ]);
      const again = await stored(id);
      expect(again!.pdf!.key).not.toBe(first!.pdf!.key);
      expect(again!.pdf!.key).toMatch(/-v2\.pdf$/);
    });
  });

  describe('POST /payouts/runs/:id/send-all', () => {
    it("is the reviewer's, for a run of their agency", async () => {
      await sendAll(producerToken).expect(403);
      await api()
        .post(`${base}/runs/${new Types.ObjectId().toHexString()}/send-all`)
        .set(authHeader(ownerToken))
        .expect(404);
    });

    it('waits while the month is being calculated', async () => {
      await runs.updateOne({ _id: runId }, { $set: { status: 'generating' } });
      const res = await sendAll().expect(409);
      expect((res.body as { code?: string }).code).toBe(PAYOUT_RUN_GENERATING);
      await runs.updateOne({ _id: runId }, { $set: { status: 'ready' } });
    });

    it("sends a branch manager's branch only", async () => {
      // C1 (main) back to draft; P2 (the other branch) is still a draft.
      await reopen(await statementOf(c1)).expect(200);
      const before = sentNotifications().length;
      const res = await sendAll(managerToken).expect(200);
      expect(res.body as SendAllDraftsResponse).toEqual({
        sent: 1,
        skipped: 0,
        failed: [],
      });
      expect((await stored(await statementOf(c1)))!.status).toBe('sent');
      expect((await stored(await statementOf(p2)))!.status).toBe('draft');
      expect(sentNotifications()).toHaveLength(before + 1);
    });

    it('narrows the owner to the branch the page shows, then sends the rest', async () => {
      const narrowed = await sendAll(
        ownerToken,
        `?branchId=${seed.branchId}`,
      ).expect(200);
      expect((narrowed.body as SendAllDraftsResponse).sent).toBe(0);
      expect((await stored(await statementOf(p2)))!.status).toBe('draft');

      const all = await sendAll().expect(200);
      expect(all.body as SendAllDraftsResponse).toEqual({
        sent: 1,
        skipped: 0,
        failed: [],
      });
      const p2Statement = await stored(await statementOf(p2));
      expect(p2Statement).toMatchObject({ status: 'sent', version: 1 });
      const last = sentNotifications().at(-1)!;
      expect(last.data).toMatchObject({ recipientIds: [p2] });

      const none = await sendAll().expect(200);
      expect(none.body).toEqual({ sent: 0, skipped: 0, failed: [] });
    });
  });

  describe('the agency logo', () => {
    it('embeds a PNG logo, and falls back to the name for an SVG', async () => {
      const id = await statementOf(p2);
      await reopen(id).expect(200);

      const pngKey = `agencies/${seed.agencyId}/branding/2026/logo.png`;
      await storage.putObject(pngKey, ONE_PIXEL_PNG, 'image/png');
      await agencies.updateOne(
        { _id: new Types.ObjectId(seed.agencyId) },
        { $set: { 'branding.logoKey': pngKey } },
      );
      const withLogo = await preview(id).expect(200);
      expect((withLogo.body as Buffer).toString('latin1')).toContain(
        '/Subtype /Image',
      );

      const svgKey = `agencies/${seed.agencyId}/branding/2026/logo.svg`;
      await storage.putObject(svgKey, Buffer.from('<svg/>'), 'image/svg+xml');
      await agencies.updateOne(
        { _id: new Types.ObjectId(seed.agencyId) },
        { $set: { 'branding.logoKey': svgKey } },
      );
      const fallback = await preview(id).expect(200);
      expect((fallback.body as Buffer).toString('latin1')).not.toContain(
        '/Subtype /Image',
      );

      // The band is navy: the dark-surface logo is the one printed.
      const darkKey = `agencies/${seed.agencyId}/branding/2026/logo-dark.png`;
      await storage.putObject(darkKey, ONE_PIXEL_PNG, 'image/png');
      await agencies.updateOne(
        { _id: new Types.ObjectId(seed.agencyId) },
        { $set: { 'branding.logoDarkKey': darkKey } },
      );
      const dark = await preview(id).expect(200);
      expect((dark.body as Buffer).toString('latin1')).toContain(
        '/Subtype /Image',
      );

      await agencies.updateOne(
        { _id: new Types.ObjectId(seed.agencyId) },
        { $unset: { 'branding.logoKey': 1, 'branding.logoDarkKey': 1 } },
      );
    });

    it('falls back to the name for a PNG whose image data is broken', async () => {
      const id = await statementOf(p2);
      // A valid RGBA header over bytes that do not inflate: pdfkit decoded
      // these in a callback and took the process down.
      const header = ONE_PIXEL_PNG.subarray(0, 33);
      const idat = Buffer.from('not deflate data');
      const length = Buffer.alloc(4);
      length.writeUInt32BE(idat.length);
      const broken = Buffer.concat([
        header,
        length,
        Buffer.from('IDAT'),
        idat,
        Buffer.alloc(4),
        ONE_PIXEL_PNG.subarray(-12),
      ]);
      const key = `agencies/${seed.agencyId}/branding/2026/broken.png`;
      await storage.putObject(key, broken, 'image/png');
      await agencies.updateOne(
        { _id: new Types.ObjectId(seed.agencyId) },
        { $set: { 'branding.logoKey': key } },
      );
      const res = await preview(id).expect(200);
      expect((res.body as Buffer).toString('latin1')).not.toContain(
        '/Subtype /Image',
      );
      await agencies.updateOne(
        { _id: new Types.ObjectId(seed.agencyId) },
        { $unset: { 'branding.logoKey': 1 } },
      );
    });

    it('refuses a preview of a sent statement', async () => {
      const res = await preview(await statementOf(p1)).expect(409);
      expect(
        (JSON.parse((res.body as Buffer).toString('utf8')) as { code?: string })
          .code,
      ).toBe(PAYOUT_STATEMENT_NOT_EDITABLE);
    });
  });

  // A reviewer's own statement is their pay: someone else issues it, unless
  // they hold `agency:payouts:admin` — the rule the figures already had.
  // BM, the main branch's manager, joins the structure: their own draft is
  // then in the branch they review.
  describe("a reviewer's own statement", () => {
    let own: string;
    const code = (res: request.Response) =>
      (res.body as { code?: string }).code;
    const recalculate = (id: string, token: string) =>
      api().post(`${base}/statements/${id}/recalculate`).set(authHeader(token));

    beforeAll(async () => {
      await structures.updateOne(
        { _id: new Types.ObjectId(structureId) },
        { $addToSet: { memberIds: new Types.ObjectId(managerId) } },
      );
      await api()
        .post(`${base}/runs`)
        .set(authHeader(ownerToken))
        .send({ month: MONTH })
        .expect(200);
      own = await statementOf(managerId);
    });

    it('is not theirs to send, recalculate or fill in', async () => {
      expect(code(await send(own, managerToken).expect(403))).toBe(
        PAYOUT_STATEMENT_OWN_STATEMENT,
      );
      expect(code(await recalculate(own, managerToken).expect(403))).toBe(
        PAYOUT_STATEMENT_OWN_STATEMENT,
      );
      const inputs = await api()
        .patch(`${base}/statements/${own}/inputs`)
        .set(authHeader(managerToken))
        .send({
          compliancePercent: 100,
          retentionPercent: null,
          lifeReferrals: null,
          meetingAttendance: null,
        })
        .expect(403);
      expect(code(inputs)).toBe(PAYOUT_STATEMENT_OWN_INPUTS);
      // Nor the amounts entered on it (10 Nov 2026).
      const adjustments = await api()
        .patch(`${base}/statements/${own}/adjustments`)
        .set(authHeader(managerToken))
        .send({
          spiffs: 500,
          complianceAdjustment: null,
          otherAdjustments: null,
        })
        .expect(403);
      expect(code(adjustments)).toBe(PAYOUT_STATEMENT_OWN_STATEMENT);
      expect((await stored(own))!.status).toBe('draft');
    });

    it('is left out of their Send all', async () => {
      const res = await sendAll(managerToken).expect(200);
      expect(res.body).toEqual({ sent: 0, skipped: 0, failed: [] });
      expect((await stored(own))!.status).toBe('draft');
    });

    it('is reported without the internal error when Send all cannot send it', async () => {
      storage.putObject = (key, body, contentType) =>
        key.includes(`/${own}/`)
          ? Promise.reject(new Error('bucket sfa-private: AccessDenied'))
          : realPut(key, body, contentType);
      try {
        // The owner's Send all: BM's draft and P2's (reopened above).
        const res = await sendAll().expect(200);
        const body = res.body as SendAllDraftsResponse;
        expect(body.sent).toBe(1);
        expect(body.failed).toEqual([
          {
            statementId: own,
            userName: expect.any(String) as unknown,
            message: SEND_ALL_FAILED_MESSAGE,
          },
        ]);
        expect(JSON.stringify(body)).not.toContain('AccessDenied');
      } finally {
        storage.putObject = realPut;
      }
      expect((await stored(own))!.status).toBe('draft');
    });

    it('is sent by someone else, and not reopened by its owner', async () => {
      await send(own).expect(200);
      expect(code(await reopen(own, managerToken).expect(403))).toBe(
        PAYOUT_STATEMENT_OWN_STATEMENT,
      );
      expect((await stored(own))!.status).toBe('sent');
    });

    it('is theirs to issue with agency:payouts:admin', async () => {
      await roleAssignments.setUserOverrides(
        seed.agencyId,
        managerId,
        [AgencyPermission.PayoutsAdmin],
        [],
      );
      try {
        await reopen(own, managerToken).expect(200);
        await recalculate(own, managerToken).expect(200);
        const res = await send(own, managerToken).expect(200);
        expect(res.body as PayStatementView).toMatchObject({
          status: 'sent',
          version: 2,
        });
      } finally {
        await roleAssignments.setUserOverrides(
          seed.agencyId,
          managerId,
          [],
          [],
        );
      }
    });
  });
});
