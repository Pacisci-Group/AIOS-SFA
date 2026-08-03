import { INestApplication } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { ModuleKey, SERVICE_TICKET_ARCHIVE_AFTER_DAYS } from '@sfa/shared';
import { ServiceTicketsService } from '../src/crm/service-tickets.service';
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
  let csrToken: string;
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

    const csr = await login(app, seed.csrEmail, TEST_PASSWORD);
    csrToken = csr.accessToken;

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

  describe('Client records (multi-permission OR gate)', () => {
    // `GET /households/:id` and `GET /policies/:id` accept `clients:read` OR
    // `crm_service:read`, because these records render both on the Clients
    // pages and inside the CRM service-ticket detail. Gating is page-level:
    // there is no per-record or ticket-linkage check.

    it('GET /households/:id — agency owner (has clients:read)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/households/${seed.householdId}`)
        .set(authHeader(ownerToken))
        .expect(200);

      expect(res.body.id).toBe(seed.householdId);
      expect(res.body.name).toBe('Test Household');
      expect(res.body.contacts).toHaveLength(1);
      expect(res.body.contacts[0].roleInHousehold).toBe('Named Insured');
      expect(res.body.policies).toHaveLength(1);
      expect(res.body.policies[0].policyNumber).toBe('TEST-000-1');
    });

    it('GET /households/:id — CSR reaches it with only crm_service:read', async () => {
      // Guards the premise of this suite: the CSR must NOT hold clients:read.
      // The login response carries the resolved permission set.
      const csrLogin = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: seed.csrEmail, password: TEST_PASSWORD })
        .expect(201);
      expect(csrLogin.body.user.permissions).toContain('crm_service:read');
      expect(csrLogin.body.user.permissions).not.toContain('clients:read');

      const res = await request(app.getHttpServer())
        .get(`/api/v1/households/${seed.householdId}`)
        .set(authHeader(csrToken))
        .expect(200);
      expect(res.body.id).toBe(seed.householdId);
    });

    it('GET /policies/:id — CSR, with the household summary attached', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/policies/${seed.policyId}`)
        .set(authHeader(csrToken))
        .expect(200);

      expect(res.body.id).toBe(seed.policyId);
      expect(res.body.policyNumber).toBe('TEST-000-1');
      expect(res.body.household.id).toBe(seed.householdId);
    });

    it('GET /households/:id — forbidden for a user with neither permission', async () => {
      // The producer role has neither clients nor crm_service.
      await request(app.getHttpServer())
        .get(`/api/v1/households/${seed.householdId}`)
        .set(authHeader(producerToken))
        .expect(403);
    });

    it('GET /households/:id — unauthenticated', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/households/${seed.householdId}`)
        .expect(401);
    });

    it('GET /households/:id — malformed id is 404, not 500', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/households/not-an-object-id')
        .set(authHeader(ownerToken))
        .expect(404);
    });

    it('GET /households/:id — another agency’s record is 404', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/households/${seed.otherAgencyHouseholdId}`)
        .set(authHeader(ownerToken))
        .expect(404);
    });

    it('GET /households/:id — out-of-branch record is 404 for the CSR', async () => {
      // CSR has `own` scope, which collapses to branch for client records.
      await request(app.getHttpServer())
        .get(`/api/v1/households/${seed.otherBranchHouseholdId}`)
        .set(authHeader(csrToken))
        .expect(404);
    });

    it('GET /households/:id — the same record IS visible to the agency-scoped owner', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/households/${seed.otherBranchHouseholdId}`)
        .set(authHeader(ownerToken))
        .expect(200);
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
      { path: 'deal-audits', module: ModuleKey.DealAudits },
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

  describe('CSR role access matrix', () => {
    // CSR = dashboard:read, leads:write, mailers:write, performance:read,
    // crm_service:write. Scoped to exactly these 5 pages.
    const csrAllowedReads = [
      { path: 'dashboard', module: ModuleKey.Dashboard },
      { path: 'leads', module: ModuleKey.Leads },
      { path: 'mailers', module: ModuleKey.Mailers },
      { path: 'performance', module: ModuleKey.Performance },
    ];

    it.each(csrAllowedReads)(
      'GET /api/v1/$path — CSR can read',
      async ({ path, module }) => {
        const res = await request(app.getHttpServer())
          .get(`/api/v1/${path}`)
          .set(authHeader(csrToken))
          .expect(200);

        expect(res.body.module).toBe(module);
      },
    );

    it('GET /api/v1/crm/service-tickets — CSR can read (real module)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/crm/service-tickets')
        .set(authHeader(csrToken))
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });

    const csrWritablePages = ['leads', 'mailers'];
    it.each(csrWritablePages)(
      'PATCH /api/v1/%s — CSR can write',
      async (path) => {
        await request(app.getHttpServer())
          .patch(`/api/v1/${path}`)
          .set(authHeader(csrToken))
          .expect(200);
      },
    );

    it('POST /api/v1/crm/service-tickets — CSR can write (real module)', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/crm/service-tickets')
        .set(authHeader(csrToken))
        .send({ clientName: 'CSR Write Check', category: 'Policy Change' })
        .expect(201);
    });

    it('PATCH /api/v1/performance — CSR is read-only (no write)', async () => {
      await request(app.getHttpServer())
        .patch('/api/v1/performance')
        .set(authHeader(csrToken))
        .expect(403);
    });

    const csrDeniedFeatureRoutes = [
      'quote-recaps',
      'deal-audits',
      'leaderboard',
      'management',
      'owner-dashboard',
      'command-center',
    ];
    it.each(csrDeniedFeatureRoutes)(
      'GET /api/v1/%s — forbidden for CSR',
      async (path) => {
        await request(app.getHttpServer())
          .get(`/api/v1/${path}`)
          .set(authHeader(csrToken))
          .expect(403);
      },
    );

    const csrDeniedAdminRoutes = ['roles', 'users', 'branches'];
    it.each(csrDeniedAdminRoutes)(
      'GET /api/v1/%s — owner-only admin forbidden for CSR',
      async (path) => {
        await request(app.getHttpServer())
          .get(`/api/v1/${path}`)
          .set(authHeader(csrToken))
          .expect(403);
      },
    );

    it('CSR access token carries own data scope (no permissions in JWT)', () => {
      const [, payload] = csrToken.split('.');
      const claims = JSON.parse(
        Buffer.from(payload, 'base64').toString('utf8'),
      );
      expect(claims.scope).toBe('branch');
      expect(claims.permissions).toBeUndefined();
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
      { path: 'deal-audits', module: ModuleKey.DealAudits },
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

  describe('CRM Service tickets', () => {
    let ownerTicketId: string;
    let csrTicketId: string;

    it('POST /api/v1/crm/service-tickets — owner creates a ticket', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/crm/service-tickets')
        .set(authHeader(ownerToken))
        .send({
          clientName: 'Acme Owner Client',
          category: 'Renewal Review',
          priority: 'high',
          policyNumber: 'POL-1001',
          policyType: 'Auto',
        })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.ticketNumber).toMatch(/^RENEW-/);
      expect(res.body.status).toBe('open');
      expect(res.body.timeline.length).toBeGreaterThanOrEqual(1);
      expect(res.body.timeline[0].type).toBe('created');
      ownerTicketId = res.body.id;
    });

    it('GET /api/v1/crm/service-tickets — owner lists tickets', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/crm/service-tickets')
        .set(authHeader(ownerToken))
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.some((t: { id: string }) => t.id === ownerTicketId)).toBe(
        true,
      );
    });

    it('GET /api/v1/crm/service-tickets/stats — returns ticket-derived stats', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/crm/service-tickets/stats')
        .set(authHeader(ownerToken))
        .expect(200);

      expect(typeof res.body.openTickets).toBe('number');
      expect(res.body.openTickets).toBeGreaterThanOrEqual(1);
    });

    it('GET /api/v1/crm/service-tickets/:id — owner reads one', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/crm/service-tickets/${ownerTicketId}`)
        .set(authHeader(ownerToken))
        .expect(200);

      expect(res.body.id).toBe(ownerTicketId);
      expect(res.body.clientName).toBe('Acme Owner Client');
    });

    it('PATCH /api/v1/crm/service-tickets/:id/status — records a status change', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/crm/service-tickets/${ownerTicketId}/status`)
        .set(authHeader(ownerToken))
        .send({ status: 'waiting' })
        .expect(200);

      expect(res.body.status).toBe('waiting');
      expect(
        res.body.timeline.some((e: { type: string }) => e.type === 'status'),
      ).toBe(true);
    });

    it('POST /api/v1/crm/service-tickets/:id/notes — appends a note', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/crm/service-tickets/${ownerTicketId}/notes`)
        .set(authHeader(ownerToken))
        .send({ content: 'Called client, left voicemail.' })
        .expect(201);

      const notes = res.body.timeline.filter(
        (e: { type: string }) => e.type === 'note',
      );
      expect(notes.length).toBeGreaterThanOrEqual(1);
      expect(notes[notes.length - 1].content).toContain('voicemail');
    });

    it('validates the create payload', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/crm/service-tickets')
        .set(authHeader(ownerToken))
        .send({ clientName: '', category: 'Not A Category' })
        .expect(400);
    });

    it('own-scope: CSR only sees their own tickets', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/crm/service-tickets')
        .set(authHeader(csrToken))
        .send({ clientName: 'CSR Own Client', category: 'Billing' })
        .expect(201);
      csrTicketId = created.body.id;

      const res = await request(app.getHttpServer())
        .get('/api/v1/crm/service-tickets')
        .set(authHeader(csrToken))
        .expect(200);

      const ids = res.body.map((t: { id: string }) => t.id);
      expect(ids).toContain(csrTicketId);
      // The owner's ticket is assigned to the owner — out of the CSR's own scope.
      expect(ids).not.toContain(ownerTicketId);
    });

    it('own-scope: CSR cannot read a ticket outside their scope', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/crm/service-tickets/${ownerTicketId}`)
        .set(authHeader(csrToken))
        .expect(404);
    });

    it('agency-scope: owner sees tickets created by others', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/crm/service-tickets')
        .set(authHeader(ownerToken))
        .expect(200);

      const ids = res.body.map((t: { id: string }) => t.id);
      expect(ids).toContain(csrTicketId);
      expect(ids).toContain(ownerTicketId);
    });

    it('read-only user cannot mutate tickets', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/crm/service-tickets')
        .set(authHeader(readOnlyToken))
        .send({ clientName: 'Nope', category: 'Policy Change' })
        .expect(403);

      await request(app.getHttpServer())
        .patch(`/api/v1/crm/service-tickets/${ownerTicketId}/status`)
        .set(authHeader(readOnlyToken))
        .send({ status: 'resolved' })
        .expect(403);

      await request(app.getHttpServer())
        .post(`/api/v1/crm/service-tickets/${ownerTicketId}/notes`)
        .set(authHeader(readOnlyToken))
        .send({ content: 'should fail' })
        .expect(403);
    });

    it('producer (no crm_service) is denied entirely', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/crm/service-tickets')
        .set(authHeader(producerToken))
        .expect(403);
    });

    it('CSR can populate the create form pickers', async () => {
      const assignees = await request(app.getHttpServer())
        .get('/api/v1/crm/service-tickets/assignees')
        .set(authHeader(csrToken))
        .expect(200);
      expect(Array.isArray(assignees.body)).toBe(true);
      expect(
        assignees.body.some(
          (a: { email: string }) => a.email === seed.csrEmail,
        ),
      ).toBe(true);

      const households = await request(app.getHttpServer())
        .get('/api/v1/households/search?q=Test')
        .set(authHeader(csrToken))
        .expect(200);
      expect(households.body.map((h: { id: string }) => h.id)).toContain(
        seed.householdId,
      );

      const policies = await request(app.getHttpServer())
        .get('/api/v1/policies/search?q=TEST-000')
        .set(authHeader(csrToken))
        .expect(200);
      expect(policies.body.map((p: { id: string }) => p.id)).toContain(
        seed.policyId,
      );
    });

    it('creates a ticket from the linked records, stamping created-by', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/crm/service-tickets')
        .set(authHeader(csrToken))
        .send({
          category: 'Onboarding',
          status: 'in_progress',
          householdId: seed.householdId,
          policyId: seed.policyId,
          openingNote: 'Welcome call scheduled.',
        })
        .expect(201);

      // Client / policy display fields come off the linked records.
      //
      // NOTE: the requested `status: 'in_progress'` is deliberately ignored on
      // an Onboarding ticket. Onboarding status is *derived* from its step
      // timing, and a freshly created onboarding has its first step available
      // immediately, so it reads as `open`. Every other category still honours
      // the status sent on create.
      expect(res.body.status).toBe('open');
      expect(res.body.category).toBe('Onboarding');
      expect(res.body.householdId).toBe(seed.householdId);
      expect(res.body.policyId).toBe(seed.policyId);
      expect(res.body.policyNumber).toBe('TEST-000-1');
      expect(res.body.clientName).toBeTruthy();
      expect(res.body.createdByUserId).toBeTruthy();
      expect(res.body.createdByName).toBeTruthy();
      expect(res.body.isArchived).toBe(false);
      expect(res.body.timeline[0].content).toContain('Welcome call');
    });

    it('rejects a ticket whose linked household is out of scope', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/crm/service-tickets')
        .set(authHeader(csrToken))
        .send({
          category: 'Other',
          householdId: seed.otherAgencyHouseholdId,
        })
        .expect(404);
    });

    it('resolved tickets move to the archive after the archive window', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/crm/service-tickets')
        .set(authHeader(ownerToken))
        .send({ clientName: 'Archive Window Client', category: 'Billing' })
        .expect(201);
      const ticketId = created.body.id as string;

      const resolved = await request(app.getHttpServer())
        .patch(`/api/v1/crm/service-tickets/${ticketId}/status`)
        .set(authHeader(ownerToken))
        .send({ status: 'resolved' })
        .expect(200);
      expect(resolved.body.resolvedAt).toBeTruthy();
      expect(resolved.body.isArchived).toBe(false);

      // Freshly resolved: still in the active queue, not yet archived.
      const active = await request(app.getHttpServer())
        .get('/api/v1/crm/service-tickets')
        .set(authHeader(ownerToken))
        .expect(200);
      expect(active.body.map((t: { id: string }) => t.id)).toContain(ticketId);

      const archivedBefore = await request(app.getHttpServer())
        .get('/api/v1/crm/service-tickets?archived=true')
        .set(authHeader(ownerToken))
        .expect(200);
      expect(
        archivedBefore.body.map((t: { id: string }) => t.id),
      ).not.toContain(ticketId);

      // Backdate the resolve past the window.
      const connection = app.get<Connection>(getConnectionToken());
      await connection.collection('service_tickets').updateOne(
        { _id: new Types.ObjectId(ticketId) },
        {
          $set: {
            resolvedAt: new Date(
              Date.now() -
                (SERVICE_TICKET_ARCHIVE_AFTER_DAYS + 1) * 24 * 60 * 60 * 1000,
            ),
          },
        },
      );

      const activeAfter = await request(app.getHttpServer())
        .get('/api/v1/crm/service-tickets')
        .set(authHeader(ownerToken))
        .expect(200);
      expect(activeAfter.body.map((t: { id: string }) => t.id)).not.toContain(
        ticketId,
      );

      const archivedAfter = await request(app.getHttpServer())
        .get('/api/v1/crm/service-tickets?archived=true')
        .set(authHeader(ownerToken))
        .expect(200);
      const archivedTicket = archivedAfter.body.find(
        (t: { id: string }) => t.id === ticketId,
      );
      expect(archivedTicket).toBeDefined();
      expect(archivedTicket.isArchived).toBe(true);

      // Reopening clears the archive clock and returns it to the queue.
      const reopened = await request(app.getHttpServer())
        .patch(`/api/v1/crm/service-tickets/${ticketId}/status`)
        .set(authHeader(ownerToken))
        .send({ status: 'open' })
        .expect(200);
      expect(reopened.body.resolvedAt).toBeNull();
      expect(reopened.body.isArchived).toBe(false);

      const queueAgain = await request(app.getHttpServer())
        .get('/api/v1/crm/service-tickets')
        .set(authHeader(ownerToken))
        .expect(200);
      expect(queueAgain.body.map((t: { id: string }) => t.id)).toContain(
        ticketId,
      );
    });
  });

  /**
   * Onboarding is a chain of service tickets — one per call — tied together by
   * a per-client `Onboarding` record. Everything below is reached with the
   * `crm_service` permissions that `csr` and `crm` already hold, with no
   * role-template change.
   */
  describe('Onboarding (chained tickets, tracked per client)', () => {
    let welcomeTicketId: string;
    let threeDayTicketId: string;
    let onboardingId: string;
    let billingId: string;

    interface StepPayload {
      onboardingId: string;
      stepKey: string;
      sequence: number;
      totalSteps: number;
      availableAt: string | null;
      dueAt: string | null;
      completedAt: string | null;
      completedByName: string;
      isActionable: boolean;
      isOverdue: boolean;
    }
    interface TicketBody {
      id: string;
      status: string;
      ticketNumber: string;
      onboarding: StepPayload | null;
      timeline: { type: string; content: string }[];
    }
    interface ChainLink {
      stepKey: string;
      sequence: number;
      ticketId: string | null;
      availableAt: string | null;
      completedAt: string | null;
    }
    interface OnboardingBody {
      id: string;
      householdId: string;
      currentStepKey: string | null;
      completedAt: string | null;
      isComplete: boolean;
      checklist: Record<string, boolean>;
      emailMilestones: Record<string, string | null>;
      chain: ChainLink[];
    }

    const ids = (body: { id: string }[]) => body.map((t) => t.id);

    it('starts a chain with only the welcome call', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/crm/service-tickets')
        .set(authHeader(csrToken))
        .send({ category: 'Onboarding', householdId: seed.householdId })
        .expect(201);

      const body = res.body as TicketBody;
      welcomeTicketId = body.id;
      onboardingId = body.onboarding!.onboardingId;

      expect(body.ticketNumber).toMatch(/^ONBD-/);
      expect(body.onboarding!.stepKey).toBe('welcome_call');
      expect(body.onboarding!.sequence).toBe(1);
      expect(body.onboarding!.totalSteps).toBe(3);
      expect(body.onboarding!.isActionable).toBe(true);
      expect(body.status).toBe('open');

      // Exactly one ticket exists — the rest are created as calls complete.
      const chain = await request(app.getHttpServer())
        .get(`/api/v1/crm/service-tickets/onboardings/${onboardingId}`)
        .set(authHeader(csrToken))
        .expect(200);
      const onboarding = chain.body as OnboardingBody;
      expect(onboarding.chain).toHaveLength(3);
      expect(onboarding.chain.filter((s) => s.ticketId)).toHaveLength(1);
      expect(onboarding.currentStepKey).toBe('welcome_call');
      expect(onboarding.isComplete).toBe(false);
    });

    it('requires a household — onboarding is tracked per client', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/crm/service-tickets')
        .set(authHeader(csrToken))
        .send({ category: 'Onboarding', clientName: 'No Household' })
        .expect(400);
    });

    it('non-onboarding tickets carry no onboarding payload', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/crm/service-tickets')
        .set(authHeader(csrToken))
        .send({ clientName: 'Billing Client', category: 'Billing' })
        .expect(201);

      billingId = (res.body as TicketBody).id;
      expect(res.body.onboarding).toBeNull();
    });

    /**
     * The core of the redesign: completing one call creates the ticket for the
     * next, three days out, measured from the completion instant.
     */
    it('completing the welcome call creates the 3-day ticket', async () => {
      const res = await request(app.getHttpServer())
        .post(
          `/api/v1/crm/service-tickets/${welcomeTicketId}/onboarding/steps/welcome_call/complete`,
        )
        .set(authHeader(csrToken))
        .expect(201);

      const body = res.body as TicketBody;
      expect(body.onboarding!.completedAt).toBeTruthy();
      expect(body.onboarding!.completedByName).toBeTruthy();
      expect(body.status).toBe('resolved');
      expect(
        body.timeline.some(
          (e) => e.type === 'system' && e.content.includes('Welcome Call'),
        ),
      ).toBe(true);

      const chain = await request(app.getHttpServer())
        .get(`/api/v1/crm/service-tickets/onboardings/${onboardingId}`)
        .set(authHeader(csrToken))
        .expect(200);
      const onboarding = chain.body as OnboardingBody;

      const threeDay = onboarding.chain.find(
        (s) => s.stepKey === 'checkin_3day',
      )!;
      expect(threeDay.ticketId).toBeTruthy();
      threeDayTicketId = threeDay.ticketId!;
      expect(onboarding.currentStepKey).toBe('checkin_3day');

      // Opens exactly 3 days after the welcome call closed, same clock time.
      const completedAt = new Date(body.onboarding!.completedAt!).getTime();
      expect(new Date(threeDay.availableAt!).getTime()).toBe(
        completedAt + 3 * 24 * 60 * 60 * 1000,
      );

      // The 30-day call is not created until the 3-day one closes.
      expect(
        onboarding.chain.find((s) => s.stepKey === 'checkin_30day')!.ticketId,
      ).toBeNull();
    });

    it('completing twice does not create a second next ticket', async () => {
      await request(app.getHttpServer())
        .post(
          `/api/v1/crm/service-tickets/${welcomeTicketId}/onboarding/steps/welcome_call/complete`,
        )
        .set(authHeader(csrToken))
        .expect(400);

      const connection = app.get<Connection>(getConnectionToken());
      const count = await connection
        .collection('service_tickets')
        .countDocuments({
          'onboarding.onboardingId': new Types.ObjectId(onboardingId),
          'onboarding.stepKey': 'checkin_3day',
        });
      expect(count).toBe(1);
    });

    /** The visibility rule the owner asked for: not on the plate until it opens. */
    it('hides a scheduled ticket from every list but serves it by id', async () => {
      const list = await request(app.getHttpServer())
        .get('/api/v1/crm/service-tickets')
        .set(authHeader(csrToken))
        .expect(200);
      expect(ids(list.body)).not.toContain(threeDayTicketId);

      const filtered = await request(app.getHttpServer())
        .get('/api/v1/crm/service-tickets?category=Onboarding')
        .set(authHeader(csrToken))
        .expect(200);
      expect(ids(filtered.body)).not.toContain(threeDayTicketId);

      // Reachable directly, so the chain view and deep links still work.
      const direct = await request(app.getHttpServer())
        .get(`/api/v1/crm/service-tickets/${threeDayTicketId}`)
        .set(authHeader(csrToken))
        .expect(200);
      expect((direct.body as TicketBody).onboarding!.stepKey).toBe(
        'checkin_3day',
      );
      expect(direct.body.status).toBe('waiting');
      expect(direct.body.onboarding.isActionable).toBe(false);
    });

    it('refuses to complete a call that has not opened', async () => {
      await request(app.getHttpServer())
        .post(
          `/api/v1/crm/service-tickets/${threeDayTicketId}/onboarding/steps/checkin_3day/complete`,
        )
        .set(authHeader(csrToken))
        .expect(400);
    });

    it('refuses a step key that is not this ticket', async () => {
      await request(app.getHttpServer())
        .post(
          `/api/v1/crm/service-tickets/${threeDayTicketId}/onboarding/steps/welcome_call/complete`,
        )
        .set(authHeader(csrToken))
        .expect(400);
    });

    /**
     * The status picker is the CSR's everyday control, so resolving an
     * onboarding ticket through it has to mean the same thing as pressing
     * "complete the call" — otherwise the write lands on the stored status and
     * is silently discarded by the derived read.
     */
    it('resolving via the status picker completes the call', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/crm/service-tickets')
        .set(authHeader(csrToken))
        // A hand-started onboarding is never deduplicated, so this opens a
        // second, independent chain for the same client.
        .send({ category: 'Onboarding', householdId: seed.householdId })
        .expect(201);
      const ticketId = (created.body as TicketBody).id;

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/crm/service-tickets/${ticketId}/status`)
        .set(authHeader(csrToken))
        .send({ status: 'resolved' })
        .expect(200);

      const body = res.body as TicketBody;
      expect(body.status).toBe('resolved');
      expect(body.onboarding!.completedAt).toBeTruthy();

      // And the chain advanced, exactly as the explicit complete does.
      const chain = await request(app.getHttpServer())
        .get(
          `/api/v1/crm/service-tickets/onboardings/${body.onboarding!.onboardingId}`,
        )
        .set(authHeader(csrToken))
        .expect(200);
      expect((chain.body as OnboardingBody).currentStepKey).toBe(
        'checkin_3day',
      );
    });

    /**
     * The picker offers the same four statuses on an onboarding ticket as
     * anywhere else, so a hand-picked one has to stick — the derived value
     * would otherwise overwrite it on the way back out.
     */
    it('a hand-set status overrides the call schedule', async () => {
      // Scheduled, so the schedule alone would derive `waiting`.
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/crm/service-tickets/${threeDayTicketId}/status`)
        .set(authHeader(csrToken))
        .send({ status: 'overdue' })
        .expect(200);
      expect((res.body as TicketBody).status).toBe('overdue');

      // And it survives a re-read rather than snapping back.
      const reread = await request(app.getHttpServer())
        .get(`/api/v1/crm/service-tickets/${threeDayTicketId}`)
        .set(authHeader(csrToken))
        .expect(200);
      expect((reread.body as TicketBody).status).toBe('overdue');

      // Put it back so the later step-timing assertions still hold.
      await request(app.getHttpServer())
        .patch(`/api/v1/crm/service-tickets/${threeDayTicketId}/status`)
        .set(authHeader(csrToken))
        .send({ status: 'waiting' })
        .expect(200);
    });

    it('rejects onboarding mutations on a non-onboarding ticket', async () => {
      await request(app.getHttpServer())
        .post(
          `/api/v1/crm/service-tickets/${billingId}/onboarding/steps/welcome_call/complete`,
        )
        .set(authHeader(csrToken))
        .expect(400);

      await request(app.getHttpServer())
        .patch(`/api/v1/crm/service-tickets/${billingId}/onboarding/checklist`)
        .set(authHeader(csrToken))
        .send({ loanNumberVerified: true })
        .expect(400);
    });

    it('stores the checklist and emails on the client, not the ticket', async () => {
      await request(app.getHttpServer())
        .patch(
          `/api/v1/crm/service-tickets/${threeDayTicketId}/onboarding/checklist`,
        )
        .set(authHeader(csrToken))
        .send({ loanNumberVerified: true, googleReviewRequested: true })
        .expect(200);

      await request(app.getHttpServer())
        .patch(
          `/api/v1/crm/service-tickets/${threeDayTicketId}/onboarding/emails`,
        )
        .set(authHeader(csrToken))
        .send({ milestone: 'welcomeSent' })
        .expect(200);

      // Written through one ticket, readable from the client record.
      const chain = await request(app.getHttpServer())
        .get(`/api/v1/crm/service-tickets/onboardings/${onboardingId}`)
        .set(authHeader(csrToken))
        .expect(200);
      const onboarding = chain.body as OnboardingBody;
      expect(onboarding.checklist.loanNumberVerified).toBe(true);
      expect(onboarding.checklist.googleReviewRequested).toBe(true);
      expect(onboarding.checklist.mortgageeClauseVerified).toBe(false);
      expect(onboarding.emailMilestones.welcomeSent).toBeTruthy();
      expect(onboarding.emailMilestones.day3Sent).toBeNull();
    });

    it('rejects an unknown email milestone', async () => {
      await request(app.getHttpServer())
        .patch(
          `/api/v1/crm/service-tickets/${threeDayTicketId}/onboarding/emails`,
        )
        .set(authHeader(csrToken))
        .send({ milestone: 'day99Sent' })
        .expect(400);
    });

    it('completes the onboarding when the final call closes', async () => {
      const connection = app.get<Connection>(getConnectionToken());

      // Open the 3-day call by backdating it, then complete it.
      await connection.collection('service_tickets').updateOne(
        { _id: new Types.ObjectId(threeDayTicketId) },
        {
          $set: {
            'onboarding.availableAt': new Date(Date.now() - 60_000),
            'onboarding.dueAt': new Date(Date.now() + 60_000),
          },
        },
      );
      await request(app.getHttpServer())
        .post(
          `/api/v1/crm/service-tickets/${threeDayTicketId}/onboarding/steps/checkin_3day/complete`,
        )
        .set(authHeader(csrToken))
        .expect(201);

      let chain = await request(app.getHttpServer())
        .get(`/api/v1/crm/service-tickets/onboardings/${onboardingId}`)
        .set(authHeader(csrToken))
        .expect(200);
      const thirtyDay = (chain.body as OnboardingBody).chain.find(
        (s) => s.stepKey === 'checkin_30day',
      )!;
      expect(thirtyDay.ticketId).toBeTruthy();
      expect((chain.body as OnboardingBody).isComplete).toBe(false);

      // Same for the 30-day call, which is 30 days out by design.
      await connection.collection('service_tickets').updateOne(
        { _id: new Types.ObjectId(thirtyDay.ticketId!) },
        {
          $set: {
            'onboarding.availableAt': new Date(Date.now() - 60_000),
            'onboarding.dueAt': new Date(Date.now() + 60_000),
          },
        },
      );
      await request(app.getHttpServer())
        .post(
          `/api/v1/crm/service-tickets/${thirtyDay.ticketId}/onboarding/steps/checkin_30day/complete`,
        )
        .set(authHeader(csrToken))
        .expect(201);

      chain = await request(app.getHttpServer())
        .get(`/api/v1/crm/service-tickets/onboardings/${onboardingId}`)
        .set(authHeader(csrToken))
        .expect(200);
      const finished = chain.body as OnboardingBody;
      expect(finished.isComplete).toBe(true);
      expect(finished.completedAt).toBeTruthy();
      expect(finished.currentStepKey).toBeNull();
      expect(finished.chain.every((s) => s.completedAt)).toBe(true);
    });

    it('reconciles a chain whose next ticket went missing', async () => {
      const connection = app.get<Connection>(getConnectionToken());

      // Start a fresh chain and complete its welcome call.
      const created = await request(app.getHttpServer())
        .post('/api/v1/crm/service-tickets')
        .set(authHeader(csrToken))
        .send({ category: 'Onboarding', householdId: seed.householdId })
        .expect(201);
      const ticket = created.body as TicketBody;
      const repairId = ticket.onboarding!.onboardingId;

      await request(app.getHttpServer())
        .post(
          `/api/v1/crm/service-tickets/${ticket.id}/onboarding/steps/welcome_call/complete`,
        )
        .set(authHeader(csrToken))
        .expect(201);

      // Simulate the chain breaking between writes.
      const removed = await connection.collection('service_tickets').deleteOne({
        'onboarding.onboardingId': new Types.ObjectId(repairId),
        'onboarding.stepKey': 'checkin_3day',
      });
      expect(removed.deletedCount).toBe(1);

      // Reading the onboarding repairs it.
      const chain = await request(app.getHttpServer())
        .get(`/api/v1/crm/service-tickets/onboardings/${repairId}`)
        .set(authHeader(csrToken))
        .expect(200);
      expect(
        (chain.body as OnboardingBody).chain.find(
          (s) => s.stepKey === 'checkin_3day',
        )!.ticketId,
      ).toBeTruthy();
    });

    it('lists a client onboardings and is denied to a producer', async () => {
      const byHousehold = await request(app.getHttpServer())
        .get(
          `/api/v1/crm/service-tickets/onboardings/household/${seed.householdId}`,
        )
        .set(authHeader(csrToken))
        .expect(200);
      expect(byHousehold.body.length).toBeGreaterThanOrEqual(1);
      expect(
        (byHousehold.body as OnboardingBody[]).every(
          (o) => o.householdId === seed.householdId,
        ),
      ).toBe(true);

      await request(app.getHttpServer())
        .get(`/api/v1/crm/service-tickets/onboardings/${onboardingId}`)
        .set(authHeader(producerToken))
        .expect(403);

      await request(app.getHttpServer())
        .post(
          `/api/v1/crm/service-tickets/${welcomeTicketId}/onboarding/steps/welcome_call/complete`,
        )
        .set(authHeader(producerToken))
        .expect(403);
    });

    it('denies onboarding writes to a read-only user', async () => {
      await request(app.getHttpServer())
        .patch(
          `/api/v1/crm/service-tickets/${welcomeTicketId}/onboarding/checklist`,
        )
        .set(authHeader(readOnlyToken))
        .send({ loanNumberVerified: true })
        .expect(403);
    });

    it('starts one onboarding per deal, however many times it is called', async () => {
      const service = app.get(ServiceTicketsService);
      const dealId = new Types.ObjectId().toString();

      const input = {
        agencyId: seed.agencyId,
        branchId: seed.branchId,
        householdId: seed.householdId,
        clientName: 'Audit Approved Client',
        salesProducerName: 'Pat Producer',
        dealId,
      };

      const first = await service.startOnboarding(input);
      const second = await service.startOnboarding(input);
      expect(second.id).toBe(first.id);
      expect(first.dealId).toBe(dealId);
      expect(first.salesProducerName).toBe('Pat Producer');

      const connection = app.get<Connection>(getConnectionToken());
      // One parent record...
      expect(
        await connection
          .collection('onboardings')
          .countDocuments({ dealId: new Types.ObjectId(dealId) }),
      ).toBe(1);
      // ...and one welcome ticket, whose tenancy survived the string -> ObjectId
      // hop from Deal/Household. A bad cast would leave it unreadable.
      const welcome = first.chain.find((s) => s.stepKey === 'welcome_call')!;
      const readBack = await request(app.getHttpServer())
        .get(`/api/v1/crm/service-tickets/${welcome.ticketId}`)
        .set(authHeader(ownerToken))
        .expect(200);
      expect(readBack.body.householdId).toBe(seed.householdId);
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
