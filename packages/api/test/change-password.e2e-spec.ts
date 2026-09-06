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

/** Inert stub — this suite sends no email; see `password-reset-event.e2e-spec.ts`. */
class NullInngestService {
  send(): Promise<void> {
    return Promise.resolve();
  }
}

describe('Change password (PAC-81, e2e)', () => {
  let app: INestApplication<App>;
  let users: Model<User>;
  let ctx: TestSeedContext;
  let ownerToken: string;
  let seq = 0;

  const freshEmail = () => `change-pass-${++seq}@sfa.local`;
  const ORIGINAL_PASSWORD = 'OriginalPass123!';
  const NEW_PASSWORD = 'BrandNewPass456!';

  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(InngestService)
      .useValue(new NullInngestService())
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

  /**
   * A disposable active user with a session, made the only way the API allows:
   * invite → accept. Each test changes its own user's password, so the shared
   * seed personas keep working for every other suite in the run.
   */
  async function activeSession(email = freshEmail()) {
    const invited = await http()
      .post('/api/v1/users/invite')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email, roleIds: [ctx.producerRoleId], firstName: 'Pat' })
      .expect(201);
    const { userId, inviteToken } = invited.body as {
      userId: string;
      inviteToken?: string;
    };

    const accepted = await http()
      .post('/api/v1/auth/accept-invite')
      .send({ token: inviteToken, password: ORIGINAL_PASSWORD })
      .expect(201);
    const body = accepted.body as {
      accessToken: string;
      refreshToken: string;
    };
    return { userId, email, ...body };
  }

  const changePassword = (token: string, body: Record<string, unknown>) =>
    http()
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  it('rejects a wrong current password with a 400, never a 401', async () => {
    // The status is the contract: the web client's fetch wrapper treats a 401
    // as a dead session (refresh → retry → clearTokens), so a 401 here would
    // sign the user out over a typo.
    const session = await activeSession();

    const res = await changePassword(session.accessToken, {
      currentPassword: 'not-the-password',
      newPassword: NEW_PASSWORD,
    });
    expect(res.status).toBe(400);

    // And the credential is untouched.
    await http()
      .post('/api/v1/auth/login')
      .send({ email: session.email, password: ORIGINAL_PASSWORD })
      .expect(201);
  });

  it('changes the password, returns a working fresh pair, and ends every other session', async () => {
    const session = await activeSession();

    const res = await changePassword(session.accessToken, {
      currentPassword: ORIGINAL_PASSWORD,
      newPassword: NEW_PASSWORD,
    }).expect(201);
    const fresh = res.body as {
      accessToken: string;
      refreshToken: string;
      user: { email: string };
    };
    expect(fresh.user.email).toBe(session.email);

    // The pair that authenticated the change is dead (tokenVersion bump)…
    await http()
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(401);
    await http()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: session.refreshToken })
      .expect(401);

    // …the returned one works immediately…
    await http()
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${fresh.accessToken}`)
      .expect(200);

    // …and so do the new credentials, while the old ones are refused.
    await http()
      .post('/api/v1/auth/login')
      .send({ email: session.email, password: NEW_PASSWORD })
      .expect(201);
    await http()
      .post('/api/v1/auth/login')
      .send({ email: session.email, password: ORIGINAL_PASSWORD })
      .expect(401);
  });

  it('burns a pending reset link — one live credential per account', async () => {
    const session = await activeSession();
    await http()
      .post(`/api/v1/users/${session.userId}/password-reset`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(201);

    const before = await users.findOne({ email: session.email }).lean();
    expect(before?.passwordResetToken).toBeTruthy();

    await changePassword(session.accessToken, {
      currentPassword: ORIGINAL_PASSWORD,
      newPassword: NEW_PASSWORD,
    }).expect(201);

    const after = await users.findOne({ email: session.email }).lean();
    expect(after?.passwordResetToken).toBeUndefined();
    expect(after?.passwordResetExpiresAt).toBeUndefined();
  });

  it('treats an impersonated session like any other — the current password is the gate', async () => {
    // Product call: no special-casing for impersonation (PAC-70). The check
    // that holds either way is the current password — without it, even an
    // impersonating admin gets a 400 and the credential does not move.
    const session = await activeSession();

    const adminLogin = await http()
      .post('/api/v1/auth/login')
      .send({ email: ctx.superAdminEmail, password: TEST_PASSWORD })
      .expect(201);
    const adminToken = (adminLogin.body as { accessToken: string }).accessToken;

    const impersonated = await http()
      .post(`/api/v1/auth/impersonate/${session.userId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);
    const impersonatedToken = (impersonated.body as { accessToken: string })
      .accessToken;

    await changePassword(impersonatedToken, {
      currentPassword: 'not-the-password',
      newPassword: NEW_PASSWORD,
    }).expect(400);

    // With the real current password the change goes through, exactly as it
    // would from the user's own session.
    await changePassword(impersonatedToken, {
      currentPassword: ORIGINAL_PASSWORD,
      newPassword: NEW_PASSWORD,
    }).expect(201);
    await http()
      .post('/api/v1/auth/login')
      .send({ email: session.email, password: NEW_PASSWORD })
      .expect(201);
  });

  it('validates the new password without touching anything', async () => {
    const session = await activeSession();

    await changePassword(session.accessToken, {
      currentPassword: ORIGINAL_PASSWORD,
      newPassword: 'short',
    }).expect(400);

    // Neither the credential nor the session generation moved.
    await http()
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(200);
    await http()
      .post('/api/v1/auth/login')
      .send({ email: session.email, password: ORIGINAL_PASSWORD })
      .expect(201);
  });
});
