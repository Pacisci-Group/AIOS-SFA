import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import type { PushSubscriptionResponse } from '@sfa/shared';
import { Model } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { PushSubscription } from '../src/notifications/schemas/push-subscription.schema';
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
 * Push subscriptions — the request-path half of web push (PAC-154, PR4).
 *
 * Sending is the worker's and is covered in
 * `test/worker/deliver-notification.e2e-spec.ts`; this suite is about the
 * rows a browser registers and withdraws, and the one index that makes
 * re-subscribing after a soft delete possible.
 */
describe('Push subscriptions (PAC-154 PR4)', () => {
  let app: INestApplication<App>;
  let ctx: TestSeedContext;
  let producerToken: string;
  let producerId: string;
  let csrToken: string;
  let csrId: string;
  let model: Model<PushSubscription>;

  const ENDPOINT =
    'https://fcm.googleapis.com/fcm/send/dEvIcE-1:APA91bF%2Fabc/def%3D%3D';
  const KEYS = { p256dh: 'BPk-p256dh-public-key', auth: 'auth-secret-16b' };
  const body = (endpoint = ENDPOINT) => ({
    endpoint,
    expirationTime: null,
    keys: KEYS,
    userAgent: 'Mozilla/5.0 (Macintosh) Chrome/130',
  });

  const put = (token: string, payload: unknown) =>
    request(app.getHttpServer())
      .put('/api/v1/notifications/push-subscriptions')
      .set(authHeader(token))
      .send(payload as object);
  const del = (token: string, payload: unknown) =>
    request(app.getHttpServer())
      .delete('/api/v1/notifications/push-subscriptions')
      .set(authHeader(token))
      .send(payload as object);

  beforeAll(async () => {
    app = await createTestApp();
    await dropTestDatabase(app);
    ctx = await seedTestData(app);
    model = app.get<Model<PushSubscription>>(
      getModelToken(PushSubscription.name),
    );
    // `autoIndex` builds these on connect, but the suite dropped the database
    // after that — build them again so the partial unique index below is
    // really there for the re-subscribe case.
    await model.syncIndexes();

    producerToken = (await login(app, ctx.producerEmail, TEST_PASSWORD))
      .accessToken;
    csrToken = (await login(app, ctx.csrEmail, TEST_PASSWORD)).accessToken;

    const users = app.get<Model<User>>(getModelToken(User.name));
    producerId = (await users
      .findOne({ email: ctx.producerEmail })
      .lean())!._id.toHexString();
    csrId = (await users
      .findOne({ email: ctx.csrEmail })
      .lean())!._id.toHexString();
  });

  afterAll(async () => {
    // Drop on the way out as well as on the way in. The suite seeds
    // `test-agency`; a suite that runs next and seeds before dropping
    // (`platform-users`) dies on `slug_1` E11000 otherwise — which is what
    // failed the PR4 CI run, with this suite directly ahead of it.
    await dropTestDatabase(app);
    await closeTestApp(app);
  });

  beforeEach(async () => {
    await model.deleteMany({});
  });

  it('declares the unique endpoint index as partial on a stored null', async () => {
    const indexes = await model.collection.indexes();
    const unique = indexes.find((index) => index.key.endpoint === 1);
    expect(unique).toBeDefined();
    expect(unique?.unique).toBe(true);
    expect(unique?.partialFilterExpression).toEqual({
      deletedAt: { $type: 'null' },
    });
  });

  it('requires a session on every route but the public key', async () => {
    await request(app.getHttpServer())
      .put('/api/v1/notifications/push-subscriptions')
      .send(body())
      .expect(401);
    await request(app.getHttpServer())
      .delete('/api/v1/notifications/push-subscriptions')
      .send({ endpoint: ENDPOINT })
      .expect(401);
  });

  describe('PUT /notifications/push-subscriptions', () => {
    it('registers the browser and echoes the row without the keys', async () => {
      const res = await put(producerToken, body()).expect(200);
      const row = res.body as PushSubscriptionResponse;

      expect(row).toMatchObject({
        endpoint: ENDPOINT,
        userAgent: 'Mozilla/5.0 (Macintosh) Chrome/130',
        lastSuccessAt: null,
      });
      expect(typeof row.id).toBe('string');
      expect(typeof row.createdAt).toBe('string');
      expect(Object.keys(row).sort()).toEqual([
        'createdAt',
        'endpoint',
        'id',
        'lastSuccessAt',
        'userAgent',
      ]);

      const stored = await model.findOne({ endpoint: ENDPOINT }).lean();
      expect(stored?.userId.toHexString()).toBe(producerId);
      expect(stored?.keys).toEqual(KEYS);
      // A real BSON null, not an absent field: the partial index depends on it.
      expect(Object.prototype.hasOwnProperty.call(stored, 'deletedAt')).toBe(
        true,
      );
      expect(stored?.deletedAt).toBeNull();
    });

    it('is an upsert: the same endpoint twice is one row, refreshed', async () => {
      const first = await put(producerToken, body()).expect(200);
      const second = await put(producerToken, {
        ...body(),
        keys: { p256dh: 'BPk-rotated', auth: 'auth-rotated-16b' },
        userAgent: 'Mozilla/5.0 (Macintosh) Chrome/131',
      }).expect(200);

      expect((second.body as PushSubscriptionResponse).id).toBe(
        (first.body as PushSubscriptionResponse).id,
      );
      await expect(model.countDocuments({})).resolves.toBe(1);
      const stored = await model.findOne({ endpoint: ENDPOINT }).lean();
      expect(stored?.keys.p256dh).toBe('BPk-rotated');
      expect(stored?.userAgent).toBe('Mozilla/5.0 (Macintosh) Chrome/131');
    });

    it('moves a shared device to whoever signs in on it', async () => {
      await put(producerToken, body()).expect(200);
      await put(csrToken, body()).expect(200);

      await expect(model.countDocuments({})).resolves.toBe(1);
      const stored = await model.findOne({ endpoint: ENDPOINT }).lean();
      expect(stored?.userId.toHexString()).toBe(csrId);
    });

    it('lets a device subscribe again after its row was soft-deleted', async () => {
      const first = await put(producerToken, body()).expect(200);
      // What the worker does on a 410 from the push service.
      await model.updateOne(
        { endpoint: ENDPOINT },
        { $set: { deletedAt: new Date() } },
      );

      const again = await put(producerToken, body()).expect(200);

      // A new live row beside the dead one — the partial index let it in.
      expect((again.body as PushSubscriptionResponse).id).not.toBe(
        (first.body as PushSubscriptionResponse).id,
      );
      await expect(model.countDocuments({ endpoint: ENDPOINT })).resolves.toBe(
        2,
      );
      await expect(
        model.countDocuments({ endpoint: ENDPOINT, deletedAt: null }),
      ).resolves.toBe(1);
    });

    it('keeps several devices per user', async () => {
      await put(producerToken, body()).expect(200);
      await put(
        producerToken,
        body('https://updates.push.services.mozilla.com/wpush/v2/gAAAA'),
      ).expect(200);

      await expect(
        model.countDocuments({ userId: producerId, deletedAt: null }),
      ).resolves.toBe(2);
    });

    it('rejects a non-https endpoint, an https endpoint off the known push services, and a body missing the keys', async () => {
      await put(producerToken, body('http://example.com/push')).expect(400);
      // SSRF (PR4 review): https alone would let any signed-in user point the
      // worker at any host from inside the network.
      await put(
        producerToken,
        body('https://169.254.169.254/latest/meta-data/'),
      ).expect(400);
      await put(
        producerToken,
        body('https://fcm.googleapis.com.evil.net/send/x'),
      ).expect(400);
      await put(producerToken, { endpoint: ENDPOINT }).expect(400);
      await put(producerToken, {
        endpoint: ENDPOINT,
        keys: { p256dh: 'x' },
      }).expect(400);
    });
  });

  describe('DELETE /notifications/push-subscriptions', () => {
    it('takes the endpoint in the body and soft-deletes the caller’s row', async () => {
      await put(producerToken, body()).expect(200);

      await del(producerToken, { endpoint: ENDPOINT }).expect(204);

      const stored = await model.findOne({ endpoint: ENDPOINT }).lean();
      expect(stored).not.toBeNull();
      expect(stored?.deletedAt).toBeInstanceOf(Date);
      // Never a hard delete (PAC-155).
      await expect(model.countDocuments({})).resolves.toBe(1);
    });

    it("is a 404 for somebody else's endpoint, and for one already withdrawn", async () => {
      await put(producerToken, body()).expect(200);

      await del(csrToken, { endpoint: ENDPOINT }).expect(404);
      const untouched = await model.findOne({ endpoint: ENDPOINT }).lean();
      expect(untouched?.deletedAt).toBeNull();

      await del(producerToken, { endpoint: ENDPOINT }).expect(204);
      await del(producerToken, { endpoint: ENDPOINT }).expect(404);
    });

    it('rejects a body without an endpoint', async () => {
      await del(producerToken, {}).expect(400);
    });
  });

  describe('GET /public/push/vapid-public-key', () => {
    it('is 404 while push is not configured, with no session needed', async () => {
      // `test/setup-env.ts` pins the VAPID settings empty.
      await request(app.getHttpServer())
        .get('/api/v1/public/push/vapid-public-key')
        .expect(404);
    });
  });
});
