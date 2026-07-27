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
        res.body.timeline.some(
          (e: { type: string }) => e.type === 'status',
        ),
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
        .send({ clientName: 'CSR Own Client', category: 'Billing Issue' })
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
