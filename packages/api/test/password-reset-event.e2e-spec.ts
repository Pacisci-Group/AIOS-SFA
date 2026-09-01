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
 * The same substitution `invite-event.e2e-spec.ts` makes, for the same reason:
 * these tests are about what the API *emits*, and standing up an Inngest server
 * to observe it would test the platform rather than our code. The worker side is
 * covered by `worker/send-password-reset-email.e2e-spec.ts`.
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

describe('Password reset → Inngest event (e2e)', () => {
  let app: INestApplication<App>;
  let inngest: CaptureInngestService;
  let users: Model<User>;
  let ctx: TestSeedContext;
  let ownerToken: string;
  let seq = 0;

  const freshEmail = () => `reset-event-${++seq}@sfa.local`;
  const ORIGINAL_PASSWORD = 'OriginalPass123!';

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

  /**
   * An active user, made the only way the API allows: invite, then accept.
   * `sendPasswordReset` refuses anyone who has not accepted.
   */
  async function activeUser(email = freshEmail()) {
    const invited = await request(app.getHttpServer())
      .post('/api/v1/users/invite')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email, roleIds: [ctx.producerRoleId], firstName: 'Pat' })
      .expect(201);

    const { userId, inviteToken } = invited.body as {
      userId: string;
      inviteToken?: string;
    };
    await request(app.getHttpServer())
      .post('/api/v1/auth/accept-invite')
      .send({ token: inviteToken, password: ORIGINAL_PASSWORD })
      .expect(201);

    inngest.sent.length = 0;
    return { userId, email };
  }

  const sendReset = (userId: string) =>
    request(app.getHttpServer())
      .post(`/api/v1/users/${userId}/password-reset`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send();

  it('emits exactly one well-formed event per reset', async () => {
    const { userId, email } = await activeUser();

    const res = await sendReset(userId);
    expect(res.status).toBe(201);

    expect(inngest.sent).toHaveLength(1);
    expect(inngest.sent[0].name).toBe('email/password-reset.requested.v1');

    const data: Record<string, unknown> = inngest.sent[0].data;
    expect(data).toMatchObject({
      to: email,
      agencyName: expect.any(String) as unknown,
    });

    // Tenancy and identity ride on the payload: the consumer runs in another
    // process and cannot look them up.
    expect(data.userId).toMatch(/^[0-9a-f]{24}$/);
    expect(data.agencyId).toMatch(/^[0-9a-f]{24}$/);

    // Instants cross the wire as ISO strings — the catalog cannot use
    // transforms, so `z.coerce.date()` is unavailable to it.
    expect(typeof data.expiresAt).toBe('string');
    expect(new Date(data.expiresAt as string).toString()).not.toBe(
      'Invalid Date',
    );
  });

  it('never carries a field naming who triggered it', async () => {
    // A product decision with a social-engineering cost, enforced here so it
    // cannot be undone by someone adding the "obvious" symmetry with the invite
    // event, which does name its inviter.
    const { userId } = await activeUser();
    await sendReset(userId).expect(201);

    const data = inngest.sent[0].data;
    expect(data).not.toHaveProperty('inviterName');
    expect(data).not.toHaveProperty('requestedByName');
    expect(data).not.toHaveProperty('requestedByUserId');
  });

  it('emits nothing when a reset is refused by the cooldown', async () => {
    const { userId } = await activeUser();
    await sendReset(userId).expect(201);
    inngest.sent.length = 0;

    // An immediate second reset is a 409 and must not enqueue work — otherwise
    // the cooldown throttles the HTTP response while still sending the email,
    // which is the opposite of what it is for.
    await sendReset(userId).expect(409);
    expect(inngest.sent).toHaveLength(0);
  });

  it('emits nothing when the target is deactivated', async () => {
    const { userId } = await activeUser();
    await request(app.getHttpServer())
      .delete(`/api/v1/users/${userId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    inngest.sent.length = 0;

    await sendReset(userId).expect(409);
    expect(inngest.sent).toHaveLength(0);
  });

  it('emits a second event with a NEW reset URL on a re-issue', async () => {
    const { userId, email } = await activeUser();
    await sendReset(userId).expect(201);
    const firstUrl = inngest.sent[0].data.resetUrl as string;
    inngest.sent.length = 0;

    // Clear the cooldown rather than sleeping through it.
    await users.updateOne(
      { email },
      { $unset: { passwordResetLastSentAt: 1 } },
    );

    await sendReset(userId).expect(201);

    expect(inngest.sent).toHaveLength(1);
    // The consumer's idempotency key is the reset URL. Re-issuing mints a new
    // token, so the URL differs and the second email is sent rather than
    // deduped away — which matters, because re-issuing is the owner's only
    // recovery when the first link goes astray.
    expect(inngest.sent[0].data.resetUrl).not.toBe(firstUrl);
  });

  it('leaves the token stored when the event cannot be sent', async () => {
    // The mirror of the invite flow's "never a half-created account". The token
    // is written before the event is emitted, so an Inngest outage leaves a
    // reset the owner can re-issue — and, more importantly, does not leave a
    // user whose old link was invalidated by a reset that never arrived.
    const { userId, email } = await activeUser();
    inngest.failWith = new Error('inngest unreachable');

    const res = await sendReset(userId);
    expect(res.status).toBeGreaterThanOrEqual(500);

    const user = await users.findOne({ email }).lean();
    expect(user?.isActive).toBe(true);
    expect(user?.passwordResetToken).toBeTruthy();
  });
});
