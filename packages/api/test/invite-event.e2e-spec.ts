import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { InngestService } from '../src/inngest/inngest.service';
import { User } from '../src/users/schemas/user.schema';
import { dropTestDatabase, closeTestApp } from './helpers/test-app';
import {
  seedTestData,
  TEST_PASSWORD,
  TestSeedContext,
} from './helpers/seed-test-data';

/**
 * Captures what the API would have handed to Inngest.
 *
 * Substituted for the real `InngestService` so no event leaves the process —
 * these tests are about what the API *emits*, and standing up an Inngest server
 * to observe that would test the platform rather than our code. The worker side
 * is covered separately by `send-invite-email.e2e-spec.ts`.
 */
class CaptureInngestService {
  readonly sent: Array<{ name: string; data: Record<string, unknown> }> = [];
  /** Set to make the next send throw, simulating Inngest being unreachable. */
  failWith: Error | null = null;

  send(
    event: { name: string; create: (data: unknown) => unknown },
    data: Record<string, unknown>,
  ): Promise<void> {
    if (this.failWith) return Promise.reject(this.failWith);
    this.sent.push({ name: event.name, data });
    return Promise.resolve();
  }
}

describe('Invite → Inngest event (e2e)', () => {
  let app: INestApplication<App>;
  let inngest: CaptureInngestService;
  let users: Model<User>;
  let ctx: TestSeedContext;
  let ownerToken: string;
  let seq = 0;

  const freshEmail = () => `invite-event-${++seq}@sfa.local`;

  beforeAll(async () => {
    inngest = new CaptureInngestService();

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(InngestService)
      .useValue(inngest)
      .compile();

    app = moduleRef.createNestApplication<INestApplication<App>>();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();

    await dropTestDatabase(app);
    ctx = await seedTestData(app);
    users = app.get<Model<User>>(getModelToken(User.name));

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ctx.ownerEmail, password: TEST_PASSWORD })
      .expect(201);
    ownerToken = (login.body as { accessToken: string }).accessToken;
  });

  afterAll(async () => {
    if (app) {
      await dropTestDatabase(app);
      await closeTestApp(app);
    }
  });

  beforeEach(() => {
    inngest.sent.length = 0;
    inngest.failWith = null;
  });

  async function invite(email: string) {
    return request(app.getHttpServer())
      .post('/api/v1/users/invite')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email, roleIds: [ctx.producerRoleId], firstName: 'Pat' });
  }

  it('emits exactly one well-formed event per invite', async () => {
    const email = freshEmail();
    const res = await invite(email);
    expect(res.status).toBe(201);

    expect(inngest.sent).toHaveLength(1);
    expect(inngest.sent[0].name).toBe('email/invite.requested.v1');

    const data: Record<string, unknown> = inngest.sent[0].data;
    expect(data).toMatchObject({
      to: email,
      agencyName: expect.any(String) as unknown,
      roleNames: expect.arrayContaining([expect.any(String)]) as unknown,
    });

    // Tenancy and identity have to be on the payload: the consumer runs in
    // another process (and, later, another container) and cannot look them up.
    expect(data.userId).toMatch(/^[0-9a-f]{24}$/);
    expect(data.agencyId).toMatch(/^[0-9a-f]{24}$/);

    // Instants cross the wire as ISO strings — Inngest rejects schemas with
    // transforms, so `z.coerce.date()` is not available to the catalog.
    expect(typeof data.expiresAt).toBe('string');
    expect(new Date(data.expiresAt as string).toString()).not.toBe(
      'Invalid Date',
    );
  });

  it('emits nothing when a resend is refused by the cooldown', async () => {
    const email = freshEmail();
    const created = await invite(email);
    const userId = (created.body as { userId: string }).userId;
    inngest.sent.length = 0;

    // An immediate resend is a 409, and must not enqueue work — otherwise the
    // cooldown throttles the HTTP response while still sending the email.
    const res = await request(app.getHttpServer())
      .post(`/api/v1/users/${userId}/invite/resend`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send();

    expect(res.status).toBe(409);
    expect(inngest.sent).toHaveLength(0);
  });

  it('emits a second event with a NEW invite URL on an allowed resend', async () => {
    const email = freshEmail();
    const created = await invite(email);
    const userId = (created.body as { userId: string }).userId;
    const firstUrl = inngest.sent[0].data.inviteUrl as string;
    inngest.sent.length = 0;

    // Clear the cooldown rather than sleeping through it.
    await users.updateOne({ email }, { $unset: { inviteLastSentAt: 1 } });

    await request(app.getHttpServer())
      .post(`/api/v1/users/${userId}/invite/resend`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send()
      .expect(201);

    expect(inngest.sent).toHaveLength(1);
    // The consumer's idempotency key is the invite URL. A resend mints a new
    // token, so the URL differs and the second email is correctly sent rather
    // than deduped away — which matters, because resending is the owner's only
    // recovery when the first invite goes astray.
    expect(inngest.sent[0].data.inviteUrl).not.toBe(firstUrl);
  });

  it('leaves a resendable pending invite when the event cannot be sent', async () => {
    // The property `MailService`'s docblock has always protected: never a
    // half-created account, always a pending invite the owner can resend. It
    // survives the move to async delivery because the user row is written
    // before the event is emitted.
    const email = freshEmail();
    inngest.failWith = new Error('inngest unreachable');

    const res = await invite(email);
    expect(res.status).toBeGreaterThanOrEqual(500);

    const user = await users.findOne({ email }).lean();
    expect(user).not.toBeNull();
    expect(user?.isActive).toBe(false);
  });
});
