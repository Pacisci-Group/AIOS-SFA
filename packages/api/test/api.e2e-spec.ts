import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { ModuleKey } from '@sfa/shared';
import { Activity } from '../src/activities/schemas/activity.schema';
import { TransactionRunner } from '../src/common/mongo/transaction.runner';
import { Contact } from '../src/contacts/schemas/contact.schema';
import { Household } from '../src/households/schemas/household.schema';
import { LinkEntitiesStep } from '../src/leads/intake/link-entities.step';
import { Lead } from '../src/leads/schemas/lead.schema';
import { AccessResolverService } from '../src/permissions/access-resolver.service';
import { QuoteRecap } from '../src/quote-recaps/schemas/quote-recap.schema';
import { ShareLink } from '../src/share-links/schemas/share-link.schema';
import { StorageService } from '../src/storage/storage.service';
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

      const body = res.body as { status: string; service: string };
      expect(body.status).toBe('ok');
      expect(body.service).toBe('sfa-api');
    });
  });

  describe('Auth', () => {
    it('POST /api/v1/auth/login — success', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: seed.ownerEmail, password: TEST_PASSWORD })
        .expect(201);

      const body = res.body as {
        accessToken: string;
        refreshToken: string;
        user: { email: string; permissions: string[] };
      };
      expect(body.accessToken).toBeDefined();
      expect(body.refreshToken).toBeDefined();
      expect(body.user.email).toBe(seed.ownerEmail);
      expect(body.user.permissions.length).toBeGreaterThan(0);
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

      expect((res.body as { accessToken: string }).accessToken).toBeDefined();
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
          token: (inviteRes.body as { inviteToken: string }).inviteToken,
          password: 'InvitePass123!',
        })
        .expect(201);

      const body = res.body as {
        accessToken: string;
        user: { email: string };
      };
      expect(body.accessToken).toBeDefined();
      expect(body.user.email).toBe('invited-user@sfa.local');
    });
  });

  describe('Platform (Super Admin)', () => {
    it('GET /api/v1/platform/agencies', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/platform/agencies')
        .set(authHeader(superAdminToken))
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect((res.body as unknown[]).length).toBeGreaterThanOrEqual(1);
    });

    it('GET /api/v1/platform/agencies/:agencyId', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/platform/agencies/${seed.agencyId}`)
        .set(authHeader(superAdminToken))
        .expect(200);

      expect((res.body as { slug: string }).slug).toBe('test-agency');
    });

    it('POST /api/v1/platform/agencies', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/platform/agencies')
        .set(authHeader(superAdminToken))
        .send({ name: 'New Agency', slug: 'new-agency' })
        .expect(201);

      expect((res.body as { slug: string }).slug).toBe('new-agency');
    });

    it('PATCH /api/v1/platform/agencies/:agencyId/modules', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/platform/agencies/${seed.agencyId}/modules`)
        .set(authHeader(superAdminToken))
        .send({ modules: { mailers: { enabled: false } } })
        .expect(200);

      const body = res.body as {
        modules: Record<string, { enabled: boolean }>;
      };
      expect(body.modules.mailers.enabled).toBe(false);

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

      const roles = res.body as { slug: string }[];
      expect(roles.length).toBeGreaterThanOrEqual(5);
      expect(roles.some((r) => r.slug === 'producer')).toBe(true);
    });

    it('GET /api/v1/roles/:roleId', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/roles/${seed.producerRoleId}`)
        .set(authHeader(ownerToken))
        .expect(200);

      const body = res.body as { slug: string; permissions: string[] };
      expect(body.slug).toBe('producer');
      expect(body.permissions).toContain('leads:read');
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

      const body = res.body as { permissions: string[] };

      // Write always carries read; a `none` level removes the page entirely.
      expect(body.permissions).toContain('leads:read');
      expect(body.permissions).toContain('leads:write');
      expect(body.permissions).not.toContain('mailers:read');

      // Only page read/write or owner-only admin strings may be persisted.
      for (const permission of body.permissions) {
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
      const body = res.body as { permissions: string[] };
      expect(body.permissions).toContain('agency:roles:read');
      expect(body.permissions).toContain('agency:roles:write');
      expect(body.permissions).toContain('leads:read');
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

      expect((res.body as unknown[]).length).toBeGreaterThanOrEqual(1);
    });

    it('GET /api/v1/branches/:branchId', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/branches/${seed.branchId}`)
        .set(authHeader(ownerToken))
        .expect(200);

      expect((res.body as { slug: string }).slug).toBe('test-branch');
    });

    it('POST /api/v1/branches', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/branches')
        .set(authHeader(ownerToken))
        .send({ name: 'Downtown', slug: 'downtown' })
        .expect(201);

      expect((res.body as { slug: string }).slug).toBe('downtown');
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
      expect((res.body as unknown[]).length).toBeGreaterThanOrEqual(2);
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

      const users = list.body as { _id: string; email: string }[];
      const producer = users.find((u) => u.email === seed.producerEmail);
      expect(producer).toBeDefined();
      invitedUserId = producer!._id;

      const res = await request(app.getHttpServer())
        .get(`/api/v1/users/${invitedUserId}`)
        .set(authHeader(ownerToken))
        .expect(200);

      const body = res.body as { effectivePermissions: string[] };
      expect(body.effectivePermissions).toContain('leads:read');
    });

    it('PATCH /api/v1/users/:userId/roles', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/users/${invitedUserId}/roles`)
        .set(authHeader(ownerToken))
        .send({ roleIds: [seed.producerRoleId] })
        .expect(200);

      expect((res.body as { roleIds: string[] }).roleIds.length).toBe(1);
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

      const body = res.body as { effectivePermissions: string[] };
      expect(body.effectivePermissions).toContain('mailers:read');
      expect(body.effectivePermissions).not.toContain('leads:write');
      expect(body.effectivePermissions).toContain('leads:read');
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

      const body = res.body as { effectivePermissions: string[] };
      expect(body.effectivePermissions).not.toContain('mailers:read');
      expect(body.effectivePermissions).toContain('leads:write');
      expect(body.effectivePermissions).toContain('leads:read');
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
      { path: 'deals', module: ModuleKey.Clients },
      // NOTE: `deal-audits` (DealAuditsModule / PAC-12/14), `leads`
      // (LeadsModule / PAC-36) and `quote-recaps` (QuoteRecapsModule / PAC-39)
      // are real modules, not `{status:'ready'}` stubs — each is covered by its
      // own describe block below. The `files` stub was removed with PAC-39: it
      // borrowed the `quote_recaps` gate and the real file API is now
      // `POST /quote-recaps/quote-document/presign`.
      { path: 'crm/service-tickets', module: ModuleKey.CrmService },
      { path: 'performance', module: ModuleKey.Performance },
      { path: 'leaderboard', module: ModuleKey.Leaderboard },
      { path: 'mailers', module: ModuleKey.Mailers },
      { path: 'onboardings', module: ModuleKey.Onboardings },
      { path: 'management', module: ModuleKey.Management },
      { path: 'owner-dashboard', module: ModuleKey.OwnerDashboard },
      { path: 'command-center', module: ModuleKey.CommandCenter },
    ];

    it.each(featureRoutes)(
      'GET /api/v1/$path — agency owner',
      async ({ path, module }) => {
        const res = await request(app.getHttpServer())
          .get(`/api/v1/${path}`)
          .set(authHeader(ownerToken))
          .expect(200);

        const body = res.body as { module?: string; status: string };
        expect(body.module).toBe(module);
        expect(body.status).toBe('ready');
      },
    );

    it('GET /api/v1/dashboard — producer with branch scope', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/dashboard')
        .set(authHeader(producerToken))
        .expect(200);

      expect((res.body as { module: string }).module).toBe(ModuleKey.Dashboard);
    });

    it('GET /api/v1/command-center — forbidden for producer', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/command-center')
        .set(authHeader(producerToken))
        .expect(403);
    });

    // NOTE: there is no longer a stub route a *producer* can write to — the
    // Producer template grants write on `leads` and `quote_recaps` only, and
    // both are real modules now. Producer write access through the full guard
    // chain is covered by "Quote Recaps (PAC-39 create)" below.

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
    // handler (PATCH) requires `{module}:write`.
    const mutatingFeatureRoutes = [
      { path: 'dashboard', module: ModuleKey.Dashboard },
      { path: 'contacts', module: ModuleKey.Clients },
      { path: 'households', module: ModuleKey.Clients },
      { path: 'deals', module: ModuleKey.Clients },
      // `deal-audits` write (resolve) is item-scoped, not a bare PATCH stub —
      // covered by its own describe block below. `leads` is read-only for now
      // (LeadsModule / PAC-36 ships the list; the write path is a later story).
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

        expect((res.body as { module: string }).module).toBe(module);
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

        const body = res.body as { module: string; status: string };
        expect(body.module).toBe(module);
        expect(body.status).toBe('updated');
      },
    );

    it('GET /api/v1/leaderboard — read-only user can read (read-only page)', async () => {
      // Was `/files` until PAC-39 removed that stub. Any read-only-for-everyone
      // page proves the same thing: read access does not imply write.
      await request(app.getHttpServer())
        .get('/api/v1/leaderboard')
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

  describe('Leads (PAC-36 list)', () => {
    interface LeadRowBody {
      id: string;
      name: string;
      leadSource: string;
      status: string;
      temperature: string;
      phone: string | null;
      email: string | null;
      updatedAt: string | null;
    }
    interface LeadListBody {
      page: number;
      pageSize: number;
      total: number;
      totalPages: number;
      items: LeadRowBody[];
    }

    const listAs = async (token: string, query = '') => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/leads${query}`)
        .set(authHeader(token))
        .expect(200);
      return res.body as LeadListBody;
    };

    beforeAll(async () => {
      const userModel = app.get<Model<User>>(getModelToken(User.name));
      const leadModel = app.get<Model<Lead>>(getModelToken(Lead.name));

      const producer = await userModel.findOne({ email: seed.producerEmail });
      const owner = await userModel.findOne({ email: seed.ownerEmail });

      const base = { agencyId: seed.agencyId, branchId: seed.branchId };

      await leadModel.create([
        {
          ...base,
          firstName: 'Maria',
          lastName: 'Rodriguez',
          // Stored as the raw SmartSuite choice code, exactly as the migration
          // writes it — the API must normalize this to `Requote`.
          status: 'arW7O',
          temperature: 'Hot',
          leadSource: { code: 'WCO7l', label: 'Mailer' },
          phones: ['(555) 123-4567'],
          emails: ['maria.rodriguez@example.com'],
          quoteControlNumber: 'QCN-100001',
          producerId: producer!._id,
          lastActivityAt: new Date(),
          isTestRecord: false,
        },
        {
          ...base,
          firstName: 'John',
          lastName: 'Smith',
          status: 'New',
          temperature: 'Cold',
          leadSource: { code: 'X2Wrh', label: 'Facebook' },
          phones: ['555-987-6543'],
          emails: ['john.smith@example.com'],
          producerId: producer!._id,
          lastActivityAt: new Date(Date.now() - 86_400_000),
          isTestRecord: false,
        },
        {
          // Another producer's lead — must never reach the producer's list.
          ...base,
          firstName: 'Someone',
          lastName: 'Else',
          status: 'New',
          temperature: 'Warm',
          leadSource: { code: '30sDe', label: 'Google' },
          producerId: owner!._id,
          lastActivityAt: new Date(),
          isTestRecord: false,
        },
        {
          ...base,
          firstName: 'Test',
          lastName: 'Record',
          status: 'New',
          temperature: 'Hot',
          leadSource: { code: 'ENEJP', label: 'Test' },
          producerId: producer!._id,
          isTestRecord: true,
        },
      ]);
    });

    it('GET /api/v1/leads — producer gets a paginated envelope of own leads', async () => {
      const body = await listAs(producerToken);

      expect(body).toHaveProperty('page');
      expect(body).toHaveProperty('pageSize');
      expect(body).toHaveProperty('totalPages');
      expect(Array.isArray(body.items)).toBe(true);
      // Two own, non-test leads. The other producer's lead and the test record
      // are both excluded.
      expect(body.total).toBe(2);
      expect(body.items.map((i) => i.name).sort()).toEqual([
        'John Smith',
        'Maria Rodriguez',
      ]);
    });

    it('scope=agency from a producer is clamped, not honoured or rejected', async () => {
      const clamped = await listAs(producerToken, '?scope=agency');
      const plain = await listAs(producerToken);

      // 200 with the caller's own leads — never a 403, never a wider set.
      expect(clamped.total).toBe(plain.total);
      expect(clamped.items.map((i) => i.id).sort()).toEqual(
        plain.items.map((i) => i.id).sort(),
      );
    });

    it('producerId pointing at another user is ignored for `own` scope', async () => {
      const userModel = app.get<Model<User>>(getModelToken(User.name));
      const owner = await userModel.findOne({ email: seed.ownerEmail });

      const body = await listAs(
        producerToken,
        `?producerId=${owner!._id.toString()}`,
      );

      expect(body.total).toBe(2);
      expect(body.items.every((i) => i.name !== 'Someone Else')).toBe(true);
    });

    it('status filter matches the canonical label against a stored raw code', async () => {
      const body = await listAs(producerToken, '?status=Requote');

      expect(body.total).toBe(1);
      expect(body.items[0].name).toBe('Maria Rodriguez');
      // Normalized on read — the raw `arW7O` never reaches the client.
      expect(body.items[0].status).toBe('Requote');
    });

    it('status accepts several values at once (repeated param)', async () => {
      // Requote (stored as the raw `arW7O`) OR New — both of the producer's
      // leads, proving the label/code expansion survives the multi-select.
      const body = await listAs(producerToken, '?status=Requote&status=New');

      expect(body.total).toBe(2);
      expect(body.items.map((i) => i.name).sort()).toEqual([
        'John Smith',
        'Maria Rodriguez',
      ]);
    });

    it('status also accepts the comma-separated form', async () => {
      const repeated = await listAs(
        producerToken,
        '?status=Requote&status=New',
      );
      const commas = await listAs(producerToken, '?status=Requote,New');

      expect(commas.total).toBe(repeated.total);
    });

    it('temperature accepts several values at once', async () => {
      const hot = await listAs(producerToken, '?temperature=Hot');
      const both = await listAs(producerToken, '?temperature=Hot,Cold');

      expect(hot.total).toBe(1);
      expect(hot.items[0].name).toBe('Maria Rodriguez');
      // Maria (Hot) + John (Cold). The Warm lead belongs to another producer.
      expect(both.total).toBe(2);
    });

    it('rejects an unknown temperature even alongside valid ones (400)', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/leads?temperature=Hot&temperature=Tepid')
        .set(authHeader(producerToken))
        .expect(400);
    });

    it('rows expose only display fields', async () => {
      const body = await listAs(producerToken);
      const row = body.items[0] as unknown as Record<string, unknown>;

      expect(Object.keys(row).sort()).toEqual([
        'email',
        'id',
        'leadSource',
        'name',
        'phone',
        'status',
        'temperature',
        'updatedAt',
      ]);
    });

    it('phone search matches across stored formatting', async () => {
      // The stored value is `(555) 123-4567`; the query is bare digits.
      const body = await listAs(producerToken, '?search=5551234');

      expect(body.total).toBe(1);
      expect(body.items[0].name).toBe('Maria Rodriguez');
    });

    it('a long surname searches by name, not as a quote control number', async () => {
      // Legacy treated any 8+ alphanumeric string as a QCN and would miss this.
      const body = await listAs(producerToken, '?search=Rodriguez');

      expect(body.total).toBe(1);
      expect(body.items[0].name).toBe('Maria Rodriguez');
    });

    it('an agency-scoped caller sees every producer, still excluding test records', async () => {
      const body = await listAs(ownerToken);

      expect(body.total).toBe(3);
      expect(body.items.every((i) => i.name !== 'Test Record')).toBe(true);
    });

    it('rejects an out-of-range pageSize (400)', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/leads?pageSize=500')
        .set(authHeader(producerToken))
        .expect(400);
    });
  });

  describe('Leads (PAC-37 create)', () => {
    interface CreatedLeadBody {
      id: string;
    }

    let contactModel: Model<Contact>;
    let householdModel: Model<Household>;
    let leadModel: Model<Lead>;
    let userModel: Model<User>;

    /**
     * `key` drives BOTH the surname and the street, so each test is isolated on
     * every dedupe signal at once. Sharing a street across tests would let
     * signal 3 (address + zip) merge unrelated cases onto one lead — which is
     * correct pipeline behaviour, but makes for a very confusing test failure.
     * Tests that *want* to exercise a shared signal override it explicitly.
     */
    const payload = (
      key: string,
      overrides: Record<string, unknown> = {},
      contact: Record<string, unknown> = {},
    ) => ({
      primaryContact: {
        firstName: 'Dana',
        lastName: key,
        dateOfBirth: '1988-04-12',
        phone: '(555) 222-3333',
        email: `Dana.${key}@Example.com`,
        ...contact,
      },
      address: {
        street: `77 ${key} Lane`,
        city: 'Tulsa',
        state: 'OK',
        zip: '74101',
      },
      members: [],
      leadSourceCode: 'WCO7l',
      ...overrides,
    });

    const createAs = async (token: string, body: unknown, expected = 201) => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/leads')
        .set(authHeader(token))
        .send(body)
        .expect(expected);
      return res.body as CreatedLeadBody;
    };

    beforeAll(() => {
      contactModel = app.get<Model<Contact>>(getModelToken(Contact.name));
      householdModel = app.get<Model<Household>>(getModelToken(Household.name));
      leadModel = app.get<Model<Lead>>(getModelToken(Lead.name));
      userModel = app.get<Model<User>>(getModelToken(User.name));
    });

    it('creates a lead, household and contact, and returns the lead id', async () => {
      const body = await createAs(producerToken, payload('Alderton'));
      expect(body.id).toMatch(/^[a-f0-9]{24}$/);

      const lead = await leadModel.findById(body.id);
      expect(lead).not.toBeNull();
      expect(lead!.status).toBe('New');
      expect(lead!.temperature).toBe('Hot');
      expect(lead!.leadSource?.label).toBe('Mailer');
      expect(lead!.householdId).toBeTruthy();
      expect(lead!.primaryContactId).toBeTruthy();
      expect(lead!.intakeSource?.channel).toBe('internal');
      expect(lead!.addressKey).toBe('77 alderton lane|74101');
      // Normalised on the way in.
      expect(lead!.emails).toEqual(['dana.alderton@example.com']);
      expect(lead!.phones).toEqual(['5552223333']);
    });

    it('assigns the lead to the creating producer and shows it in their list', async () => {
      const producer = await userModel.findOne({ email: seed.producerEmail });
      const created = await createAs(producerToken, payload('Bexley'));

      const lead = await leadModel.findById(created.id);
      expect(lead!.producerId?.toString()).toBe(producer!._id.toString());

      // Proves `lastActivityAt` was set — the list sorts on it, and a lead
      // without it is effectively invisible at the top of the page.
      const res = await request(app.getHttpServer())
        .get('/api/v1/leads?search=Bexley')
        .set(authHeader(producerToken))
        .expect(200);
      const listed = (res.body as { items: { id: string }[] }).items;
      expect(listed.some((row) => row.id === created.id)).toBe(true);
    });

    // `leads:write` is held by Agency Owner too, so an owner becomes the
    // producer of any lead they enter. Pinned by a test because it is an
    // accepted trade-off (PAC-53), not an accident — if it ever changes, it
    // should change deliberately.
    it('assigns an owner-created lead to the owner', async () => {
      const owner = await userModel.findOne({ email: seed.ownerEmail });
      const created = await createAs(ownerToken, payload('Corvain'));

      const lead = await leadModel.findById(created.id);
      expect(lead!.producerId?.toString()).toBe(owner!._id.toString());
    });

    it('rejects a caller without leads:write (403)', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/leads')
        .set(authHeader(readOnlyToken))
        .send(payload('Denholm'))
        .expect(403);
    });

    it('rejects an invalid body (400)', async () => {
      await createAs(
        producerToken,
        payload('Bad', {}, { email: 'not-an-email' }),
        400,
      );
      await createAs(
        producerToken,
        payload('Bad', { leadSourceCode: 'nope' }),
        400,
      );
      // `Test` must never be selectable at intake.
      await createAs(
        producerToken,
        payload('Bad', { leadSourceCode: 'ENEJP' }),
        400,
      );
    });

    it('creates ONE lead when the same submission token is sent twice', async () => {
      const body = payload('Everly', {
        submissionToken: 'replay-token-0001',
      });

      const first = await createAs(producerToken, body);
      const second = await createAs(producerToken, body);

      expect(second.id).toBe(first.id);
      expect(await leadModel.countDocuments({ lastName: 'Everly' })).toBe(1);
    });

    it('reuses the contact and household for a matching name + DOB', async () => {
      const first = await createAs(producerToken, payload('Fairholm'));
      const second = await createAs(
        producerToken,
        payload('Fairholm', {
          // Different address, so lead dedupe cannot be what merges these —
          // only contact matching can.
          address: {
            street: '9 Elm Ct',
            city: 'Tulsa',
            state: 'OK',
            zip: '74104',
          },
        }),
      );

      expect(second.id).not.toBe(first.id);
      expect(await contactModel.countDocuments({ lastName: 'Fairholm' })).toBe(
        1,
      );

      const leadOne = await leadModel.findById(first.id);
      const leadTwo = await leadModel.findById(second.id);
      expect(leadTwo!.householdId!.toString()).toBe(
        leadOne!.householdId!.toString(),
      );
      expect(
        await householdModel.countDocuments({ name: 'Fairholm Household' }),
      ).toBe(1);
    });

    // The legacy regression: a name collision with a CONFLICTING date of birth
    // is two different people. Legacy treated conflict and absence alike and
    // silently created a duplicate in one case while merging in the other.
    it('creates a separate contact when the name matches but the DOB conflicts', async () => {
      await createAs(
        producerToken,
        payload('Grieves', {}, { dateOfBirth: '1970-01-01' }),
      );
      await createAs(
        producerToken,
        payload(
          'Grieves',
          // A different address too, so the second submission starts its own
          // lead rather than deduping onto the first by address.
          {
            address: {
              street: '4 Birch Way',
              city: 'Tulsa',
              state: 'OK',
              zip: '74106',
            },
          },
          {
            dateOfBirth: '1991-09-09',
            email: 'other.grieves@example.com',
          },
        ),
      );

      expect(await contactModel.countDocuments({ lastName: 'Grieves' })).toBe(
        2,
      );
    });

    it('creates member contacts with the right role and isPrimary=false', async () => {
      const created = await createAs(
        producerToken,
        payload('Harlow', {
          members: [
            {
              firstName: 'Sam',
              lastName: 'Harlow',
              dateOfBirth: '1990-06-01',
              role: 'Spouse',
            },
            { firstName: 'Kit', lastName: 'Harlow', role: 'Child' },
          ],
        }),
      );

      const contacts = await contactModel
        .find({ lastName: 'Harlow' })
        .sort({ firstName: 1 });
      expect(contacts).toHaveLength(3);

      const primary = contacts.find((c) => c.firstName === 'Dana');
      expect(primary!.isPrimary).toBe(true);
      expect(primary!.roleInHousehold).toBe('Named Insured');

      const child = contacts.find((c) => c.firstName === 'Kit');
      expect(child!.isPrimary).toBe(false);
      expect(child!.roleInHousehold).toBe('Child');

      const lead = await leadModel.findById(created.id);
      expect(lead!.memberContactIds).toHaveLength(2);

      const household = await householdModel.findById(lead!.householdId);
      expect(household!.memberContactIds).toHaveLength(2);
      expect(household!.leadIds.map((id) => id.toString())).toContain(
        created.id,
      );
    });

    it('does not reassign the producer when deduping onto an existing lead', async () => {
      const owner = await userModel.findOne({ email: seed.ownerEmail });
      const first = await createAs(
        ownerToken,
        payload('Ipsley', { quoteControlNumber: 'QCN-PAC37-1' }),
      );

      // Same QCN, different caller AND a different address — so signal 2 (quote
      // control number) is the only thing that can match, in isolation.
      const second = await createAs(
        producerToken,
        payload(
          'Ipsley',
          {
            quoteControlNumber: 'QCN-PAC37-1',
            address: {
              street: '12 Cedar Rd',
              city: 'Tulsa',
              state: 'OK',
              zip: '74108',
            },
          },
          { email: 'ipsley.alt@example.com' },
        ),
      );

      expect(second.id).toBe(first.id);
      const lead = await leadModel.findById(first.id);
      expect(lead!.producerId?.toString()).toBe(owner!._id.toString());
    });

    // Guards the guard: without this, the rollback test below would still pass
    // on a standalone mongod via the compensating-delete fallback, and we would
    // never notice that real transactions had stopped being exercised.
    it('runs against a Mongo deployment that supports transactions', () => {
      expect(app.get(TransactionRunner).transactionsSupported).toBe(true);
    });

    // White-box on purpose: there is no clean black-box way to fail the pipeline
    // partway. What matters is that a mid-flight failure leaves NOTHING behind.
    it('rolls back every write when a later step fails', async () => {
      const contactsBefore = await contactModel.countDocuments();
      const householdsBefore = await householdModel.countDocuments();
      const leadsBefore = await leadModel.countDocuments();

      const spy = jest
        .spyOn(LinkEntitiesStep.prototype, 'run')
        .mockRejectedValueOnce(new Error('forced failure'));

      await request(app.getHttpServer())
        .post('/api/v1/leads')
        .set(authHeader(producerToken))
        .send(payload('Jarrow'))
        .expect(500);

      spy.mockRestore();

      expect(await contactModel.countDocuments()).toBe(contactsBefore);
      expect(await householdModel.countDocuments()).toBe(householdsBefore);
      expect(await leadModel.countDocuments()).toBe(leadsBefore);
      expect(await leadModel.countDocuments({ lastName: 'Jarrow' })).toBe(0);
    });
  });

  describe('Quote Recaps (PAC-39 create)', () => {
    interface CreatedRecapBody {
      id: string;
      leadId: string;
      premium: number;
      itemCount: number;
      productsQuoted: string[];
      quoteDate: string;
      leadStatus: string;
    }

    let quoteRecapModel: Model<QuoteRecap>;
    let leadModel: Model<Lead>;
    let householdModel: Model<Household>;
    let activityModel: Model<Activity>;
    let userModel: Model<User>;
    let statSpy: jest.SpyInstance;

    /**
     * Object storage isn't running under test, so `statObject` is stubbed to
     * report only the keys a test has "uploaded". That keeps the real
     * verification path exercised — including the 404 for a key that never
     * landed — without a MinIO dependency.
     */
    const uploaded = new Map<string, { size: number; contentType: string }>();

    const keyFor = (leadId: string) =>
      `agencies/${seed.agencyId}/quote-recaps/${leadId}/2026/quote.pdf`;

    const upload = (
      leadId: string,
      stat = { size: 2048, contentType: 'application/pdf' },
    ) => {
      const key = keyFor(leadId);
      uploaded.set(key, stat);
      return key;
    };

    const payload = (
      leadId: string,
      overrides: Record<string, unknown> = {},
    ) => ({
      leadId,
      policies: [{ policyType: 'Auto', premium: 1200.1, itemCount: 2 }],
      sameAsHousehold: true,
      quoteDocument: {
        key: keyFor(leadId),
        filename: 'quote.pdf',
        contentType: 'application/pdf',
        size: 2048,
      },
      ...overrides,
    });

    const createAs = async (token: string, body: unknown, expected = 201) => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/quote-recaps')
        .set(authHeader(token))
        .send(body)
        .expect(expected);
      return res.body as CreatedRecapBody;
    };

    /** A lead owned by the given producer, with a real household attached. */
    const seedLead = async (
      producerId: Types.ObjectId | undefined,
      overrides: Record<string, unknown> = {},
    ) => {
      const household = await householdModel.create({
        agencyId: seed.agencyId,
        branchId: seed.branchId,
        name: 'Quotable Household',
        propertyAddress: {
          street: '9 Quote Way',
          city: 'Tulsa',
          state: 'OK',
          zip: '74101',
        },
      });
      const lead = await leadModel.create({
        agencyId: seed.agencyId,
        branchId: seed.branchId,
        firstName: 'Quinn',
        lastName: 'Quoted',
        status: 'New',
        producerId,
        householdId: household._id,
        ...overrides,
      });
      return { lead, household };
    };

    beforeAll(() => {
      quoteRecapModel = app.get<Model<QuoteRecap>>(
        getModelToken(QuoteRecap.name),
      );
      leadModel = app.get<Model<Lead>>(getModelToken(Lead.name));
      householdModel = app.get<Model<Household>>(getModelToken(Household.name));
      activityModel = app.get<Model<Activity>>(getModelToken(Activity.name));
      userModel = app.get<Model<User>>(getModelToken(User.name));

      statSpy = jest
        .spyOn(app.get(StorageService), 'statObject')
        .mockImplementation((key: string) =>
          Promise.resolve(uploaded.get(key) ?? null),
        );
    });

    afterAll(() => statSpy.mockRestore());

    it('persists real lead + household refs, per-policy rows and derived totals', async () => {
      const producer = await userModel.findOne({ email: seed.producerEmail });
      const { lead, household } = await seedLead(producer!._id);
      upload(lead._id.toString());

      const body = await createAs(
        producerToken,
        payload(lead._id.toString(), {
          policies: [
            { policyType: 'Auto', premium: 1200.1, itemCount: 2 },
            { policyType: 'Home', premium: 899.95, itemCount: 1 },
            // A repeated type must not be double-counted in `productsQuoted`.
            { policyType: 'Auto', premium: 100, itemCount: 1 },
          ],
        }),
      );

      expect(body.id).toMatch(/^[a-f0-9]{24}$/);

      const recap = await quoteRecapModel.findById(body.id);
      expect(recap!.leadId?.toString()).toBe(lead._id.toString());
      expect(recap!.householdId?.toString()).toBe(household._id.toString());
      expect(recap!.policies).toHaveLength(3);
      expect(recap!.producerId?.toString()).toBe(producer!._id.toString());
      expect(recap!.quoteDate).toBeInstanceOf(Date);

      // Derived server-side. `1200.10 + 899.95 + 100` is 2200.0499999999997 in
      // IEEE-754 — the rounding is what keeps the Quoted scorecard honest.
      expect(recap!.premium).toBe(2200.05);
      expect(recap!.itemCount).toBe(4);
      expect(recap!.productsQuoted).toEqual(['Auto', 'Home']);

      // Echoed back so the totals are observable without a DB read.
      expect(body.premium).toBe(2200.05);
      expect(body.itemCount).toBe(4);
      expect(body.productsQuoted).toEqual(['Auto', 'Home']);
    });

    it('ignores client-supplied totals — they are always recomputed', async () => {
      const producer = await userModel.findOne({ email: seed.producerEmail });
      const { lead } = await seedLead(producer!._id);
      upload(lead._id.toString());

      const body = await createAs(
        producerToken,
        payload(lead._id.toString(), {
          premium: 999_999,
          itemCount: 999,
          productsQuoted: ['Life'],
        }),
      );

      expect(body.premium).toBe(1200.1);
      expect(body.itemCount).toBe(2);
      expect(body.productsQuoted).toEqual(['Auto']);
    });

    it('copies the household address when sameAsHousehold is set, discarding the client’s', async () => {
      const producer = await userModel.findOne({ email: seed.producerEmail });
      const { lead } = await seedLead(producer!._id);
      upload(lead._id.toString());

      const body = await createAs(
        producerToken,
        payload(lead._id.toString(), {
          policies: [{ policyType: 'Home', premium: 800, itemCount: 1 }],
          sameAsHousehold: true,
          propertyAddress: {
            street: 'Somewhere Else',
            city: 'X',
            state: 'Y',
            zip: '00000',
          },
        }),
      );

      const recap = await quoteRecapModel.findById(body.id);
      expect(recap!.propertyAddress?.street).toBe('9 Quote Way');
    });

    it('resolves a migrated lead’s household via legacyHouseholdId and backfills it', async () => {
      const producer = await userModel.findOne({ email: seed.producerEmail });
      // The migration writes only `legacyHouseholdId` on leads — never
      // `householdId` — so without the fallback every migrated lead would 409.
      const household = await householdModel.create({
        agencyId: seed.agencyId,
        branchId: seed.branchId,
        name: 'Legacy Household',
        legacySmartSuiteId: 'legacy-hh-pac39',
      });
      const lead = await leadModel.create({
        agencyId: seed.agencyId,
        branchId: seed.branchId,
        firstName: 'Milo',
        lastName: 'Migrated',
        status: 'hfwda', // migrated "Qualified"
        producerId: producer!._id,
        legacyHouseholdId: 'legacy-hh-pac39',
      });
      upload(lead._id.toString());

      const body = await createAs(producerToken, payload(lead._id.toString()));

      const recap = await quoteRecapModel.findById(body.id);
      expect(recap!.householdId?.toString()).toBe(household._id.toString());

      const healed = await leadModel.findById(lead._id);
      expect(healed!.householdId?.toString()).toBe(household._id.toString());
      // A raw migrated status code must still advance.
      expect(healed!.status).toBe('Quoted');
    });

    it('409s when the lead has no household at all', async () => {
      const producer = await userModel.findOne({ email: seed.producerEmail });
      const lead = await leadModel.create({
        agencyId: seed.agencyId,
        branchId: seed.branchId,
        firstName: 'Hugh',
        lastName: 'Homeless',
        producerId: producer!._id,
      });
      upload(lead._id.toString());

      await createAs(producerToken, payload(lead._id.toString()), 409);
    });

    it('advances the lead forward only', async () => {
      const producer = await userModel.findOne({ email: seed.producerEmail });

      const advances = await seedLead(producer!._id, { status: 'New' });
      upload(advances.lead._id.toString());
      const advanced = await createAs(
        producerToken,
        payload(advances.lead._id.toString()),
      );
      expect(advanced.leadStatus).toBe('Quoted');

      // Terminal statuses must never be dragged backwards by a late recap.
      for (const status of ['Sold', 'Lost']) {
        const stuck = await seedLead(producer!._id, { status });
        upload(stuck.lead._id.toString());
        const res = await createAs(
          producerToken,
          payload(stuck.lead._id.toString()),
        );
        expect(res.leadStatus).toBe(status);
        expect((await leadModel.findById(stuck.lead._id))!.status).toBe(status);
      }
    });

    it('writes a quoted activity linked to both the recap and the lead', async () => {
      const producer = await userModel.findOne({ email: seed.producerEmail });
      const { lead } = await seedLead(producer!._id);
      upload(lead._id.toString());

      const body = await createAs(producerToken, payload(lead._id.toString()));

      // Queried with a real ObjectId, as every production read path does.
      // A raw string does not match on this model's ObjectId paths — that is
      // true of the pre-existing `leadId` too, not something specific here.
      const activity = await activityModel.findOne({
        quoteRecapId: new Types.ObjectId(body.id),
      });
      expect(activity).not.toBeNull();
      expect(activity!.type).toBe('quoted');
      expect(activity!.subjectType).toBe('quoteRecap');
      expect(activity!.leadId?.toString()).toBe(lead._id.toString());
      // Explicit, or it would be mislabelled as migrated (the schema default).
      expect(activity!.source).toBe('internal');
    });

    it('creates ONE recap when the same submission token is sent twice', async () => {
      const producer = await userModel.findOne({ email: seed.producerEmail });
      const { lead } = await seedLead(producer!._id);
      upload(lead._id.toString());

      const body = payload(lead._id.toString(), {
        submissionToken: 'pac39-replay-token',
      });
      const first = await createAs(producerToken, body);
      const second = await createAs(producerToken, body);

      expect(second.id).toBe(first.id);
      expect(await quoteRecapModel.countDocuments({ leadId: lead._id })).toBe(
        1,
      );
    });

    it('404s for a lead outside the caller’s data scope', async () => {
      // Owner-created leads are assigned to the owner, so the producer (`own`
      // scope) must not be able to attach a recap by editing the leadId param.
      const owner = await userModel.findOne({ email: seed.ownerEmail });
      const { lead } = await seedLead(owner!._id);
      upload(lead._id.toString());

      // A 404, not a 403: whether another producer's lead exists is not the
      // caller's business.
      await createAs(producerToken, payload(lead._id.toString()), 404);
      expect(await quoteRecapModel.countDocuments({ leadId: lead._id })).toBe(
        0,
      );
    });

    it('404s for an unassigned lead under own scope', async () => {
      const { lead } = await seedLead(undefined);
      upload(lead._id.toString());
      await createAs(producerToken, payload(lead._id.toString()), 404);
    });

    it('404s for a malformed or unknown lead id', async () => {
      await createAs(producerToken, payload('not-an-object-id'), 400);
      await createAs(producerToken, payload('0'.repeat(24)), 404);
    });

    it('rejects a caller without quote_recaps:write (403)', async () => {
      const producer = await userModel.findOne({ email: seed.producerEmail });
      const { lead } = await seedLead(producer!._id);
      upload(lead._id.toString());

      await request(app.getHttpServer())
        .post('/api/v1/quote-recaps')
        .set(authHeader(readOnlyToken))
        .send(payload(lead._id.toString()))
        .expect(403);
    });

    it('rejects an invalid body (400)', async () => {
      const producer = await userModel.findOne({ email: seed.producerEmail });
      const { lead } = await seedLead(producer!._id);
      const id = lead._id.toString();
      upload(id);

      await createAs(producerToken, payload(id, { policies: [] }), 400);
      await createAs(
        producerToken,
        payload(id, {
          policies: [{ policyType: 'Auto', premium: 100, itemCount: 0 }],
        }),
        400,
      );
      // Raw SmartSuite codes are for *reading* legacy data, not for input.
      await createAs(
        producerToken,
        payload(id, {
          policies: [{ policyType: 'PYgez', premium: 100, itemCount: 1 }],
        }),
        400,
      );
      // The quote document is required (PAC-39 decision 4).
      await createAs(
        producerToken,
        payload(id, { quoteDocument: undefined }),
        400,
      );
      // A property policy with no address and no "same as household".
      await createAs(
        producerToken,
        payload(id, {
          policies: [{ policyType: 'Home', premium: 900, itemCount: 1 }],
          sameAsHousehold: false,
        }),
        400,
      );
    });

    it('404s when the declared document never landed in storage', async () => {
      const producer = await userModel.findOne({ email: seed.producerEmail });
      const { lead } = await seedLead(producer!._id);
      // Deliberately not uploaded.
      await createAs(producerToken, payload(lead._id.toString()), 404);
    });

    it('enforces type and size from storage, not from the client’s claim', async () => {
      const producer = await userModel.findOne({ email: seed.producerEmail });

      const big = await seedLead(producer!._id);
      upload(big.lead._id.toString(), {
        size: 11 * 1024 * 1024,
        contentType: 'application/pdf',
      });
      // The body still declares a legal 2048 bytes — only HeadObject knows.
      await createAs(producerToken, payload(big.lead._id.toString()), 400);

      const wrongType = await seedLead(producer!._id);
      upload(wrongType.lead._id.toString(), {
        size: 2048,
        contentType: 'application/zip',
      });
      await createAs(
        producerToken,
        payload(wrongType.lead._id.toString()),
        400,
      );
    });

    it('rejects a document key belonging to another agency or lead (400)', async () => {
      const producer = await userModel.findOne({ email: seed.producerEmail });
      const { lead } = await seedLead(producer!._id);
      const foreignKey = 'agencies/someone-else/quote-recaps/x/2026/quote.pdf';
      uploaded.set(foreignKey, { size: 2048, contentType: 'application/pdf' });

      await createAs(
        producerToken,
        payload(lead._id.toString(), {
          quoteDocument: {
            key: foreignKey,
            filename: 'quote.pdf',
            contentType: 'application/pdf',
            size: 2048,
          },
        }),
        400,
      );
    });

    it('GET /quote-recaps/context returns the lead + household header', async () => {
      const producer = await userModel.findOne({ email: seed.producerEmail });
      const { lead, household } = await seedLead(producer!._id);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/quote-recaps/context?leadId=${lead._id.toString()}`)
        .set(authHeader(producerToken))
        .expect(200);

      const context = res.body as {
        primaryContactName: string;
        householdId: string | null;
        householdAddress: { street: string } | null;
        leadStatus: string;
      };
      expect(context.primaryContactName).toBe('Quinn Quoted');
      expect(context.householdId).toBe(household._id.toString());
      expect(context.householdAddress?.street).toBe('9 Quote Way');
      expect(context.leadStatus).toBe('New');
    });

    it('GET /quote-recaps/context 404s outside the caller’s scope', async () => {
      const owner = await userModel.findOne({ email: seed.ownerEmail });
      const { lead } = await seedLead(owner!._id);

      await request(app.getHttpServer())
        .get(`/api/v1/quote-recaps/context?leadId=${lead._id.toString()}`)
        .set(authHeader(producerToken))
        .expect(404);
    });
  });

  describe('Lead share links (PAC-37)', () => {
    interface ShareLinkBody {
      id: string;
      token: string;
      url: string;
      label: string | null;
      isActive: boolean;
      submissionCount: number;
      lastSubmissionAt: string | null;
      createdAt: string;
      revokedAt: string | null;
    }

    const mintAs = async (
      token: string,
      body: unknown = {},
      expected = 201,
    ) => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/leads/share-links')
        .set(authHeader(token))
        .send(body)
        .expect(expected);
      return res.body as ShareLinkBody;
    };

    it('mints a link with an opaque token and a public url', async () => {
      const link = await mintAs(producerToken, {
        label: 'Dave at First National',
      });

      expect(link.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(link.url).toContain(`/f/lead/${link.token}`);
      expect(link.label).toBe('Dave at First National');
      expect(link.isActive).toBe(true);
      expect(link.submissionCount).toBe(0);
    });

    it('never puts a producer id in the url', async () => {
      const producer = await app
        .get<Model<User>>(getModelToken(User.name))
        .findOne({ email: seed.producerEmail });
      const link = await mintAs(producerToken);

      expect(link.url).not.toContain(producer!._id.toString());
      expect(JSON.stringify(link)).not.toContain(producer!._id.toString());
    });

    // The AC is "a producer cannot generate a link on behalf of another
    // producer". There is no `producerId` input at all, so an injected one is
    // simply dropped — the property holds by construction rather than by check.
    it('ignores an injected producerId and mints for the caller', async () => {
      const userModel = app.get<Model<User>>(getModelToken(User.name));
      const producer = await userModel.findOne({ email: seed.producerEmail });
      const owner = await userModel.findOne({ email: seed.ownerEmail });

      const link = await mintAs(producerToken, {
        producerId: owner!._id.toString(),
      });

      const stored = await app
        .get<Model<ShareLink>>(getModelToken(ShareLink.name))
        .findById(link.id);
      expect(stored!.producerId.toString()).toBe(producer!._id.toString());
    });

    it('rejects a caller without leads:write (403)', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/leads/share-links')
        .set(authHeader(readOnlyToken))
        .send({})
        .expect(403);
    });

    it('lists only the callers own links', async () => {
      const mine = await mintAs(producerToken, { label: 'mine' });
      await mintAs(ownerToken, { label: 'theirs' });

      const res = await request(app.getHttpServer())
        .get('/api/v1/leads/share-links')
        .set(authHeader(producerToken))
        .expect(200);

      const items = (res.body as { items: ShareLinkBody[] }).items;
      expect(items.some((row) => row.id === mine.id)).toBe(true);
      expect(items.every((row) => row.label !== 'theirs')).toBe(true);
    });

    it('revokes a link, and revoking again is idempotent', async () => {
      const link = await mintAs(producerToken);

      const revoked = await request(app.getHttpServer())
        .patch(`/api/v1/leads/share-links/${link.id}/revoke`)
        .set(authHeader(producerToken))
        .expect(200);
      const first = revoked.body as ShareLinkBody;
      expect(first.isActive).toBe(false);
      expect(first.revokedAt).not.toBeNull();

      const again = await request(app.getHttpServer())
        .patch(`/api/v1/leads/share-links/${link.id}/revoke`)
        .set(authHeader(producerToken))
        .expect(200);
      expect((again.body as ShareLinkBody).revokedAt).toBe(first.revokedAt);
    });

    it('cannot revoke another producers link (404)', async () => {
      const theirs = await mintAs(ownerToken);

      await request(app.getHttpServer())
        .patch(`/api/v1/leads/share-links/${theirs.id}/revoke`)
        .set(authHeader(producerToken))
        .expect(404);
    });
  });

  describe('Public lead intake (PAC-37)', () => {
    let leadModel: Model<Lead>;
    let shareLinkModel: Model<ShareLink>;
    let activeToken: string;
    let activeLinkId: string;

    const UNKNOWN_TOKEN = 'z'.repeat(43);

    const submission = (key: string) => ({
      primaryContact: {
        firstName: 'Robin',
        lastName: key,
        dateOfBirth: '1985-03-21',
        phone: '(555) 777-8888',
        email: `robin.${key}@example.com`,
      },
      address: {
        street: `5 ${key} Street`,
        city: 'Tulsa',
        state: 'OK',
        zip: '74110',
      },
      members: [],
    });

    beforeAll(async () => {
      leadModel = app.get<Model<Lead>>(getModelToken(Lead.name));
      shareLinkModel = app.get<Model<ShareLink>>(getModelToken(ShareLink.name));

      const res = await request(app.getHttpServer())
        .post('/api/v1/leads/share-links')
        .set(authHeader(producerToken))
        .send({ label: 'public intake tests' })
        .expect(201);
      const link = res.body as { id: string; token: string };
      activeToken = link.token;
      activeLinkId = link.id;
    });

    it('renders the form with NO authentication at all', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/public/lead-form/${activeToken}`)
        .expect(200);

      // Deep key equality, not a spot check: the AC is that nothing leaks, so
      // the assertion has to fail the moment a new field appears.
      expect(Object.keys(res.body as object).sort()).toEqual([
        'agencyName',
        'isActive',
      ]);
      expect((res.body as { agencyName: string }).agencyName).toBe(
        'Test Agency',
      );
    });

    it('is indistinguishable between an unknown and a revoked token', async () => {
      const revokedRes = await request(app.getHttpServer())
        .post('/api/v1/leads/share-links')
        .set(authHeader(producerToken))
        .send({})
        .expect(201);
      const revoked = revokedRes.body as { id: string; token: string };
      await request(app.getHttpServer())
        .patch(`/api/v1/leads/share-links/${revoked.id}/revoke`)
        .set(authHeader(producerToken))
        .expect(200);

      const unknown = await request(app.getHttpServer())
        .get(`/api/v1/public/lead-form/${UNKNOWN_TOKEN}`)
        .expect(404);
      const revokedGet = await request(app.getHttpServer())
        .get(`/api/v1/public/lead-form/${revoked.token}`)
        .expect(404);
      const malformed = await request(app.getHttpServer())
        .get('/api/v1/public/lead-form/not-a-token')
        .expect(404);

      expect(revokedGet.body).toEqual(unknown.body);
      expect(malformed.body).toEqual(unknown.body);
      expect(JSON.stringify(unknown.body)).not.toContain('Test Agency');
    });

    it('creates a lead assigned to the links producer, with no lead source', async () => {
      const producer = await app
        .get<Model<User>>(getModelToken(User.name))
        .findOne({ email: seed.producerEmail });

      const res = await request(app.getHttpServer())
        .post(`/api/v1/public/leads/${activeToken}`)
        .send(submission('Nakamura'))
        .expect(201);

      // A plain confirmation — no lead id, no household id, no record details.
      expect(res.body).toEqual({ submitted: true });

      const lead = await leadModel.findOne({ lastName: 'Nakamura' });
      expect(lead).not.toBeNull();
      expect(lead!.producerId?.toString()).toBe(producer!._id.toString());
      expect(lead!.intakeSource?.channel).toBe('share_link');
      expect(lead!.intakeSource?.shareLinkId?.toString()).toBe(activeLinkId);
      // Left empty on purpose: nobody has said where this came from yet.
      expect(lead!.leadSource?.code ?? null).toBeNull();
      expect(lead!.leadSource?.label ?? '').toBe('');
    });

    it('surfaces a share-link lead under the no-source filter', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/public/leads/${activeToken}`)
        .send(submission('Okonjo'))
        .expect(201);

      const res = await request(app.getHttpServer())
        .get('/api/v1/leads?leadSource=__none__&search=Okonjo')
        .set(authHeader(producerToken))
        .expect(200);

      const items = (res.body as { items: { name: string }[] }).items;
      expect(items.some((row) => row.name.includes('Okonjo'))).toBe(true);
    });

    it('ignores tenancy and source fields injected into the body', async () => {
      const owner = await app
        .get<Model<User>>(getModelToken(User.name))
        .findOne({ email: seed.ownerEmail });
      const producer = await app
        .get<Model<User>>(getModelToken(User.name))
        .findOne({ email: seed.producerEmail });

      await request(app.getHttpServer())
        .post(`/api/v1/public/leads/${activeToken}`)
        .send({
          ...submission('Pemberton'),
          agencyId: 'attacker-agency',
          branchId: 'attacker-branch',
          producerId: owner!._id.toString(),
          leadSourceCode: 'WCO7l',
          isTestRecord: true,
        })
        .expect(201);

      const lead = await leadModel.findOne({ lastName: 'Pemberton' });
      expect(lead!.agencyId).toBe(seed.agencyId);
      expect(lead!.producerId?.toString()).toBe(producer!._id.toString());
      expect(lead!.leadSource?.label ?? '').toBe('');
      expect(lead!.isTestRecord).toBe(false);
    });

    it('counts new submissions once, and not on a replay', async () => {
      const before = await shareLinkModel.findById(activeLinkId);
      const body = {
        ...submission('Quintero'),
        submissionToken: 'public-replay-token-01',
      };

      await request(app.getHttpServer())
        .post(`/api/v1/public/leads/${activeToken}`)
        .send(body)
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/public/leads/${activeToken}`)
        .send(body)
        .expect(201);

      const after = await shareLinkModel.findById(activeLinkId);
      expect(after!.submissionCount).toBe(before!.submissionCount + 1);
      expect(await leadModel.countDocuments({ lastName: 'Quintero' })).toBe(1);
    });

    it('refuses submissions to a revoked token and writes nothing', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/leads/share-links')
        .set(authHeader(producerToken))
        .send({})
        .expect(201);
      const link = res.body as { id: string; token: string };
      await request(app.getHttpServer())
        .patch(`/api/v1/leads/share-links/${link.id}/revoke`)
        .set(authHeader(producerToken))
        .expect(200);

      await request(app.getHttpServer())
        .post(`/api/v1/public/leads/${link.token}`)
        .send(submission('Rasmussen'))
        .expect(404);

      expect(await leadModel.countDocuments({ lastName: 'Rasmussen' })).toBe(0);
    });

    it('rejects an invalid submission body (400)', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/public/leads/${activeToken}`)
        .send({
          ...submission('Invalid'),
          primaryContact: { firstName: 'Only' },
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
        .send({
          token: (invite.body as { inviteToken: string }).inviteToken,
          password: 'LivePass123!',
        })
        .expect(201);

      const session = accepted.body as {
        accessToken: string;
        user: { id: string };
      };
      liveToken = session.accessToken;
      liveUserId = session.user.id;
    });

    it('signed access token does not embed the permissions array', () => {
      const [, payload] = liveToken.split('.');
      const claims = JSON.parse(
        Buffer.from(payload, 'base64').toString('utf8'),
      ) as Record<string, unknown>;
      expect(claims.sub).toBeDefined();
      expect(claims.permissions).toBeUndefined();
      expect(claims.dataScope).toBeUndefined();
    });

    // `quote-recaps` is a real module now (PAC-39), so these probes hit real
    // endpoints. Guards run *before* validation pipes in Nest, so an empty body
    // / unknown lead cleanly separates the two outcomes we care about:
    //   permission granted  -> 400 (write) / 404 (read)  — the guard let it through
    //   permission revoked  -> 403                        — the guard stopped it
    // That keeps this block about authorization and creates no data.
    const MISSING_LEAD_ID = '0'.repeat(24);

    it('baseline: producer token can write quote recaps', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/quote-recaps')
        .set(authHeader(liveToken))
        .send({})
        .expect(400);
    });

    it('owner downgrading the user takes effect on the next request (same token)', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/users/${liveUserId}/permissions`)
        .set(authHeader(ownerToken))
        .send({
          overrides: [{ moduleKey: ModuleKey.QuoteRecaps, level: 'read' }],
        })
        .expect(200);

      // Same token as before — write is now revoked, read still works.
      await request(app.getHttpServer())
        .post('/api/v1/quote-recaps')
        .set(authHeader(liveToken))
        .send({})
        .expect(403);

      await request(app.getHttpServer())
        .get(`/api/v1/quote-recaps/context?leadId=${MISSING_LEAD_ID}`)
        .set(authHeader(liveToken))
        .expect(404);
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
        .get(`/api/v1/quote-recaps/context?leadId=${MISSING_LEAD_ID}`)
        .set(authHeader(liveToken))
        .expect(401);
    });
  });
});
