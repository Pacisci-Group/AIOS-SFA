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

/** Same capture substitution as `password-reset-event.e2e-spec.ts`. */
class CaptureInngestService {
  readonly sent: Array<{ name: string; data: Record<string, unknown> }> = [];

  send(event: { name: string }, data: Record<string, unknown>): Promise<void> {
    this.sent.push({ name: event.name, data });
    return Promise.resolve();
  }
}

const UNIFORM_MESSAGE =
  'If an account exists for that address, a password reset link is on its way.';

describe('Forgot password (PAC-81, e2e)', () => {
  let app: INestApplication<App>;
  let inngest: CaptureInngestService;
  let users: Model<User>;
  let ctx: TestSeedContext;
  let ownerToken: string;
  let seq = 0;

  const freshEmail = () => `forgot-pass-${++seq}@sfa.local`;
  const ORIGINAL_PASSWORD = 'OriginalPass123!';

  const http = () => request(app.getHttpServer());
  const forgot = (email: string) =>
    http().post('/api/v1/auth/forgot-password').send({ email });

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

    const login = await http()
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
  });

  /** Invite → accept, so each test owns a disposable active user. */
  async function activeUser(email = freshEmail()) {
    const invited = await http()
      .post('/api/v1/users/invite')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email, roleIds: [ctx.producerRoleId], firstName: 'Pat' })
      .expect(201);
    const { userId, inviteToken } = invited.body as {
      userId: string;
      inviteToken?: string;
    };
    await http()
      .post('/api/v1/auth/accept-invite')
      .send({ token: inviteToken, password: ORIGINAL_PASSWORD })
      .expect(201);
    inngest.sent.length = 0;
    return { userId, email };
  }

  it('answers a known address with 202 and mints a working reset', async () => {
    const { email } = await activeUser();

    const res = await forgot(email).expect(202);
    expect(res.body).toEqual({ message: UNIFORM_MESSAGE });

    // The digest and expiry landed on the user…
    const user = await users.findOne({ email }).lean();
    expect(user?.passwordResetToken).toBeTruthy();
    expect(user?.passwordResetExpiresAt).toBeTruthy();

    // …and exactly one email event went out, same schema as the admin flow.
    expect(inngest.sent).toHaveLength(1);
    expect(inngest.sent[0].name).toBe('email/password-reset.requested.v1');
    const resetUrl = inngest.sent[0].data.resetUrl as string;
    expect(resetUrl).toContain('/auth/reset-password?token=');

    // The link completes through the untouched PAC-79 endpoints: one token
    // scheme, end to end.
    const token = new URL(resetUrl).searchParams.get('token')!;
    await http().get(`/api/v1/auth/password-reset/${token}`).expect(200);
    const NEW_PASSWORD = 'ForgotFlowPass789!';
    await http()
      .post('/api/v1/auth/reset-password')
      .send({ token, password: NEW_PASSWORD })
      .expect(201);
    await http()
      .post('/api/v1/auth/login')
      .send({ email, password: NEW_PASSWORD })
      .expect(201);
  });

  it('answers an unknown address with the identical 202 and does nothing', async () => {
    const res = await forgot('nobody-here@sfa.local').expect(202);
    expect(res.body).toEqual({ message: UNIFORM_MESSAGE });
    expect(inngest.sent).toHaveLength(0);
  });

  it('never exposes a token in the response, unlike the admin trigger', async () => {
    // The admin endpoint returns `resetToken` outside production for local
    // walkthroughs. Here that would break the uniform-response property: a
    // body that sometimes carries a token is an account oracle.
    const { email } = await activeUser();
    const res = await forgot(email).expect(202);
    expect(res.body).toEqual({ message: UNIFORM_MESSAGE });
  });

  it('silently respects the per-user cooldown', async () => {
    const { email } = await activeUser();
    await forgot(email).expect(202);
    expect(inngest.sent).toHaveLength(1);
    inngest.sent.length = 0;

    // Inside the 60s cooldown: same 202 — a 409 here would leak that the
    // address exists — but no second email.
    const res = await forgot(email).expect(202);
    expect(res.body).toEqual({ message: UNIFORM_MESSAGE });
    expect(inngest.sent).toHaveLength(0);

    // Past the cooldown (cleared in Mongo rather than slept through), a new
    // link with a new URL goes out.
    await users.updateOne(
      { email },
      { $unset: { passwordResetLastSentAt: 1 } },
    );
    await forgot(email).expect(202);
    expect(inngest.sent).toHaveLength(1);
  });

  it('sends nothing to a deactivated user', async () => {
    const { userId, email } = await activeUser();
    await http()
      .delete(`/api/v1/users/${userId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    inngest.sent.length = 0;

    const res = await forgot(email).expect(202);
    expect(res.body).toEqual({ message: UNIFORM_MESSAGE });
    expect(inngest.sent).toHaveLength(0);

    // And no digest was minted — a reset is not a reactivation.
    const user = await users.findOne({ email }).lean();
    expect(user?.passwordResetToken).toBeUndefined();
  });

  it('sends nothing to a pending invitee — their way in is the invite link', async () => {
    const email = freshEmail();
    await http()
      .post('/api/v1/users/invite')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email, roleIds: [ctx.producerRoleId] })
      .expect(201);
    inngest.sent.length = 0;

    await forgot(email).expect(202);
    expect(inngest.sent).toHaveLength(0);

    // Critically, the pending invite token survives — minting a reset would
    // have cleared it (one live credential) and stranded the invitee.
    const user = await users.findOne({ email }).lean();
    expect(user?.inviteToken).toBeTruthy();
    expect(user?.passwordResetToken).toBeUndefined();
  });

  it('sends nothing for a platform admin', async () => {
    await forgot(ctx.superAdminEmail).expect(202);
    expect(inngest.sent).toHaveLength(0);
    const admin = await users.findOne({ email: ctx.superAdminEmail }).lean();
    expect(admin?.passwordResetToken).toBeUndefined();
  });

  it('rejects a malformed email with a 400', async () => {
    await forgot('not-an-email').expect(400);
    expect(inngest.sent).toHaveLength(0);
  });
});
