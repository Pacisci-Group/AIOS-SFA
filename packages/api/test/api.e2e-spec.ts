import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { ModuleKey } from '@sfa/shared';
import { AccessResolverService } from '../src/permissions/access-resolver.service';
import { User } from '../src/users/schemas/user.schema';
import { authHeader, login } from './helpers/auth.helper';
import {
  seedTestData,
  TEST_PASSWORD,
  TestSeedContext,
} from './helpers/seed-test-data';
import {
  closeTestApp,
  createTestApp,
  dropTestDatabase,
} from './helpers/test-app';

describe('SFA API (e2e)', () => {
  let app: INestApplication<App>;
  let seed: TestSeedContext;
  let superAdminToken: string;
  let ownerToken: string;
  let producerToken: string;
  let readOnlyToken: string;
  let refreshToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    await dropTestDatabase(app);
    seed = await seedTestData(app);

    const superAdmin = await login(app, seed.superAdminEmail, TEST_PASSWORD);
    superAdminToken = superAdmin.accessToken;

    const owner = await login(app, seed.ownerEmail, TEST_PASSWORD);
    ownerToken = owner.accessToken;
    refreshToken = owner.refreshToken;

    const producer = await login(app, seed.producerEmail, TEST_PASSWORD);
    producerToken = producer.accessToken;

    const readOnly = await login(app, seed.readOnlyEmail, TEST_PASSWORD);
    readOnlyToken = readOnly.accessToken;
  });

  afterAll(async () => {
    await dropTestDatabase(app);
    await closeTestApp(app);
  });

  describe('Health', () => {
    it('GET /api/v1/health', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/health')
        .expect(200);

      expect(res.body.status).toBe('ok');
      expect(res.body.service).toBe('sfa-api');
    });
  });

  describe('Auth', () => {
    it('POST /api/v1/auth/login — success', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: seed.ownerEmail, password: TEST_PASSWORD })
        .expect(201);

      expect(res.body.accessToken).toBeDefined();
      expect(res.body.refreshToken).toBeDefined();
      expect(res.body.user.email).toBe(seed.ownerEmail);
      expect(res.body.user.permissions.length).toBeGreaterThan(0);
    });

    it('POST /api/v1/auth/login — invalid credentials', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: seed.ownerEmail, password: 'wrong-password' })
        .expect(401);
    });

    it('POST /api/v1/auth/login — validation error', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'not-an-email', password: 'short' })
        .expect(400);
    });

    it('POST /api/v1/auth/refresh — success', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken })
        .expect(201);

      expect(res.body.accessToken).toBeDefined();
    });

    it('POST /api/v1/auth/refresh — invalid token', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'invalid-token' })
        .expect(401);
    });

    it('POST /api/v1/auth/accept-invite — success', async () => {
      const inviteRes = await request(app.getHttpServer())
        .post('/api/v1/users/invite')
        .set(authHeader(ownerToken))
        .send({
          email: 'invited-user@sfa.local',
          roleIds: [seed.producerRoleId],
          branchId: seed.branchId,
          firstName: 'Invited',
          lastName: 'User',
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/accept-invite')
        .send({
          token: inviteRes.body.inviteToken,
          password: 'InvitePass123!',
        })
        .expect(201);

      expect(res.body.accessToken).toBeDefined();
      expect(res.body.user.email).toBe('invited-user@sfa.local');
    });
  });

  describe('Platform (Super Admin)', () => {
    it('GET /api/v1/platform/agencies', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/platform/agencies')
        .set(authHeader(superAdminToken))
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
    });

    it('GET /api/v1/platform/agencies/:agencyId', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/platform/agencies/${seed.agencyId}`)
        .set(authHeader(superAdminToken))
        .expect(200);

      expect(res.body.slug).toBe('test-agency');
    });

    it('POST /api/v1/platform/agencies', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/platform/agencies')
        .set(authHeader(superAdminToken))
        .send({ name: 'New Agency', slug: 'new-agency' })
        .expect(201);

      expect(res.body.slug).toBe('new-agency');
    });

    it('PATCH /api/v1/platform/agencies/:agencyId/modules', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/platform/agencies/${seed.agencyId}/modules`)
        .set(authHeader(superAdminToken))
        .send({ modules: { mailers: { enabled: false } } })
        .expect(200);

      expect(res.body.modules.mailers.enabled).toBe(false);

      // Re-enable for other tests
      await request(app.getHttpServer())
        .patch(`/api/v1/platform/agencies/${seed.agencyId}/modules`)
        .set(authHeader(superAdminToken))
        .send({ modules: { mailers: { enabled: true } } })
        .expect(200);
    });

    it('GET /api/v1/platform/agencies — forbidden for agency owner', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/platform/agencies')
        .set(authHeader(ownerToken))
        .expect(403);
    });
  });

  describe('Roles', () => {
    it('GET /api/v1/roles', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/roles')
        .set(authHeader(ownerToken))
        .expect(200);

      expect(res.body.length).toBeGreaterThanOrEqual(5);
      expect(
        res.body.some((r: { slug: string }) => r.slug === 'producer'),
      ).toBe(true);
    });

    it('GET /api/v1/roles/:roleId', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/roles/${seed.producerRoleId}`)
        .set(authHeader(ownerToken))
        .expect(200);

      expect(res.body.slug).toBe('producer');
      expect(res.body.permissions).toContain('leads:read');
    });

    it('GET /api/v1/roles — forbidden for producer', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/roles')
        .set(authHeader(producerToken))
        .expect(403);
    });

    it('PATCH /api/v1/roles/:roleId — owner sets page levels', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/roles/${seed.editableRoleId}`)
        .set(authHeader(ownerToken))
        .send({
          levels: [
            { moduleKey: ModuleKey.Leads, level: 'write' },
            { moduleKey: ModuleKey.Mailers, level: 'none' },
          ],
        })
        .expect(200);

      // Write always carries read; a `none` level removes the page entirely.
      expect(res.body.permissions).toContain('leads:read');
      expect(res.body.permissions).toContain('leads:write');
      expect(res.body.permissions).not.toContain('mailers:read');

      // Only page read/write or owner-only admin strings may be persisted.
      for (const permission of res.body.permissions as string[]) {
        const isAdmin =
          permission.startsWith('agency:') ||
          permission.startsWith('platform:');
        const action = permission.split(':')[1];
        expect(isAdmin || action === 'read' || action === 'write').toBe(true);
      }
    });

    it('PATCH /api/v1/roles/:roleId — preserves owner admin permissions', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/roles/${seed.ownerRoleId}`)
        .set(authHeader(ownerToken))
        .send({ levels: [{ moduleKey: ModuleKey.Leads, level: 'read' }] })
        .expect(200);

      // Page levels change, but agency-admin permissions are never dropped.
      expect(res.body.permissions).toContain('agency:roles:read');
      expect(res.body.permissions).toContain('agency:roles:write');
      expect(res.body.permissions).toContain('leads:read');
    });

    it('PATCH /api/v1/roles/:roleId — forbidden for producer', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/roles/${seed.readOnlyRoleId}`)
        .set(authHeader(producerToken))
        .send({ levels: [] })
        .expect(403);
    });
  });

  describe('Branches', () => {
    it('GET /api/v1/branches', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/branches')
        .set(authHeader(ownerToken))
        .expect(200);

      expect(res.body.length).toBeGreaterThanOrEqual(1);
    });

    it('GET /api/v1/branches/:branchId', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/branches/${seed.branchId}`)
        .set(authHeader(ownerToken))
        .expect(200);

      expect(res.body.slug).toBe('test-branch');
    });

    it('POST /api/v1/branches', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/branches')
        .set(authHeader(ownerToken))
        .send({ name: 'Downtown', slug: 'downtown' })
        .expect(201);

      expect(res.body.slug).toBe('downtown');
    });

    it('GET /api/v1/branches — forbidden for producer', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/branches')
        .set(authHeader(producerToken))
        .expect(403);
    });
  });

  describe('Users', () => {
    let invitedUserId: string;

    it('GET /api/v1/users', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/users')
        .set(authHeader(ownerToken))
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(2);
    });

    it('GET /api/v1/users/assignable-permissions', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/users/assignable-permissions')
        .set(authHeader(ownerToken))
        .expect(200);

      expect(res.body).toContain('leads:read');
      expect(res.body).toContain('agency:users:write');
    });

    it('GET /api/v1/users/:userId', async () => {
      const list = await request(app.getHttpServer())
        .get('/api/v1/users')
        .set(authHeader(ownerToken))
        .expect(200);

      invitedUserId = list.body.find(
        (u: { email: string }) => u.email === seed.producerEmail,
      )._id;

      const res = await request(app.getHttpServer())
        .get(`/api/v1/users/${invitedUserId}`)
        .set(authHeader(ownerToken))
        .expect(200);

      expect(res.body.effectivePermissions).toContain('leads:read');
    });

    it('PATCH /api/v1/users/:userId/roles', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/users/${invitedUserId}/roles`)
        .set(authHeader(ownerToken))
        .send({ roleIds: [seed.producerRoleId] })
        .expect(200);

      expect(res.body.roleIds.length).toBe(1);
    });

    it('PATCH /api/v1/users/:userId/permissions — per-page overrides', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/users/${invitedUserId}/permissions`)
        .set(authHeader(ownerToken))
        .send({
          overrides: [
            // Grant read on a page the producer role lacks.
            { moduleKey: ModuleKey.Mailers, level: 'read' },
            // Downgrade a page the producer role has write on to read only.
            { moduleKey: ModuleKey.Leads, level: 'read' },
          ],
        })
        .expect(200);

      expect(res.body.effectivePermissions).toContain('mailers:read');
      expect(res.body.effectivePermissions).not.toContain('leads:write');
      expect(res.body.effectivePermissions).toContain('leads:read');
    });

    it('PATCH /api/v1/users/:userId/permissions — reset restores role defaults', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/users/${invitedUserId}/permissions`)
        .set(authHeader(ownerToken))
        .send({
          overrides: [
            { moduleKey: ModuleKey.Mailers, level: 'none' },
            { moduleKey: ModuleKey.Leads, level: 'write' },
          ],
        })
        .expect(200);

      expect(res.body.effectivePermissions).not.toContain('mailers:read');
      expect(res.body.effectivePermissions).toContain('leads:write');
      expect(res.body.effectivePermissions).toContain('leads:read');
    });

    it('GET /api/v1/users — forbidden for producer', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/users')
        .set(authHeader(producerToken))
        .expect(403);
    });
  });

  describe('Feature modules', () => {
    const featureRoutes = [
      { path: 'dashboard', module: ModuleKey.Dashboard },
      { path: 'contacts', module: ModuleKey.Clients },
      { path: 'households', module: ModuleKey.Clients },
      { path: 'leads', module: ModuleKey.Leads },
      { path: 'quote-recaps', module: ModuleKey.QuoteRecaps },
      { path: 'deals', module: ModuleKey.Clients },
      // NOTE: `deal-audits` is a real module (see DealAuditsModule / PAC-12/14),
      // not a `{status:'ready'}` stub — covered by its own describe block below.
      { path: 'crm/service-tickets', module: ModuleKey.CrmService },
      { path: 'performance', module: ModuleKey.Performance },
      { path: 'leaderboard', module: ModuleKey.Leaderboard },
      { path: 'mailers', module: ModuleKey.Mailers },
      { path: 'onboardings', module: ModuleKey.Onboardings },
      { path: 'management', module: ModuleKey.Management },
      { path: 'owner-dashboard', module: ModuleKey.OwnerDashboard },
      { path: 'command-center', module: ModuleKey.CommandCenter },
      { path: 'files', module: ModuleKey.QuoteRecaps },
    ];

    it.each(featureRoutes)(
      'GET /api/v1/$path — agency owner',
      async ({ path, module }) => {
        const res = await request(app.getHttpServer())
          .get(`/api/v1/${path}`)
          .set(authHeader(ownerToken))
          .expect(200);

        if (path !== 'files') {
          expect(res.body.module).toBe(module);
          expect(res.body.status).toBe('ready');
        } else {
          expect(res.body.status).toBe('ready');
        }
      },
    );

    it('GET /api/v1/leads — producer with branch scope', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/leads')
        .set(authHeader(producerToken))
        .expect(200);

      expect(res.body.module).toBe(ModuleKey.Leads);
    });

    it('GET /api/v1/command-center — forbidden for producer', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/command-center')
        .set(authHeader(producerToken))
        .expect(403);
    });

    it('PATCH /api/v1/leads — producer has write access', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/v1/leads')
        .set(authHeader(producerToken))
        .expect(200);

      expect(res.body.status).toBe('updated');
    });

    it('PATCH /api/v1/performance — forbidden without write (read-only page)', async () => {
      // Producer role grants performance:read but not performance:write.
      await request(app.getHttpServer())
        .patch('/api/v1/performance')
        .set(authHeader(producerToken))
        .expect(403);
    });

    it('GET /api/v1/mailers — module disabled', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/platform/agencies/${seed.agencyId}/modules`)
        .set(authHeader(superAdminToken))
        .send({ modules: { mailers: { enabled: false } } })
        .expect(200);

      await request(app.getHttpServer())
        .get('/api/v1/mailers')
        .set(authHeader(ownerToken))
        .expect(403);

      await request(app.getHttpServer())
        .patch(`/api/v1/platform/agencies/${seed.agencyId}/modules`)
        .set(authHeader(superAdminToken))
        .send({ modules: { mailers: { enabled: true } } })
        .expect(200);
    });
  });

  describe('Page-level permission guardrails', () => {
    // Every feature controller: GET requires `{module}:read`, and every mutating
    // handler (PATCH) requires `{module}:write`. `files` is read-only (no PATCH).
    const mutatingFeatureRoutes = [
      { path: 'dashboard', module: ModuleKey.Dashboard },
      { path: 'contacts', module: ModuleKey.Clients },
      { path: 'households', module: ModuleKey.Clients },
      { path: 'leads', module: ModuleKey.Leads },
      { path: 'quote-recaps', module: ModuleKey.QuoteRecaps },
      { path: 'deals', module: ModuleKey.Clients },
      // `deal-audits` write (resolve) is item-scoped, not a bare PATCH stub —
      // covered by its own describe block below.
      { path: 'crm/service-tickets', module: ModuleKey.CrmService },
      { path: 'performance', module: ModuleKey.Performance },
      { path: 'leaderboard', module: ModuleKey.Leaderboard },
      { path: 'mailers', module: ModuleKey.Mailers },
      { path: 'onboardings', module: ModuleKey.Onboardings },
      { path: 'management', module: ModuleKey.Management },
      { path: 'owner-dashboard', module: ModuleKey.OwnerDashboard },
      { path: 'command-center', module: ModuleKey.CommandCenter },
    ];

    it.each(mutatingFeatureRoutes)(
      'GET /api/v1/$path — read-only user can read every page',
      async ({ path, module }) => {
        const res = await request(app.getHttpServer())
          .get(`/api/v1/${path}`)
          .set(authHeader(readOnlyToken))
          .expect(200);

        expect(res.body.module).toBe(module);
      },
    );

    it.each(mutatingFeatureRoutes)(
      'PATCH /api/v1/$path — read-only user is forbidden from writing',
      async ({ path }) => {
        await request(app.getHttpServer())
          .patch(`/api/v1/${path}`)
          .set(authHeader(readOnlyToken))
          .expect(403);
      },
    );

    it.each(mutatingFeatureRoutes)(
      'PATCH /api/v1/$path — write user (owner) can write',
      async ({ path, module }) => {
        const res = await request(app.getHttpServer())
          .patch(`/api/v1/${path}`)
          .set(authHeader(ownerToken))
          .expect(200);

        expect(res.body.module).toBe(module);
        expect(res.body.status).toBe('updated');
      },
    );

    it('GET /api/v1/files — read-only user can read (read-only page)', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/files')
        .set(authHeader(readOnlyToken))
        .expect(200);
    });
  });

  describe('Deal Audits (PAC-12 read / PAC-14 resolve)', () => {
    // A syntactically-valid ObjectId that does not exist — lets us exercise the
    // guard chain + ownership without seeding audit items or object storage.
    const missingItemId = '000000000000000000000000';

    it('GET /api/v1/deal-audits — producer gets a paginated envelope', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/deal-audits')
        .set(authHeader(producerToken))
        .expect(200);

      const body = res.body as { page: number; items: unknown[] };
      expect(body).toHaveProperty('page');
      expect(body).toHaveProperty('pageSize');
      expect(body).toHaveProperty('total');
      expect(body).toHaveProperty('totalPages');
      expect(Array.isArray(body.items)).toBe(true);
    });

    it('PATCH resolve — read-only user forbidden (no deal_audits:write)', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/deal-audits/${missingItemId}/resolve`)
        .set(authHeader(readOnlyToken))
        .send({ note: 'nope' })
        .expect(403);
    });

    it('POST presign — read-only user forbidden (no deal_audits:write)', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/deal-audits/${missingItemId}/attachments/presign`)
        .set(authHeader(readOnlyToken))
        .send({
          filename: 'x.pdf',
          contentType: 'application/pdf',
          size: 1024,
        })
        .expect(403);
    });

    it('PATCH resolve — producer has write; 404 for a non-existent item', async () => {
      // Write permission passes the guard chain; the service then 404s because
      // no such item exists in the caller's agency.
      await request(app.getHttpServer())
        .patch(`/api/v1/deal-audits/${missingItemId}/resolve`)
        .set(authHeader(producerToken))
        .send({ note: 'verified' })
        .expect(404);
    });

    it('POST presign — invalid content type is rejected (400)', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/deal-audits/${missingItemId}/attachments/presign`)
        .set(authHeader(producerToken))
        .send({
          filename: 'x.exe',
          contentType: 'application/x-msdownload',
          size: 1024,
        })
        .expect(400);
    });
  });

  describe('Guards', () => {
    it('returns 401 without token on protected route', async () => {
      await request(app.getHttpServer()).get('/api/v1/leads').expect(401);
    });

    it('returns 401 with invalid token', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/leads')
        .set(authHeader('invalid.jwt.token'))
        .expect(401);
    });
  });

  // The store (MongoDB) is the source of truth for authorization, not the JWT.
  // These tests use a dedicated user and keep reusing the SAME access token to
  // prove that owner edits / de-provisioning take effect on the next request
  // without re-login. (No REDIS_URL in tests => DB-only resolution.)
  describe('Live authorization (backend store is source of truth)', () => {
    let liveToken: string;
    let liveUserId: string;

    beforeAll(async () => {
      const invite = await request(app.getHttpServer())
        .post('/api/v1/users/invite')
        .set(authHeader(ownerToken))
        .send({
          email: 'live-auth-user@sfa.local',
          roleIds: [seed.producerRoleId],
          branchId: seed.branchId,
          firstName: 'Live',
          lastName: 'Auth',
        })
        .expect(201);

      const accepted = await request(app.getHttpServer())
        .post('/api/v1/auth/accept-invite')
        .send({ token: invite.body.inviteToken, password: 'LivePass123!' })
        .expect(201);

      liveToken = accepted.body.accessToken;
      liveUserId = accepted.body.user.id;
    });

    it('signed access token does not embed the permissions array', () => {
      const [, payload] = liveToken.split('.');
      const claims = JSON.parse(
        Buffer.from(payload, 'base64').toString('utf8'),
      );
      expect(claims.sub).toBeDefined();
      expect(claims.permissions).toBeUndefined();
      expect(claims.dataScope).toBeUndefined();
    });

    it('baseline: producer token can write leads', async () => {
      await request(app.getHttpServer())
        .patch('/api/v1/leads')
        .set(authHeader(liveToken))
        .expect(200);
    });

    it('owner downgrading the user takes effect on the next request (same token)', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/users/${liveUserId}/permissions`)
        .set(authHeader(ownerToken))
        .send({ overrides: [{ moduleKey: ModuleKey.Leads, level: 'read' }] })
        .expect(200);

      // Same token as before — write is now revoked, read still works.
      await request(app.getHttpServer())
        .patch('/api/v1/leads')
        .set(authHeader(liveToken))
        .expect(403);

      await request(app.getHttpServer())
        .get('/api/v1/leads')
        .set(authHeader(liveToken))
        .expect(200);
    });

    it('deactivating the user blocks the next request even with a valid token', async () => {
      // A real deactivation flow updates the store and invalidates any cached
      // context. Modeling both keeps this correct whether or not Redis is on.
      const userModel = app.get<Model<User>>(getModelToken(User.name));
      await userModel.updateOne(
        { _id: liveUserId },
        { $set: { isActive: false } },
      );
      await app.get(AccessResolverService).invalidateUser(liveUserId);

      await request(app.getHttpServer())
        .get('/api/v1/leads')
        .set(authHeader(liveToken))
        .expect(401);
    });
  });
});
