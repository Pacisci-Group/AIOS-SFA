import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import type { NotificationListResponse, NotificationRecord } from '@sfa/shared';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Notification } from '../src/notifications/schemas/notification.schema';
import { User } from '../src/users/schemas/user.schema';
import { authHeader, login } from './helpers/auth.helper';
import {
  seedTestData,
  TEST_PASSWORD,
  type TestSeedContext,
} from './helpers/seed-test-data';
import {
  closeTestApp,
  createTestApp,
  dropTestDatabase,
} from './helpers/test-app';

/**
 * The read side of notifications (PAC-154, PR1).
 *
 * Rows are seeded straight through the model: `createTestApp()` stubs
 * `InngestService`, so no endpoint here can produce one, and the writer is
 * covered on its own in `test/worker/deliver-notification.e2e-spec.ts`.
 */
describe('Notifications (PAC-154)', () => {
  let app: INestApplication<App>;
  let ctx: TestSeedContext;
  let producerToken: string;
  let csrToken: string;
  let superAdminToken: string;
  let producerId: string;
  let model: Model<Notification>;

  const BASE = new Date('2026-10-01T12:00:00.000Z');

  /** `count` rows for one recipient, one minute apart, newest = index 0. */
  async function seedRows(
    recipientId: string,
    count: number,
    readEvery = 0,
  ): Promise<string[]> {
    const docs = Array.from({ length: count }, (_, index) => ({
      recipientId: new Types.ObjectId(recipientId),
      agencyId: null,
      type: 'bug_report.filed' as const,
      title: `Row ${index}`,
      body: `Body ${index}`,
      href: '/admin/bugs',
      entity: { kind: 'bugReport', id: `entity-${index}` },
      actorId: null,
      data: { index },
      readAt: readEvery > 0 && index % readEvery === 0 ? BASE : null,
      dedupeKey: `test:${recipientId}:${index}`,
      createdAt: new Date(BASE.getTime() - index * 60_000),
    }));
    const inserted = await model.insertMany(docs);
    return inserted.map((row) => row._id.toHexString());
  }

  const get = (path: string, token: string) =>
    request(app.getHttpServer()).get(`/api/v1${path}`).set(authHeader(token));

  const listBody = (res: request.Response) =>
    res.body as NotificationListResponse;
  const recordBody = (res: request.Response) => res.body as NotificationRecord;
  const countBody = (res: request.Response) => res.body as { unread: number };

  beforeAll(async () => {
    app = await createTestApp();
    await dropTestDatabase(app);
    ctx = await seedTestData(app);
    model = app.get<Model<Notification>>(getModelToken(Notification.name));

    producerToken = (await login(app, ctx.producerEmail, TEST_PASSWORD))
      .accessToken;
    csrToken = (await login(app, ctx.csrEmail, TEST_PASSWORD)).accessToken;
    superAdminToken = (await login(app, ctx.superAdminEmail, TEST_PASSWORD))
      .accessToken;

    const userModel = app.get<Model<User>>(getModelToken(User.name));
    const producer = await userModel
      .findOne({ email: ctx.producerEmail })
      .lean();
    producerId = producer!._id.toString();
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  beforeEach(async () => {
    await model.deleteMany({});
  });

  it('requires a session', async () => {
    await request(app.getHttpServer()).get('/api/v1/notifications').expect(401);
  });

  it('lists newest first and walks every row exactly once through the cursor', async () => {
    const ids = await seedRows(producerId, 23);

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const query = cursor ? `?limit=10&cursor=${cursor}` : '?limit=10';
      const res = await get(`/notifications${query}`, producerToken).expect(
        200,
      );
      const body = res.body as {
        items: Array<{ id: string; createdAt: string }>;
        nextCursor: string | null;
      };
      pages += 1;
      seen.push(...body.items.map((item) => item.id));
      // Newest first within the page.
      const stamps = body.items.map((item) => item.createdAt);
      expect([...stamps].sort().reverse()).toEqual(stamps);
      cursor = body.nextCursor;
    } while (cursor);

    expect(pages).toBe(3);
    expect(seen).toEqual(ids);
    expect(new Set(seen).size).toBe(23);
  });

  it('defaults to twenty per page and refuses more than fifty', async () => {
    await seedRows(producerId, 25);

    const res = await get('/notifications', producerToken).expect(200);
    expect(listBody(res).items).toHaveLength(20);
    expect(listBody(res).nextCursor).toEqual(expect.any(String));

    await get('/notifications?limit=500', producerToken).expect(400);
    await get('/notifications?limit=0', producerToken).expect(400);
  });

  it('rejects a malformed cursor with 400', async () => {
    await get('/notifications?cursor=not-a-cursor', producerToken).expect(400);
    const junk = Buffer.from('2026-13-99T00:00:00.000Z|zzz').toString(
      'base64url',
    );
    await get(`/notifications?cursor=${junk}`, producerToken).expect(400);
  });

  it('unread=1 narrows to unread rows and unread-count agrees', async () => {
    // Every third row read → 4 read, 8 unread.
    await seedRows(producerId, 12, 3);

    const all = await get('/notifications', producerToken).expect(200);
    expect(listBody(all).items).toHaveLength(12);

    const unread = await get('/notifications?unread=1', producerToken).expect(
      200,
    );
    expect(listBody(unread).items).toHaveLength(8);
    for (const item of listBody(unread).items) {
      expect(item.readAt).toBeNull();
    }

    const count = await get(
      '/notifications/unread-count',
      producerToken,
    ).expect(200);
    expect(countBody(count)).toEqual({ unread: 8 });
  });

  it('shows each recipient only their own rows', async () => {
    await seedRows(producerId, 3);
    await seedRows(ctx.csrUserId, 2);

    const producer = await get('/notifications', producerToken).expect(200);
    expect(listBody(producer).items).toHaveLength(3);
    const csr = await get('/notifications', csrToken).expect(200);
    expect(listBody(csr).items).toHaveLength(2);
    const admin = await get('/notifications', superAdminToken).expect(200);
    expect(listBody(admin).items).toHaveLength(0);
  });

  it('marks one row read, is a no-op the second time, and 404s on a row that is not yours', async () => {
    const [id] = await seedRows(producerId, 2);

    const first = await request(app.getHttpServer())
      .patch(`/api/v1/notifications/${id}/read`)
      .set(authHeader(producerToken))
      .expect(200);
    expect(recordBody(first).id).toBe(id);
    expect(recordBody(first).readAt).toEqual(expect.any(String));

    const second = await request(app.getHttpServer())
      .patch(`/api/v1/notifications/${id}/read`)
      .set(authHeader(producerToken))
      .expect(200);
    // A second click is not a second fact: the original instant stands.
    expect(recordBody(second).readAt).toBe(recordBody(first).readAt);

    await request(app.getHttpServer())
      .patch(`/api/v1/notifications/${id}/read`)
      .set(authHeader(csrToken))
      .expect(404);
    await request(app.getHttpServer())
      .patch('/api/v1/notifications/not-an-id/read')
      .set(authHeader(producerToken))
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/api/v1/notifications/${new Types.ObjectId().toHexString()}/read`)
      .set(authHeader(producerToken))
      .expect(404);

    const count = await get(
      '/notifications/unread-count',
      producerToken,
    ).expect(200);
    expect(countBody(count)).toEqual({ unread: 1 });
  });

  it('read-all marks every unread row for the caller and nobody else', async () => {
    await seedRows(producerId, 5, 5); // index 0 read → 4 unread
    await seedRows(ctx.csrUserId, 2);

    const res = await request(app.getHttpServer())
      .post('/api/v1/notifications/read-all')
      .set(authHeader(producerToken))
      .expect(200);
    expect(res.body).toEqual({ updated: 4 });

    const mine = await get('/notifications/unread-count', producerToken).expect(
      200,
    );
    expect(countBody(mine)).toEqual({ unread: 0 });
    const theirs = await get('/notifications/unread-count', csrToken).expect(
      200,
    );
    expect(countBody(theirs)).toEqual({ unread: 2 });

    const again = await request(app.getHttpServer())
      .post('/api/v1/notifications/read-all')
      .set(authHeader(producerToken))
      .expect(200);
    expect(again.body).toEqual({ updated: 0 });
  });

  it('an impersonated session reads and marks the target user’s rows (PAC-70)', async () => {
    const [id] = await seedRows(producerId, 2);

    const session = await request(app.getHttpServer())
      .post(`/api/v1/auth/impersonate/${producerId}`)
      .set(authHeader(superAdminToken))
      .expect(201);
    const asProducer = (session.body as { accessToken: string }).accessToken;

    const list = await get('/notifications', asProducer).expect(200);
    expect(listBody(list).items).toHaveLength(2);

    await request(app.getHttpServer())
      .patch(`/api/v1/notifications/${id}/read`)
      .set(authHeader(asProducer))
      .expect(200);

    // Scoped to the impersonated user, not the operator: the producer's own
    // session now sees one unread, and the operator's own list is untouched.
    const count = await get(
      '/notifications/unread-count',
      producerToken,
    ).expect(200);
    expect(countBody(count)).toEqual({ unread: 1 });
    const admin = await get('/notifications', superAdminToken).expect(200);
    expect(listBody(admin).items).toHaveLength(0);
  });

  it('returns the wire shape the web app renders from', async () => {
    await seedRows(producerId, 1);
    const res = await get('/notifications', producerToken).expect(200);
    const [item] = listBody(res).items;
    const { id, ...rest } = item;
    expect(id).toMatch(/^[0-9a-f]{24}$/);
    expect(rest).toEqual({
      type: 'bug_report.filed',
      title: 'Row 0',
      body: 'Body 0',
      href: '/admin/bugs',
      entity: { kind: 'bugReport', id: 'entity-0' },
      actorId: null,
      agencyId: null,
      data: { index: 0 },
      readAt: null,
      createdAt: BASE.toISOString(),
    });
  });
});
