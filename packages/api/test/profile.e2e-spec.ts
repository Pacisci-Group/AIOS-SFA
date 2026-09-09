import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { dropTestDatabase, closeTestApp } from './helpers/test-app';
import {
  seedTestData,
  TEST_PASSWORD,
  TestSeedContext,
} from './helpers/seed-test-data';

interface AuthUserBody {
  id: string;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
}

/**
 * The `/me/*` profile endpoints (PAC-81). Storage-dependent paths (presign,
 * a completed upload) are exercised by the Bruno collection against MinIO;
 * here we cover everything that must hold **before** storage is consulted —
 * name edits, clearable semantics, and the per-user key-ownership rejection,
 * which fires ahead of any storage call.
 */
describe('Profile (PAC-81, e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestSeedContext;
  let producerToken: string;
  let producerId: string;

  const http = () => request(app.getHttpServer());
  const me = (token: string) =>
    http().get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
  const patchProfile = (token: string, body: Record<string, unknown>) =>
    http()
      .patch('/api/v1/me/profile')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  const patchAvatar = (token: string, body: Record<string, unknown>) =>
    http()
      .patch('/api/v1/me/avatar')
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

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

    const login = await http()
      .post('/api/v1/auth/login')
      .send({ email: ctx.producerEmail, password: TEST_PASSWORD })
      .expect(201);
    const body = login.body as { accessToken: string; user: { id: string } };
    producerToken = body.accessToken;
    producerId = body.user.id;
  });

  afterAll(async () => {
    if (app) {
      await dropTestDatabase(app);
      await closeTestApp(app);
    }
  });

  it('exposes the name halves and avatarUrl on the auth blob', async () => {
    const res = await me(producerToken).expect(200);
    const body = res.body as AuthUserBody;
    expect(body).toHaveProperty('firstName');
    expect(body).toHaveProperty('lastName');
    expect(body.avatarUrl).toBeNull();
  });

  it('edits the name and reflects it in GET /auth/me', async () => {
    const res = await patchProfile(producerToken, {
      firstName: 'Rewritten',
      lastName: 'Person',
    }).expect(200);
    const body = res.body as AuthUserBody;
    expect(body.firstName).toBe('Rewritten');
    expect(body.lastName).toBe('Person');
    expect(body.name).toBe('Rewritten Person');
    // The mutation returns the same blob /auth/me serves, so a client can
    // overwrite its stored copy — verify the two agree.
    const meRes = await me(producerToken).expect(200);
    expect((meRes.body as AuthUserBody).name).toBe('Rewritten Person');
  });

  it('clears a half with null and leaves an omitted half alone', async () => {
    await patchProfile(producerToken, {
      firstName: 'Solo',
      lastName: 'Surname',
    }).expect(200);

    const res = await patchProfile(producerToken, {
      lastName: null,
    }).expect(200);
    const body = res.body as AuthUserBody;
    expect(body.firstName).toBe('Solo');
    expect(body.lastName).toBeNull();
    expect(body.name).toBe('Solo');
  });

  it('rejects an over-long name', async () => {
    await patchProfile(producerToken, {
      firstName: 'x'.repeat(61),
    }).expect(400);
  });

  it('refuses to commit a key this user did not mint', async () => {
    // `assertKeyOwnership` runs before any storage call, so this holds even
    // with STORAGE_ENDPOINT unset. Keys are namespaced per *user*, so another
    // user's perfectly-valid avatar key is exactly as foreign as another
    // agency's — pin both.
    await patchAvatar(producerToken, {
      key: `agencies/${ctx.agencyId}/branding/2026/some-logo.png`,
    }).expect(400);
    await patchAvatar(producerToken, {
      key: `agencies/${ctx.agencyId}/avatars/${ctx.csrUserId}/2026/sneaky.png`,
    }).expect(400);
  });

  it('accepts the caller-prefixed shape only up to the storage check', async () => {
    // A well-formed own key whose object was never uploaded: ownership passes,
    // then the storage stat (or unconfigured storage) refuses. Either way the
    // commit must fail — a dangling avatarKey would 404 on every render.
    const res = await patchAvatar(producerToken, {
      key: `agencies/${ctx.agencyId}/avatars/${producerId}/2026/never-uploaded.png`,
    });
    expect([400, 503]).toContain(res.status);

    const meRes = await me(producerToken).expect(200);
    expect((meRes.body as AuthUserBody).avatarUrl).toBeNull();
  });

  it('clearing a photo when none is set is a harmless no-op', async () => {
    const res = await patchAvatar(producerToken, { key: null }).expect(200);
    expect((res.body as AuthUserBody).avatarUrl).toBeNull();
  });

  it('404s the avatar stream when no photo is set', async () => {
    await http()
      .get('/api/v1/me/avatar')
      .set('Authorization', `Bearer ${producerToken}`)
      .expect(404);
  });

  it('requires authentication on every /me route', async () => {
    await http().patch('/api/v1/me/profile').send({}).expect(401);
    await http().patch('/api/v1/me/avatar').send({ key: null }).expect(401);
    await http().get('/api/v1/me/avatar').expect(401);
    await http()
      .post('/api/v1/me/avatar/uploads')
      .send({ filename: 'x.png', contentType: 'image/png' })
      .expect(401);
  });
});
