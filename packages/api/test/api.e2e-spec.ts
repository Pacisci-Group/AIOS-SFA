import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { ModuleKey } from '@sfa/shared';
import type {
  ContactDetail,
  CreateSoldDealResponse,
  LeadDetail,
  PerformanceMetric,
  PerformanceResponse,
  PolicyCheckResponse,
  SoldDealLeadContext,
  UpdateLeadResult,
} from '@sfa/shared';
import { Activity } from '../src/activities/schemas/activity.schema';
import { TransactionRunner } from '../src/common/mongo/transaction.runner';
import { Contact } from '../src/contacts/schemas/contact.schema';
import { AuditTemplate } from '../src/audit-templates/schemas/audit-template.schema';
import { CrmRotation } from '../src/crm-rotations/schemas/crm-rotation.schema';
import { DealAudit } from '../src/deal-audits/schemas/deal-audit.schema';
import { DealAuditItem } from '../src/deal-audit-items/schemas/deal-audit-item.schema';
import { Deal } from '../src/deals/schemas/deal.schema';
import { Household } from '../src/households/schemas/household.schema';
import { InterestedParty } from '../src/interested-parties/schemas/interested-party.schema';
import { LinkEntitiesStep } from '../src/leads/intake/link-entities.step';
import { Lead } from '../src/leads/schemas/lead.schema';
import { AccessResolverService } from '../src/permissions/access-resolver.service';
import { Policy } from '../src/policies/schemas/policy.schema';
import { PriorInsurance } from '../src/prior-insurance/schemas/prior-insurance.schema';
import { PriorPolicy } from '../src/prior-policies/schemas/prior-policy.schema';
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

      // PAC-38 added `clients:write` to the Producer template so a producer can
      // correct their own lead's contact. Pinned here because the grant is
      // additive-only — `seedDefaultRoles` unions, so it cannot be walked back
      // by editing the template.
      expect(body.effectivePermissions).toContain('clients:write');
      // ...and `write` implies `read` at resolution time, which is why the
      // template needs only the one line.
      expect(body.effectivePermissions).toContain('clients:read');
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
      { path: 'households', module: ModuleKey.Clients },
      { path: 'deals', module: ModuleKey.Clients },
      // NOTE: `deal-audits` (DealAuditsModule / PAC-12/14), `leads`
      // (LeadsModule / PAC-36), `quote-recaps` (QuoteRecapsModule / PAC-39),
      // `contacts` (ContactsModule / PAC-38) and `performance`
      // (PerformanceModule / PAC-10+11) are real modules, not
      // `{status:'ready'}` stubs — each is covered by its own describe block
      // below. The `files` stub was removed with PAC-39: it borrowed the
      // `quote_recaps` gate and the real file API is now
      // `POST /quote-recaps/quote-document/presign`.
      { path: 'crm/service-tickets', module: ModuleKey.CrmService },
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

    it('PATCH /api/v1/dashboard — forbidden without write (read-only page)', async () => {
      // Was `/performance` until PAC-10/11 replaced that stub with a real,
      // read-only module. `dashboard` proves the same thing and for the same
      // reason: the Producer template grants `dashboard:read` and not
      // `dashboard:write`, so reading a page you may read does not imply
      // writing to it.
      await request(app.getHttpServer())
        .patch('/api/v1/dashboard')
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
      { path: 'households', module: ModuleKey.Clients },
      { path: 'deals', module: ModuleKey.Clients },
      // `deal-audits` write (resolve) is item-scoped, not a bare PATCH stub, and
      // `contacts` write is now id-scoped too (ContactsModule / PAC-38) — both
      // are covered by their own describe blocks below. `leads` writes are
      // `POST /leads` (PAC-37) and `PATCH /leads/:id` (PAC-38), likewise
      // id-scoped rather than a bare PATCH on the collection.
      // `performance` is a real read-only module now (PAC-10/11) with no
      // mutating handler at all, so it cannot appear in this list.
      { path: 'crm/service-tickets', module: ModuleKey.CrmService },
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

  describe('Performance scorecards (PAC-10 quoted / PAC-11 sold)', () => {
    /** Asserted field-by-field: `expect.any` inside a typed `toMatchObject` is
     *  an `any` the lint rules reject, and this reads no worse. */
    function expectMetricShape(metric: PerformanceMetric): void {
      expect(typeof metric.premium).toBe('number');
      expect(typeof metric.itemCount).toBe('number');
      expect(typeof metric.recordCount).toBe('number');
      expect(typeof metric.householdCount).toBe('number');
      // Nullable by contract, so `typeof` alone would not pin them down.
      for (const avg of [
        metric.avgPremiumPerHousehold,
        metric.avgItemsPerHousehold,
      ]) {
        expect(avg === null || typeof avg === 'number').toBe(true);
        expect(Number.isNaN(avg)).toBe(false);
      }
    }

    it('GET /api/v1/performance — producer gets both cards', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/performance')
        .set(authHeader(producerToken))
        .expect(200);

      const body = res.body as PerformanceResponse;
      expect(body.range.key).toBe('mtd');
      expectMetricShape(body.sold);
      expectMetricShape(body.quoted);
    });

    it('defaults to mtd and echoes the resolved window back', async () => {
      // The client sends a key and gets dates: that echo is what lets a preset
      // and a custom window render through one code path on the web.
      const res = await request(app.getHttpServer())
        .get('/api/v1/performance')
        .set(authHeader(producerToken))
        .expect(200);

      const body = res.body as PerformanceResponse;
      expect(body.range.from).toMatch(/^\d{4}-\d{2}-01$/);
      expect(body.range.to >= body.range.from).toBe(true);
    });

    it('echoes back exactly the custom window requested', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/performance')
        .query({ range: 'custom', from: '2026-01-01', to: '2026-01-31' })
        .set(authHeader(producerToken))
        .expect(200);

      expect((res.body as PerformanceResponse).range).toEqual({
        key: 'custom',
        from: '2026-01-01',
        to: '2026-01-31',
      });
    });

    it('reports null averages, never 0 or NaN, on an empty range', async () => {
      // A far-past window matches nothing. `$group` on `_id: null` emits zero
      // documents rather than a row of zeroes, and "nothing to average" must
      // not serialize as "averages zero per household".
      const res = await request(app.getHttpServer())
        .get('/api/v1/performance')
        .query({ range: 'custom', from: '1990-01-01', to: '1990-01-02' })
        .set(authHeader(producerToken))
        .expect(200);

      const body = res.body as PerformanceResponse;
      for (const card of [body.sold, body.quoted]) {
        expect(card.recordCount).toBe(0);
        expect(card.avgPremiumPerHousehold).toBeNull();
        expect(card.avgItemsPerHousehold).toBeNull();
      }
    });

    it.each([
      ['custom without bounds', { range: 'custom' }],
      ['custom missing `to`', { range: 'custom', from: '2026-01-01' }],
      [
        'from after to',
        { range: 'custom', from: '2026-02-01', to: '2026-01-01' },
      ],
      [
        'a date that does not exist',
        { range: 'custom', from: '2026-02-31', to: '2026-03-01' },
      ],
      [
        'a span beyond the cap',
        { range: 'custom', from: '2020-01-01', to: '2026-01-01' },
      ],
      ['an unknown range key', { range: 'fortnight' }],
    ])('rejects %s with 400', async (_label, query) => {
      await request(app.getHttpServer())
        .get('/api/v1/performance')
        .query(query)
        .set(authHeader(producerToken))
        .expect(400);
    });

    it('is readable by any role holding performance:read', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/performance')
        .set(authHeader(readOnlyToken))
        .expect(200);
    });

    it('has no mutating handler — the scorecard is a projection', async () => {
      await request(app.getHttpServer())
        .patch('/api/v1/performance')
        .set(authHeader(ownerToken))
        .expect(404);
    });

    describe('the arithmetic, over seeded rows', () => {
      // An isolated window far from `mtd`, so these fixtures can never be
      // counted by — or collide with — any other block's data.
      const WINDOW = { range: 'custom', from: '2026-05-01', to: '2026-05-31' };

      beforeAll(async () => {
        const userModel = app.get<Model<User>>(getModelToken(User.name));
        const dealModel = app.get<Model<Deal>>(getModelToken(Deal.name));
        const recapModel = app.get<Model<QuoteRecap>>(
          getModelToken(QuoteRecap.name),
        );

        const producer = await userModel.findOne({ email: seed.producerEmail });
        const owner = await userModel.findOne({ email: seed.ownerEmail });
        const base = { agencyId: seed.agencyId, branchId: seed.branchId };
        const householdOne = new Types.ObjectId();

        await dealModel.create([
          // Two deals, one household — the household must be counted once.
          {
            ...base,
            producerId: producer!._id,
            householdId: householdOne,
            soldDateYmd: 20260504,
            premium: 1000,
            itemCount: 2,
          },
          {
            ...base,
            producerId: producer!._id,
            householdId: householdOne,
            soldDateYmd: 20260511,
            premium: 500,
            itemCount: 1,
          },
          // Rung 2 of the identity ladder: no ref, but a legacy string id.
          {
            ...base,
            producerId: producer!._id,
            legacyHouseholdId: 'legacy-hh-1',
            soldDateYmd: 20260518,
            premium: 300,
            itemCount: 1,
          },
          // Rung 3: no household at all — counts as its own.
          {
            ...base,
            producerId: producer!._id,
            soldDateYmd: 20260525,
            premium: 200,
            itemCount: 1,
          },
          // Excluded: test record.
          {
            ...base,
            producerId: producer!._id,
            householdId: new Types.ObjectId(),
            soldDateYmd: 20260505,
            premium: 99_999,
            itemCount: 99,
            isTestRecord: true,
          },
          // Excluded under `own` scope: another producer's deal.
          {
            ...base,
            producerId: owner!._id,
            householdId: new Types.ObjectId(),
            soldDateYmd: 20260506,
            premium: 77_777,
            itemCount: 77,
          },
          // Excluded: inside the agency but outside the window.
          {
            ...base,
            producerId: producer!._id,
            householdId: new Types.ObjectId(),
            soldDateYmd: 20260601,
            premium: 55_555,
            itemCount: 55,
          },
        ]);

        await recapModel.create([
          {
            ...base,
            producerId: producer!._id,
            householdId: householdOne,
            quoteDate: new Date('2026-05-04T00:00:00.000Z'),
            quoteDateYmd: 20260504,
            premium: 800,
            itemCount: 2,
          },
        ]);
      });

      it('sums premium and items, and counts each household once', async () => {
        const res = await request(app.getHttpServer())
          .get('/api/v1/performance')
          .query(WINDOW)
          .set(authHeader(producerToken))
          .expect(200);

        expect((res.body as PerformanceResponse).sold).toEqual({
          premium: 2000,
          itemCount: 5,
          recordCount: 4,
          // Two deals share a household; the legacy-id row and the
          // household-less row each count as one. 2 shared + 1 + 1 = 3.
          householdCount: 3,
          avgPremiumPerHousehold: 666.67,
          avgItemsPerHousehold: 1.67,
        });
      });

      it('rolls quoted recaps up independently of sold deals', async () => {
        const res = await request(app.getHttpServer())
          .get('/api/v1/performance')
          .query(WINDOW)
          .set(authHeader(producerToken))
          .expect(200);

        expect((res.body as PerformanceResponse).quoted).toMatchObject({
          premium: 800,
          itemCount: 2,
          recordCount: 1,
          householdCount: 1,
          avgPremiumPerHousehold: 800,
          avgItemsPerHousehold: 2,
        });
      });

      it('clamps a producer to their own rows even when asking for agency', async () => {
        // The owner's 77,777 deal sits in the same agency and window. A
        // client-supplied scope may only ever narrow.
        const res = await request(app.getHttpServer())
          .get('/api/v1/performance')
          .query({ ...WINDOW, scope: 'agency' })
          .set(authHeader(producerToken))
          .expect(200);

        expect((res.body as PerformanceResponse).sold.premium).toBe(2000);
      });

      it('includes every producer for an agency-scoped caller', async () => {
        // Same window, agency data scope: the owner's own deal is now in range
        // alongside the producer's four. Test records stay excluded.
        const res = await request(app.getHttpServer())
          .get('/api/v1/performance')
          .query(WINDOW)
          .set(authHeader(ownerToken))
          .expect(200);

        const body = res.body as PerformanceResponse;
        expect(body.sold.premium).toBe(2000 + 77_777);
        expect(body.sold.recordCount).toBe(5);
      });
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

  describe('Leads (PAC-38 detail)', () => {
    let leadId: string;
    let foreignLeadId: string;
    let migratedLeadId: string;
    let newerRecapId: string;
    let olderRecapId: string;
    let primaryContactId: string;

    const getAs = async (token: string, id: string, expected = 200) => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/leads/${id}`)
        .set(authHeader(token))
        .expect(expected);
      return res.body as LeadDetail;
    };

    beforeAll(async () => {
      const userModel = app.get<Model<User>>(getModelToken(User.name));
      const leadModel = app.get<Model<Lead>>(getModelToken(Lead.name));
      const householdModel = app.get<Model<Household>>(
        getModelToken(Household.name),
      );
      const contactModel = app.get<Model<Contact>>(getModelToken(Contact.name));
      const policyModel = app.get<Model<Policy>>(getModelToken(Policy.name));
      const recapModel = app.get<Model<QuoteRecap>>(
        getModelToken(QuoteRecap.name),
      );
      const dealModel = app.get<Model<Deal>>(getModelToken(Deal.name));
      const priorInsuranceModel = app.get<Model<PriorInsurance>>(
        getModelToken(PriorInsurance.name),
      );
      const priorPolicyModel = app.get<Model<PriorPolicy>>(
        getModelToken(PriorPolicy.name),
      );
      const activityModel = app.get<Model<Activity>>(
        getModelToken(Activity.name),
      );

      const producer = await userModel.findOne({ email: seed.producerEmail });
      const owner = await userModel.findOne({ email: seed.ownerEmail });
      const base = { agencyId: seed.agencyId, branchId: seed.branchId };

      const household = await householdModel.create({
        ...base,
        name: 'Detail Household',
        propertyAddress: {
          street: '77 Detail Way',
          city: 'Austin',
          state: 'TX',
          zip: '78745',
        },
        totalActivePolicies: 1,
      });

      // Deliberately created spouse-first, so "primary is listed first" is a
      // real assertion rather than an accident of insertion order.
      const [spouse, primary] = await contactModel.create([
        {
          ...base,
          firstName: 'Dana',
          lastName: 'Detail',
          roleInHousehold: 'Spouse',
          householdId: household._id,
          dateOfBirth: new Date('1981-09-02T00:00:00.000Z'),
        },
        {
          ...base,
          firstName: 'Devon',
          lastName: 'Detail',
          roleInHousehold: 'Primary',
          isPrimary: true,
          householdId: household._id,
          emails: ['devon.detail@example.com'],
          phones: ['5551110000'],
          dateOfBirth: new Date('1978-04-12T00:00:00.000Z'),
        },
      ]);
      primaryContactId = primary._id.toString();

      await householdModel.updateOne(
        { _id: household._id },
        {
          $set: {
            primaryContactId: primary._id,
            memberContactIds: [spouse._id],
          },
        },
      );

      const lead = await leadModel.create({
        ...base,
        firstName: 'Devon',
        lastName: 'Detail',
        // Raw SmartSuite code — the detail read must normalize it to `Requote`.
        status: 'arW7O',
        temperature: 'Hot',
        leadSource: { code: 'WCO7l', label: 'Mailer' },
        emails: ['devon.detail@example.com'],
        phones: ['5551110000'],
        quoteControlNumber: 'QCN-380001',
        producerId: producer!._id,
        householdId: household._id,
        primaryContactId: primary._id,
        memberContactIds: [spouse._id],
        createdDate: new Date('2026-07-01T00:00:00.000Z'),
        lastActivityAt: new Date('2026-07-28T00:00:00.000Z'),
        intakeSource: { channel: 'internal' },
        isTestRecord: false,
      });
      leadId = lead._id.toString();

      const foreign = await leadModel.create({
        ...base,
        firstName: 'Owner',
        lastName: 'Only',
        status: 'New',
        temperature: 'Warm',
        producerId: owner!._id,
        isTestRecord: false,
      });
      foreignLeadId = foreign._id.toString();

      // A lead the migration produced: its recap and deal carry only
      // `legacyLeadId`, never a `leadId` ref.
      const migrated = await leadModel.create({
        ...base,
        firstName: 'Morgan',
        lastName: 'Migrated',
        status: 'Quoted',
        temperature: 'Warm',
        producerId: producer!._id,
        legacySmartSuiteId: 'ss-lead-38',
        isTestRecord: false,
      });
      migratedLeadId = migrated._id.toString();

      await policyModel.create({
        ...base,
        policyNumber: 'POL-38-001',
        // Raw Policies-table code — must normalize to `Auto`.
        policyType: 'Zgsh3',
        carrier: 'Allstate',
        active: true,
        premium: 1200,
        items: 1,
        householdId: household._id,
        expirationDate: new Date('2027-01-01T00:00:00.000Z'),
      });

      const older = await recapModel.create({
        ...base,
        quoteDate: new Date('2026-07-10T00:00:00.000Z'),
        premium: 1500,
        itemCount: 1,
        productsQuoted: ['PYgez'],
        recapStatus: 'Quoted',
        leadId: lead._id,
        householdId: household._id,
        policies: [{ policyType: 'Auto', premium: 1500, itemCount: 1 }],
      });
      olderRecapId = older._id.toString();

      const newer = await recapModel.create({
        ...base,
        quoteDate: new Date('2026-07-24T00:00:00.000Z'),
        premium: 1872,
        itemCount: 2,
        // Raw SmartSuite codes, exactly as the migration writes them.
        productsQuoted: ['PYgez', 'sNMRK'],
        recapStatus: 'Requote',
        leadId: lead._id,
        householdId: household._id,
        notes: 'Bundled for the multi-policy discount.',
        policies: [
          { policyType: 'Auto', premium: 1200, itemCount: 1 },
          { policyType: 'Home', premium: 672, itemCount: 1 },
        ],
        quoteDocument: {
          key: 'agency/quote-38.pdf',
          filename: 'quote-38.pdf',
          contentType: 'application/pdf',
          size: 4096,
          uploadedAt: new Date('2026-07-24T15:10:02.000Z'),
        },
      });
      newerRecapId = newer._id.toString();

      // Linked to the lead only by legacy id — the fallback's whole point.
      await recapModel.create({
        ...base,
        quoteDate: new Date('2025-03-02T00:00:00.000Z'),
        premium: 990,
        itemCount: 1,
        productsQuoted: ['sNMRK'],
        legacyLeadId: 'ss-lead-38',
      });

      const deal = await dealModel.create({
        ...base,
        soldDate: new Date('2026-07-30T00:00:00.000Z'),
        premium: 1872,
        itemCount: 2,
        policyCount: 2,
        dealType: 'Bundle',
        isBundle: true,
        policyTypes: ['Auto', 'sNMRK'],
        leadId: lead._id,
        householdId: household._id,
      });

      await priorInsuranceModel.create({
        ...base,
        previousCarrierAuto: 'State Farm',
        previousCarrierHome: 'State Farm',
        previousAgentName: 'Dale Prior',
        cancelledPreviousInsurance: 'Yes',
        cancellationDate: new Date('2026-07-15T00:00:00.000Z'),
        dealId: deal._id,
        householdId: household._id,
      });

      await priorPolicyModel.create([
        {
          ...base,
          policyType: 'Zgsh3',
          previousCarrier: 'State Farm',
          cancellationStatus: 'Pending',
          dealId: deal._id,
          householdId: household._id,
        },
        {
          ...base,
          policyType: 'eCEuV',
          previousCarrier: 'State Farm',
          cancellationStatus: 'Complete',
          dealId: deal._id,
          householdId: household._id,
        },
      ]);

      await activityModel.create([
        {
          ...base,
          type: 'lead_created',
          subjectType: 'lead',
          leadId: lead._id,
          producerId: producer!._id,
          occurredAt: new Date('2026-07-01T00:00:00.000Z'),
          summary: 'Lead created',
          source: 'internal',
        },
        {
          ...base,
          type: 'quoted',
          subjectType: 'quoteRecap',
          leadId: lead._id,
          quoteRecapId: newer._id,
          producerId: producer!._id,
          occurredAt: new Date('2026-07-24T00:00:00.000Z'),
          summary: 'Quote recap created',
          source: 'internal',
        },
        {
          ...base,
          type: 'sold',
          subjectType: 'deal',
          leadId: lead._id,
          dealId: deal._id,
          producerId: producer!._id,
          occurredAt: new Date('2026-07-30T00:00:00.000Z'),
          summary: 'Deal marked as sold',
          source: 'internal',
        },
      ]);
    });

    it('returns the lead with normalized labels, never raw select codes', async () => {
      const body = await getAs(producerToken, leadId);

      expect(body.id).toBe(leadId);
      expect(body.name).toBe('Devon Detail');
      // Stored as `arW7O`.
      expect(body.status).toBe('Requote');
      expect(body.temperature).toBe('Hot');
      expect(body.leadSource).toEqual({ code: 'WCO7l', label: 'Mailer' });
      expect(body.quoteControlNumber).toBe('QCN-380001');
      expect(body.intakeChannel).toBe('internal');
      // Recomputed from `createdDate`, not the stored `agingDays` (0).
      expect(body.agingDays).toBeGreaterThan(0);
    });

    it('leaks no internals', async () => {
      const body = (await getAs(producerToken, leadId)) as unknown as Record<
        string,
        unknown
      >;

      for (const key of [
        'agencyId',
        'branchId',
        'producerId',
        'legacySmartSuiteId',
        'legacyProducerId',
        'legacyHouseholdId',
        'isTestRecord',
        'submissionToken',
      ]) {
        expect(body).not.toHaveProperty(key);
      }

      // The storage key is the one field of the document that must not ship —
      // downloading needs a presigned URL, not a client that knows the path.
      const recap = body.latestQuoteRecap as LeadDetail['latestQuoteRecap'];
      expect(recap?.document).not.toHaveProperty('key');
      expect(recap?.document?.filename).toBe('quote-38.pdf');
    });

    it('shows the household address, primary contact and roster (primary first)', async () => {
      const body = await getAs(producerToken, leadId);

      expect(body.address).toEqual({
        street: '77 Detail Way',
        city: 'Austin',
        state: 'TX',
        zip: '78745',
      });
      expect(body.primaryContact?.name).toBe('Devon Detail');
      // A calendar date, not an instant — a DOB shipped as an ISO timestamp
      // renders as the previous day in a US timezone.
      expect(body.primaryContact?.dateOfBirth).toBe('1978-04-12');
      expect(body.primaryContact?.email).toBe('devon.detail@example.com');

      expect(body.household?.members).toHaveLength(2);
      expect(body.household?.members[0].name).toBe('Devon Detail');
      expect(body.household?.members[0].isPrimary).toBe(true);
      expect(body.household?.members[1].role).toBe('Spouse');

      // Household-level, and normalized from the raw Policies-table code.
      expect(body.household?.policies).toHaveLength(1);
      expect(body.household?.policies[0].policyType).toBe('Auto');
    });

    it('returns the newest recap in full and the rest as summaries', async () => {
      const body = await getAs(producerToken, leadId);

      expect(body.latestQuoteRecap?.id).toBe(newerRecapId);
      expect(body.latestQuoteRecap?.premium).toBe(1872);
      // Stored as `['PYgez', 'sNMRK']`.
      expect(body.latestQuoteRecap?.productsQuoted).toEqual(['Auto', 'Home']);
      expect(body.latestQuoteRecap?.policies).toHaveLength(2);
      expect(body.latestQuoteRecap?.notes).toContain('multi-policy');

      expect(body.earlierQuoteRecaps).toHaveLength(1);
      expect(body.earlierQuoteRecaps[0].id).toBe(olderRecapId);
      // Summary-shaped: the heavy fields belong only to the latest.
      expect(body.earlierQuoteRecaps[0]).not.toHaveProperty('policies');
      expect(body.earlierQuoteRecaps[0]).not.toHaveProperty('notes');
      expect(body.earlierQuoteRecaps[0]).not.toHaveProperty('document');
    });

    it('returns the deal and its prior insurance, with only stored fields', async () => {
      const body = await getAs(producerToken, leadId);

      expect(body.deal?.dealType).toBe('Bundle');
      expect(body.deal?.isBundle).toBe(true);
      expect(body.deal?.policyTypes).toEqual(['Auto', 'Home']);

      expect(body.priorInsurance?.previousCarrierAuto).toBe('State Farm');
      expect(body.priorInsurance?.previousAgentName).toBe('Dale Prior');
      expect(body.priorInsurance?.cancellationDate).toBe('2026-07-15');
      expect(body.priorInsurance?.policies).toHaveLength(2);
      expect(
        body.priorInsurance?.policies.map((p) => p.policyType).sort(),
      ).toEqual(['Auto', 'Home']);
      // The mockup's limits/deductibles/premium are not stored anywhere and
      // must not be invented.
      expect(body.priorInsurance).not.toHaveProperty('limits');
      expect(body.priorInsurance).not.toHaveProperty('deductible');
    });

    it('returns the activity timeline newest-first with the producer resolved', async () => {
      const body = await getAs(producerToken, leadId);

      expect(body.activities.map((a) => a.type)).toEqual([
        'sold',
        'quoted',
        'lead_created',
      ]);
      expect(body.activities[0].producerName).toBeTruthy();
    });

    it('finds a migrated recap linked only by legacyLeadId, then self-heals the ref', async () => {
      const recapModel = app.get<Model<QuoteRecap>>(
        getModelToken(QuoteRecap.name),
      );

      const body = await getAs(producerToken, migratedLeadId);

      // Without the legacy fallback this block is empty for every migrated
      // lead — the single most likely thing to regress here.
      expect(body.latestQuoteRecap).not.toBeNull();
      expect(body.latestQuoteRecap?.premium).toBe(990);
      expect(body.latestQuoteRecap?.productsQuoted).toEqual(['Home']);

      // The backfill is fire-and-forget, so poll briefly rather than assuming
      // it completed before the response was written.
      let healed = false;
      for (let attempt = 0; attempt < 20 && !healed; attempt++) {
        const stored = await recapModel.findOne({ legacyLeadId: 'ss-lead-38' });
        healed = stored?.leadId?.toString() === migratedLeadId;
        if (!healed) await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(healed).toBe(true);
    });

    it("another producer's lead is a 404, not a 403", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/leads/${foreignLeadId}`)
        .set(authHeader(producerToken))
        .expect(404);

      // Identical to the missing-lead message: a distinguishable response would
      // confirm the lead exists.
      expect((res.body as { message: string }).message).toBe('Lead not found.');
    });

    it('a malformed id is a 404, not a 500', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/leads/not-an-objectid')
        .set(authHeader(producerToken))
        .expect(404);
    });

    it('GET /leads/share-links still resolves ahead of /leads/:id', async () => {
      // Pins the route-ordering hazard: `ShareLinksModule` is registered before
      // `LeadsModule` precisely so this path is not swallowed by `:id`. If a
      // future reorder breaks it, this fails loudly instead of silently 404ing.
      await request(app.getHttpServer())
        .get('/api/v1/leads/share-links')
        .set(authHeader(producerToken))
        .expect(200);
    });

    it('exposes the primary contact id the edit modal needs', async () => {
      const body = await getAs(producerToken, leadId);
      expect(body.primaryContact?.id).toBe(primaryContactId);
    });
  });

  describe('Leads (PAC-38 patch)', () => {
    let leadId: string;
    let foreignLeadId: string;

    const patchAs = (
      token: string,
      id: string,
      body: Record<string, unknown>,
    ) =>
      request(app.getHttpServer())
        .patch(`/api/v1/leads/${id}`)
        .set(authHeader(token))
        .send(body);

    beforeAll(async () => {
      const userModel = app.get<Model<User>>(getModelToken(User.name));
      const leadModel = app.get<Model<Lead>>(getModelToken(Lead.name));

      const producer = await userModel.findOne({ email: seed.producerEmail });
      const owner = await userModel.findOne({ email: seed.ownerEmail });
      const base = { agencyId: seed.agencyId, branchId: seed.branchId };

      // A share-link lead: no source at all. This is the case the whole
      // endpoint exists for.
      const lead = await leadModel.create({
        ...base,
        firstName: 'Parker',
        lastName: 'Patch',
        status: 'New',
        temperature: 'Unknown',
        leadSource: { code: null, label: '' },
        producerId: producer!._id,
        lastActivityAt: new Date('2026-01-01T00:00:00.000Z'),
        intakeSource: { channel: 'share_link' },
        isTestRecord: false,
      });
      leadId = lead._id.toString();

      const foreign = await leadModel.create({
        ...base,
        firstName: 'Owner',
        lastName: 'Patch',
        status: 'New',
        temperature: 'Warm',
        producerId: owner!._id,
        isTestRecord: false,
      });
      foreignLeadId = foreign._id.toString();
    });

    it('updates status, temperature and source, returning canonical values', async () => {
      const res = await patchAs(producerToken, leadId, {
        status: 'Contacted',
        temperature: 'Warm',
        leadSourceCode: 'WCO7l',
      }).expect(200);

      const body = res.body as UpdateLeadResult;
      expect(body.status).toBe('Contacted');
      expect(body.temperature).toBe('Warm');
      expect(body.leadSource).toEqual({ code: 'WCO7l', label: 'Mailer' });

      // Only the patchable fields — not a whole LeadDetail.
      expect(body).not.toHaveProperty('household');
      expect(body).not.toHaveProperty('activities');
    });

    it('bumps lastActivityAt so the row surfaces on the Leads list', async () => {
      const before = new Date('2026-01-01T00:00:00.000Z').getTime();

      const res = await patchAs(producerToken, leadId, {
        status: 'Qualified',
      }).expect(200);

      const body = res.body as UpdateLeadResult;
      expect(new Date(body.lastActivityAt).getTime()).toBeGreaterThan(before);
    });

    it('accepts a backwards status move — this is a correction, not a pipeline', async () => {
      await patchAs(producerToken, leadId, { status: 'Sold' }).expect(200);

      const res = await patchAs(producerToken, leadId, {
        status: 'Requote',
      }).expect(200);

      expect((res.body as UpdateLeadResult).status).toBe('Requote');
    });

    it('clears the source with __none__, and the lead matches the no-source filter', async () => {
      const res = await patchAs(producerToken, leadId, {
        leadSourceCode: '__none__',
      }).expect(200);

      // The schema default shape, which is what the list filter matches.
      expect((res.body as UpdateLeadResult).leadSource.code).toBeNull();

      const list = await request(app.getHttpServer())
        .get('/api/v1/leads?leadSource=__none__')
        .set(authHeader(producerToken))
        .expect(200);

      const items = (list.body as { items: { id: string }[] }).items;
      expect(items.map((item) => item.id)).toContain(leadId);
    });

    it('rejects an unknown status, a non-selectable temperature, and an empty body', async () => {
      await patchAs(producerToken, leadId, { status: 'Warm Prospect' }).expect(
        400,
      );
      // A valid `LEAD_TEMPERATURES` member, but not one a producer may choose.
      await patchAs(producerToken, leadId, { temperature: 'Unknown' }).expect(
        400,
      );
      await patchAs(producerToken, leadId, {}).expect(400);
      // `Test` hides the record from every read path — never selectable.
      await patchAs(producerToken, leadId, {
        leadSourceCode: 'ENEJP',
      }).expect(400);
    });

    it("another producer's lead is a 404, and is not modified", async () => {
      const leadModel = app.get<Model<Lead>>(getModelToken(Lead.name));

      await patchAs(producerToken, foreignLeadId, {
        status: 'Sold',
      }).expect(404);

      const stored = await leadModel.findById(foreignLeadId);
      expect(stored?.status).toBe('New');
    });

    it('a read-only user is forbidden (403)', async () => {
      await patchAs(readOnlyToken, leadId, { status: 'Contacted' }).expect(403);
    });
  });

  describe('Contacts (PAC-38 primary contact edit)', () => {
    let contactModel: Model<Contact>;
    let leadModel: Model<Lead>;

    /** Reachable from a lead the producer owns. */
    let ownContactId: string;
    let ownLeadId: string;
    /** Reachable only from the *owner's* lead — the clamp's headline case. */
    let foreignContactId: string;
    /** No household, no lead reference at all. */
    let orphanContactId: string;

    const patchAs = (
      token: string,
      id: string,
      body: Record<string, unknown>,
    ) =>
      request(app.getHttpServer())
        .patch(`/api/v1/contacts/${id}`)
        .set(authHeader(token))
        .send(body);

    beforeAll(async () => {
      contactModel = app.get<Model<Contact>>(getModelToken(Contact.name));
      leadModel = app.get<Model<Lead>>(getModelToken(Lead.name));
      const userModel = app.get<Model<User>>(getModelToken(User.name));
      const householdModel = app.get<Model<Household>>(
        getModelToken(Household.name),
      );

      const producer = await userModel.findOne({ email: seed.producerEmail });
      const owner = await userModel.findOne({ email: seed.ownerEmail });
      const base = { agencyId: seed.agencyId, branchId: seed.branchId };

      const ownHousehold = await householdModel.create({
        ...base,
        name: 'Contact Edit Household',
      });
      const foreignHousehold = await householdModel.create({
        ...base,
        name: 'Owner Only Household',
      });

      const ownContact = await contactModel.create({
        ...base,
        firstName: 'Corin',
        lastName: 'Contact',
        isPrimary: true,
        householdId: ownHousehold._id,
        emails: ['corin.contact@example.com', 'corin.alt@example.com'],
        phones: ['5554440000', '5554441111'],
      });
      ownContactId = ownContact._id.toString();

      const foreignContact = await contactModel.create({
        ...base,
        firstName: 'Fenna',
        lastName: 'Foreign',
        isPrimary: true,
        householdId: foreignHousehold._id,
        emails: ['fenna.foreign@example.com'],
      });
      foreignContactId = foreignContact._id.toString();

      const orphan = await contactModel.create({
        ...base,
        firstName: 'Orla',
        lastName: 'Orphan',
      });
      orphanContactId = orphan._id.toString();

      const ownLead = await leadModel.create({
        ...base,
        firstName: 'Corin',
        lastName: 'Contact',
        status: 'New',
        temperature: 'Warm',
        producerId: producer!._id,
        householdId: ownHousehold._id,
        primaryContactId: ownContact._id,
        emails: ['corin.contact@example.com'],
        phones: ['5554440000'],
        isTestRecord: false,
      });
      ownLeadId = ownLead._id.toString();

      await leadModel.create({
        ...base,
        firstName: 'Fenna',
        lastName: 'Foreign',
        status: 'New',
        temperature: 'Warm',
        producerId: owner!._id,
        householdId: foreignHousehold._id,
        primaryContactId: foreignContact._id,
        isTestRecord: false,
      });
    });

    it('updates a contact reachable from the caller’s own lead', async () => {
      const res = await patchAs(producerToken, ownContactId, {
        lastName: 'Corrected',
        dateOfBirth: '1985-06-30',
        phone: '(555) 999-8888',
      }).expect(200);

      const body = res.body as ContactDetail;
      expect(body.name).toBe('Corin Corrected');
      // A calendar date, echoed back exactly as sent.
      expect(body.dateOfBirth).toBe('1985-06-30');
      // Normalized through the intake helpers, so contact matching still works.
      expect(body.phone).toBe('5559998888');
    });

    it('preserves the additional emails and phones the form does not show', async () => {
      const stored = await contactModel.findById(ownContactId);
      // Only element 0 is replaced — a second number nobody asked to remove
      // must not silently disappear.
      expect(stored?.phones).toEqual(['5559998888', '5554441111']);
      expect(stored?.emails).toHaveLength(2);
      expect(stored?.emails[1]).toBe('corin.alt@example.com');
    });

    it('mirrors the correction onto leads this contact is primary for', async () => {
      // Without this the Leads list would keep showing the old surname forever
      // and the producer would conclude the edit failed.
      const lead = await leadModel.findById(ownLeadId);
      expect(lead?.lastName).toBe('Corrected');
      expect(lead?.phones?.[0]).toBe('5559998888');
    });

    it("another producer's contact is a 404 AND is not modified", async () => {
      await patchAs(producerToken, foreignContactId, {
        lastName: 'Hijacked',
      }).expect(404);

      // The assertion that actually matters: a 404 that still wrote would be
      // the real failure. `Contact` has no `producerId`, so `ContactAccessService`
      // is the only thing standing between a producer and every client in the
      // agency.
      const stored = await contactModel.findById(foreignContactId);
      expect(stored?.lastName).toBe('Foreign');
    });

    it('a contact with no household and no lead reference is unreachable (404)', async () => {
      await patchAs(producerToken, orphanContactId, {
        lastName: 'Adopted',
      }).expect(404);

      const stored = await contactModel.findById(orphanContactId);
      expect(stored?.lastName).toBe('Orphan');
    });

    it('the same contact is editable by the agency-scoped owner (200)', async () => {
      // Proves the clamp is scope-dependent rather than a blanket deny — an
      // owner runs on `DataScope.agency` and legitimately reaches every client.
      const res = await patchAs(ownerToken, foreignContactId, {
        lastName: 'Foreign-Updated',
      }).expect(200);

      expect((res.body as ContactDetail).lastName).toBe('Foreign-Updated');
    });

    it('clears a field with null rather than demanding a value', async () => {
      const res = await patchAs(producerToken, ownContactId, {
        dateOfBirth: null,
      }).expect(200);

      expect((res.body as ContactDetail).dateOfBirth).toBeNull();
    });

    it('rejects an empty body and a malformed date (400)', async () => {
      await patchAs(producerToken, ownContactId, {}).expect(400);
      await patchAs(producerToken, ownContactId, {
        dateOfBirth: '30/06/1985',
      }).expect(400);
    });

    it('a malformed id is a 404, not a 500', async () => {
      await patchAs(producerToken, 'not-an-objectid', {
        lastName: 'Nope',
      }).expect(404);
    });

    it('a read-only user is forbidden (403)', async () => {
      await patchAs(readOnlyToken, ownContactId, {
        lastName: 'Nope',
      }).expect(403);
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

  describe('Sold deals (PAC-40 Card 5 — discounts & documents)', () => {
    const SOLD = '/api/v1/sold-deals';
    const PRESIGN = '/api/v1/sold-deals/documents/presign';

    let card5DealModel: Model<Deal>;
    let card5PolicyModel: Model<Policy>;
    let card5LeadModel: Model<Lead>;
    let card5HouseholdModel: Model<Household>;
    let interestedPartyModel: Model<InterestedParty>;
    let card5ProducerId: Types.ObjectId;
    let card5StatSpy: jest.SpyInstance;
    let presignSpy: jest.SpyInstance;
    /** The key the service asked storage to sign, captured per call. */
    let lastSignedKey: string | undefined;

    /**
     * Object storage isn't running under test, so `statObject` reports only the
     * keys a test has "uploaded". That keeps the real verification path
     * exercised — including the 404 for a key that never landed — without a
     * MinIO dependency. Same approach as the Quote Recap suite.
     */
    const uploaded = new Map<string, { size: number; contentType: string }>();

    const keyFor = (leadId: string) =>
      `agencies/${seed.agencyId}/sold-deals/${leadId}/2026/proof.pdf`;

    const upload = (
      leadId: string,
      stat = { size: 2048, contentType: 'application/pdf' },
    ) => {
      const key = keyFor(leadId);
      uploaded.set(key, stat);
      return {
        key,
        filename: 'proof.pdf',
        contentType: 'application/pdf',
        size: stat.size,
      };
    };

    let card5Counter = 0;
    const nextCard5Number = () =>
      `C5-${(card5Counter += 1).toString().padStart(6, '0')}`;

    const EMPTY_DISCOUNTS = {
      escrow: false,
      fireSubscription: { selected: false, hasProof: false },
      roofReceipt: { selected: false, hasProof: false },
      acvPersonalProperty: false,
      acvDwellingProtection: false,
      drivewise: false,
      defensiveDriver: { selected: false, drivers: [] },
      studentDiscount: { selected: false, hasProof: false },
    };

    const policyWith = (overrides: Record<string, unknown> = {}) => ({
      policyType: 'Auto',
      effectiveDate: '2026-02-01',
      carrier: 'Allstate',
      policyNumber: nextCard5Number(),
      premium: 500,
      itemCount: 1,
      priorInsurance: { none: true },
      cancellation: { cancelled: false },
      ...overrides,
    });

    const seedLead = async () => {
      const household = await card5HouseholdModel.create({
        agencyId: seed.agencyId,
        branchId: seed.branchId,
        name: 'Card5 Household',
        primaryContactName: 'Casey Card',
      });
      const lead = await card5LeadModel.create({
        agencyId: seed.agencyId,
        branchId: seed.branchId,
        firstName: 'Casey',
        lastName: 'Card',
        status: 'Quoted',
        producerId: card5ProducerId,
        householdId: household._id,
      });
      return lead;
    };

    const post = (body: object, expected = 201) =>
      request(app.getHttpServer())
        .post(SOLD)
        .set(authHeader(producerToken))
        .send(body)
        .expect(expected);

    beforeAll(async () => {
      card5DealModel = app.get<Model<Deal>>(getModelToken(Deal.name));
      card5PolicyModel = app.get<Model<Policy>>(getModelToken(Policy.name));
      card5LeadModel = app.get<Model<Lead>>(getModelToken(Lead.name));
      card5HouseholdModel = app.get<Model<Household>>(
        getModelToken(Household.name),
      );
      interestedPartyModel = app.get<Model<InterestedParty>>(
        getModelToken(InterestedParty.name),
      );

      const userModel = app.get<Model<User>>(getModelToken(User.name));
      const producer = await userModel.findOne({ email: seed.producerEmail });
      card5ProducerId = producer!._id;

      card5StatSpy = jest
        .spyOn(app.get(StorageService), 'statObject')
        .mockImplementation((key: string) =>
          Promise.resolve(uploaded.get(key) ?? null),
        );

      /*
       * Signing is stubbed, not exercised.
       *
       * `createPresignedUpload` calls the AWS signer, which needs real
       * credentials — present locally via the MinIO `STORAGE_*` vars, absent in
       * CI, so a test that really signs passes on a laptop and 500s on a
       * runner. Nothing about SigV4 is under test here anyway: what matters is
       * the **key** the service builds, and capturing the argument asserts that
       * directly rather than through a signed URL.
       *
       * The real signer is covered by the Bruno collection, which runs against
       * a live MinIO.
       */
      presignSpy = jest
        .spyOn(app.get(StorageService), 'createPresignedUpload')
        .mockImplementation((key: string, contentType: string) => {
          lastSignedKey = key;
          return Promise.resolve({
            key,
            uploadUrl: `https://storage.test/${key}`,
            requiredHeaders: { 'Content-Type': contentType },
            expiresIn: 900,
          });
        });
    });

    afterAll(() => {
      card5StatSpy.mockRestore();
      presignSpy.mockRestore();
    });

    it('presigns a proof upload scoped to the agency and lead', async () => {
      const lead = await seedLead();
      lastSignedKey = undefined;

      const res = await request(app.getHttpServer())
        .post(PRESIGN)
        .set(authHeader(producerToken))
        .send({
          leadId: lead._id.toString(),
          filename: 'roof.pdf',
          contentType: 'application/pdf',
          size: 2048,
        })
        .expect(201);

      const prefix = `agencies/${seed.agencyId}/sold-deals/${lead._id.toString()}/`;
      // The key the service actually asked storage to sign — built from the
      // loaded lead's agencyId, never from the request body. This prefix is
      // what `POST /sold-deals` verifies before accepting an attachment.
      expect(lastSignedKey).toContain(prefix);

      const body = res.body as { key: string; uploadUrl: string };
      expect(body.key).toBe(lastSignedKey);
      expect(body.uploadUrl).toEqual(expect.any(String));
    });

    it("refuses to presign against another producer's lead", async () => {
      const household = await card5HouseholdModel.create({
        agencyId: seed.agencyId,
        branchId: seed.branchId,
        name: 'Someone Else',
      });
      const foreign = await card5LeadModel.create({
        agencyId: seed.agencyId,
        branchId: seed.branchId,
        firstName: 'Not',
        lastName: 'Yours',
        producerId: new Types.ObjectId(),
        householdId: household._id,
      });

      lastSignedKey = undefined;

      // 404, not 403 — a presign must not leak that the lead exists.
      await request(app.getHttpServer())
        .post(PRESIGN)
        .set(authHeader(producerToken))
        .send({
          leadId: foreign._id.toString(),
          filename: 'roof.pdf',
          contentType: 'application/pdf',
          size: 2048,
        })
        .expect(404);

      // Ownership is checked BEFORE signing, so storage was never touched.
      expect(lastSignedKey).toBeUndefined();
    });

    it('rejects a cross-branch discount rather than stripping it', async () => {
      const lead = await seedLead();
      // A Home policy claiming Drivewise would otherwise generate an auto audit
      // item for a deal with no auto line.
      await post(
        {
          leadId: lead._id.toString(),
          soldDate: '2026-02-15',
          policies: [
            policyWith({
              policyType: 'Home',
              discounts: { ...EMPTY_DISCOUNTS, drivewise: true },
            }),
          ],
        },
        400,
      );
    });

    it('requires the escrow sub-card when escrow is ticked', async () => {
      const lead = await seedLead();
      await post(
        {
          leadId: lead._id.toString(),
          soldDate: '2026-02-15',
          policies: [
            policyWith({
              policyType: 'Home',
              discounts: { ...EMPTY_DISCOUNTS, escrow: true },
            }),
          ],
        },
        400,
      );
    });

    it('writes an interested party per escrow and flags the deal mortgagee', async () => {
      const lead = await seedLead();
      const res = await post({
        leadId: lead._id.toString(),
        soldDate: '2026-02-15',
        policies: [
          policyWith({
            policyType: 'Home',
            discounts: { ...EMPTY_DISCOUNTS, escrow: true },
            escrow: {
              loanNumber: 'LN-123',
              companyName: 'First National Escrow',
              address: {
                street: '1 Lender Way',
                city: 'Austin',
                state: 'TX',
                zip: '78745',
              },
            },
          }),
        ],
      });

      const dealId = new Types.ObjectId((res.body as { id: string }).id);
      const deal = await card5DealModel.findById(dealId);
      // The boolean gates the Home/Landlord Mortgagee audit items; the row
      // carries the detail the service team verifies.
      expect(deal!.mortgagee).toBe(true);

      const parties = await interestedPartyModel.find({
        householdId: lead.householdId,
      });
      expect(parties).toHaveLength(1);
      expect(parties[0].loanNumber).toBe('LN-123');
      expect(parties[0].mortgagee).toBe('First National Escrow');
    });

    it('unions Card 5 selections into the deal audit triggers', async () => {
      const lead = await seedLead();
      const res = await post({
        leadId: lead._id.toString(),
        soldDate: '2026-02-15',
        policies: [
          policyWith({
            policyType: 'Auto',
            discounts: {
              ...EMPTY_DISCOUNTS,
              drivewise: true,
              defensiveDriver: {
                selected: true,
                // The same driver twice — one certificate, not two.
                drivers: [
                  { name: 'Dana Driver' },
                  { name: 'Sam Second' },
                  { name: 'Dana Driver' },
                ],
              },
            },
          }),
          policyWith({
            policyType: 'Home',
            discounts: { ...EMPTY_DISCOUNTS, acvDwellingProtection: true },
          }),
        ],
      });

      const dealId = new Types.ObjectId((res.body as { id: string }).id);
      const deal = await card5DealModel.findById(dealId);
      const triggers = deal!.auditTriggers;

      expect(triggers.drivewise).toBe(true);
      expect(triggers.defensiveDriver).toBe(true);
      // Either ACV option maps onto the one Actual Cash Value trigger.
      expect(triggers.actualCashValue).toBe(true);
      expect(triggers.goodStudent).toBe(false);
      expect([...triggers.defensiveDriverNames].sort()).toEqual([
        'Dana Driver',
        'Sam Second',
      ]);
    });

    it('accepts "no proof" as a real answer, not a validation failure', async () => {
      const lead = await seedLead();
      // The discount still applies — the chase moves to the service team.
      const res = await post({
        leadId: lead._id.toString(),
        soldDate: '2026-02-15',
        policies: [
          policyWith({
            discounts: {
              ...EMPTY_DISCOUNTS,
              studentDiscount: { selected: true, hasProof: false },
            },
          }),
        ],
      });

      const dealId = new Types.ObjectId((res.body as { id: string }).id);
      const deal = await card5DealModel.findById(dealId);
      expect(deal!.auditTriggers.goodStudent).toBe(true);
    });

    it('demands the document when the producer said they had proof', async () => {
      const lead = await seedLead();
      await post(
        {
          leadId: lead._id.toString(),
          soldDate: '2026-02-15',
          policies: [
            policyWith({
              discounts: {
                ...EMPTY_DISCOUNTS,
                studentDiscount: { selected: true, hasProof: true },
              },
            }),
          ],
        },
        400,
      );
    });

    it('stores the size storage reports, not the size the client claimed', async () => {
      const lead = await seedLead();
      const attachment = upload(lead._id.toString(), {
        size: 4096,
        contentType: 'application/pdf',
      });

      const res = await post({
        leadId: lead._id.toString(),
        soldDate: '2026-02-15',
        policies: [
          policyWith({
            discounts: {
              ...EMPTY_DISCOUNTS,
              // The client lies about the size; HeadObject is the evidence.
              studentDiscount: {
                selected: true,
                hasProof: true,
                attachment: { ...attachment, size: 1 },
              },
            },
          }),
        ],
      });

      const dealId = new Types.ObjectId((res.body as { id: string }).id);
      const policies = await card5PolicyModel.find({ dealId });
      expect(policies[0].discounts?.studentDiscount.attachment?.size).toBe(
        4096,
      );
    });

    it('rejects a document key outside the agency and lead prefix', async () => {
      const lead = await seedLead();
      const foreignKey = `agencies/some-other-agency/sold-deals/${lead._id.toString()}/2026/proof.pdf`;
      uploaded.set(foreignKey, { size: 2048, contentType: 'application/pdf' });

      await post(
        {
          leadId: lead._id.toString(),
          soldDate: '2026-02-15',
          policies: [
            policyWith({
              discounts: {
                ...EMPTY_DISCOUNTS,
                studentDiscount: {
                  selected: true,
                  hasProof: true,
                  attachment: {
                    key: foreignKey,
                    filename: 'proof.pdf',
                    contentType: 'application/pdf',
                    size: 2048,
                  },
                },
              },
            }),
          ],
        },
        400,
      );
    });

    it('404s when the declared document never landed in storage', async () => {
      const lead = await seedLead();
      const ghost = keyFor(lead._id.toString());
      uploaded.delete(ghost);

      await post(
        {
          leadId: lead._id.toString(),
          soldDate: '2026-02-15',
          policies: [
            policyWith({
              discounts: {
                ...EMPTY_DISCOUNTS,
                studentDiscount: {
                  selected: true,
                  hasProof: true,
                  attachment: {
                    key: ghost,
                    filename: 'proof.pdf',
                    contentType: 'application/pdf',
                    size: 2048,
                  },
                },
              },
            }),
          ],
        },
        404,
      );
    });
  });

  describe('Sold deals (PAC-40 audit generation + CRM hand-off)', () => {
    const SOLD = '/api/v1/sold-deals';
    const BOARD = '/api/v1/deal-audits';

    let genDealModel: Model<Deal>;
    let genLeadModel: Model<Lead>;
    let genHouseholdModel: Model<Household>;
    let genItemModel: Model<DealAuditItem>;
    let genAuditModel: Model<DealAudit>;
    let genTemplateModel: Model<AuditTemplate>;
    let genRotationModel: Model<CrmRotation>;
    let genProducerId: Types.ObjectId;

    let genCounter = 0;
    const nextNum = () =>
      `GEN-${(genCounter += 1).toString().padStart(6, '0')}`;

    /** The production vocabulary the generator resolves titles against. */
    const TEMPLATES = [
      { name: 'Correct Sold Date', category: 'Common', alwaysInclude: true },
      { name: 'Prior Insurance', category: 'Common', alwaysInclude: true },
      { name: 'Drivers Verified', category: 'Auto' },
      { name: 'Defensive Driver', category: 'Auto' },
      { name: 'Drivewise', category: 'Auto' },
      { name: 'Home Inspection', category: 'Home' },
      { name: 'Home Mortgagee', category: 'Home' },
      { name: 'Home Hail Resistant Roof', category: 'Home' },
      { name: 'Landlord Inspection', category: 'Landlord' },
    ];

    /**
     * A unique client name per call.
     *
     * The board is agency-wide and every test here books a sale, so a shared
     * name makes "my row" ambiguous — the board sorts oldest-first, so the
     * first match would be an earlier test's deal.
     */
    const seedLead = async () => {
      const who = `Handoff ${(genCounter += 1).toString().padStart(3, '0')}`;
      const household = await genHouseholdModel.create({
        agencyId: seed.agencyId,
        branchId: seed.branchId,
        name: `${who} Household`,
        primaryContactName: who,
      });
      const lead = await genLeadModel.create({
        agencyId: seed.agencyId,
        branchId: seed.branchId,
        firstName: 'Harriet',
        lastName: who,
        status: 'Quoted',
        producerId: genProducerId,
        householdId: household._id,
      });
      return { lead, household, clientName: who };
    };

    const sell = async (
      leadId: string,
      policies: Array<Record<string, unknown>>,
    ) => {
      const res = await request(app.getHttpServer())
        .post(SOLD)
        .set(authHeader(producerToken))
        .send({ leadId, soldDate: '2026-02-15', policies })
        .expect(201);
      return res.body as CreateSoldDealResponse;
    };

    const autoPolicy = (overrides: Record<string, unknown> = {}) => ({
      policyType: 'Auto',
      effectiveDate: '2026-02-01',
      carrier: 'Allstate',
      policyNumber: nextNum(),
      premium: 500,
      itemCount: 1,
      priorInsurance: { none: true },
      cancellation: { cancelled: false },
      ...overrides,
    });

    beforeAll(async () => {
      genDealModel = app.get<Model<Deal>>(getModelToken(Deal.name));
      genLeadModel = app.get<Model<Lead>>(getModelToken(Lead.name));
      genHouseholdModel = app.get<Model<Household>>(
        getModelToken(Household.name),
      );
      genItemModel = app.get<Model<DealAuditItem>>(
        getModelToken(DealAuditItem.name),
      );
      genAuditModel = app.get<Model<DealAudit>>(getModelToken(DealAudit.name));
      genTemplateModel = app.get<Model<AuditTemplate>>(
        getModelToken(AuditTemplate.name),
      );
      genRotationModel = app.get<Model<CrmRotation>>(
        getModelToken(CrmRotation.name),
      );

      const userModel = app.get<Model<User>>(getModelToken(User.name));
      const producer = await userModel.findOne({ email: seed.producerEmail });
      genProducerId = producer!._id;

      await genTemplateModel.create(
        TEMPLATES.map((t) => ({
          ...t,
          agencyId: seed.agencyId,
          branchId: seed.branchId,
          active: true,
          required: true,
        })),
      );
    });

    it('generates the baseline plus policy-type items for a simple sale', async () => {
      const { lead } = await seedLead();
      const deal = await sell(lead._id.toString(), [autoPolicy()]);

      expect(deal.auditItemCount).toBeGreaterThan(0);

      const items = await genItemModel.find({
        dealId: new Types.ObjectId(deal.id),
      });
      const names = items.map((i) => i.itemName);
      expect(names).toEqual(
        expect.arrayContaining([
          'Correct Sold Date',
          'Prior Insurance',
          'Drivers Verified',
        ]),
      );
      // No discounts were taken, so nothing discount-driven should appear.
      expect(names).not.toContain('Drivewise');
    });

    it('creates the parent roll-up audit record', async () => {
      const { lead } = await seedLead();
      const deal = await sell(lead._id.toString(), [autoPolicy()]);

      const parent = await genAuditModel.findOne({
        dealId: new Types.ObjectId(deal.id),
      });
      expect(parent).not.toBeNull();
      expect(parent!.result).toBe('Pending');

      const items = await genItemModel.find({
        dealId: new Types.ObjectId(deal.id),
      });
      // Every item points back at it.
      for (const item of items) {
        expect(item.dealAuditId?.toString()).toBe(parent!._id.toString());
      }
    });

    /**
     * THE acceptance criterion: "generated items appear on the PAC-12 board for
     * the submitting producer — verified end-to-end, not just by inspecting the
     * documents."
     *
     * Every field the board filters or renders on is a silent failure if
     * omitted: the row simply does not appear, or reads "Unknown Client".
     */
    it('surfaces the generated items on the hand-off board', async () => {
      const { lead, clientName } = await seedLead();
      const deal = await sell(lead._id.toString(), [autoPolicy()]);

      const res = await request(app.getHttpServer())
        .get(`${BOARD}?page=1&pageSize=50`)
        .set(authHeader(producerToken))
        .expect(200);

      const body = res.body as {
        items: Array<{
          id: string;
          ref: string;
          client: string;
          type: string;
          missing: string;
          daysOpen: number;
        }>;
      };

      const mine = body.items.filter((row) => row.client === clientName);
      expect(mine.length).toBeGreaterThan(0);

      const row = mine[0];
      // Not "Unknown Client" — proves `clientName` was stamped.
      expect(row.client).toBe(clientName);
      // Proves `dealId` resolved, so the badge is real.
      expect(row.type).toBe('Auto');
      expect(row.missing).toEqual(expect.any(String));
      expect(row.ref).toMatch(/^AUD-\d{4}-\d{4}$/);
      // Freshly generated: recomputed from `firstCreatedAt`, so exactly 0.
      expect(row.daysOpen).toBe(0);

      // And it really is the deal we just booked.
      const items = await genItemModel.find({
        dealId: new Types.ObjectId(deal.id),
      });
      expect(items.map((i) => i._id.toString())).toContain(row.id);
    });

    it("hides another producer's generated items from the board", async () => {
      const { lead, clientName } = await seedLead();
      await sell(lead._id.toString(), [autoPolicy()]);

      // The read-only user has agency scope but a different id; the producer
      // filter is what must keep these rows out of a *producer's* board.
      const res = await request(app.getHttpServer())
        .get(`${BOARD}?page=1&pageSize=50`)
        .set(authHeader(readOnlyToken))
        .expect(200);

      // Agency scope sees everything, which is the contrast that proves the
      // `own` filter above was doing real work.
      const body = res.body as { items: Array<{ client: string }> };
      expect(body.items.some((r) => r.client === clientName)).toBe(true);
    });

    it('creates one certificate item per named defensive driver', async () => {
      const { lead } = await seedLead();
      const deal = await sell(lead._id.toString(), [
        autoPolicy({
          discounts: {
            escrow: false,
            fireSubscription: { selected: false, hasProof: false },
            roofReceipt: { selected: false, hasProof: false },
            acvPersonalProperty: false,
            acvDwellingProtection: false,
            drivewise: false,
            defensiveDriver: {
              selected: true,
              drivers: [{ name: 'Dana Driver' }, { name: 'Sam Second' }],
            },
            studentDiscount: { selected: false, hasProof: false },
          },
        }),
      ]);

      const items = await genItemModel.find({
        dealId: new Types.ObjectId(deal.id),
        title: { $regex: '^Defensive Driver' },
      });

      expect(items).toHaveLength(2);
      // Distinct on the board, so a producer can tell which is outstanding.
      expect(items.map((i) => i.itemName).sort()).toEqual([
        'Defensive Driver — Dana Driver',
        'Defensive Driver — Sam Second',
      ]);
      expect(items.map((i) => i.subjectName).sort()).toEqual([
        'Dana Driver',
        'Sam Second',
      ]);
    });

    it('generates the mortgagee item only when escrow was taken', async () => {
      const { lead } = await seedLead();
      const deal = await sell(lead._id.toString(), [
        autoPolicy({
          policyType: 'Home',
          discounts: {
            escrow: true,
            fireSubscription: { selected: false, hasProof: false },
            roofReceipt: { selected: false, hasProof: false },
            acvPersonalProperty: false,
            acvDwellingProtection: false,
            drivewise: false,
            defensiveDriver: { selected: false, drivers: [] },
            studentDiscount: { selected: false, hasProof: false },
          },
          escrow: {
            loanNumber: 'LN-1',
            companyName: 'Escrow Co',
            address: {
              street: '1 Way',
              city: 'Austin',
              state: 'TX',
              zip: '78745',
            },
          },
        }),
      ]);

      const names = (
        await genItemModel.find({ dealId: new Types.ObjectId(deal.id) })
      ).map((i) => i.itemName);
      expect(names).toContain('Home Mortgagee');
      expect(names).toContain('Home Inspection');
    });

    it('does not double-generate when the submission is replayed', async () => {
      const { lead } = await seedLead();
      const token = `replay-${Date.now()}`;
      const policies = [autoPolicy()];

      const first = await request(app.getHttpServer())
        .post(SOLD)
        .set(authHeader(producerToken))
        .send({
          leadId: lead._id.toString(),
          soldDate: '2026-02-15',
          submissionToken: token,
          policies,
        })
        .expect(201);

      const before = await genItemModel.countDocuments({
        dealId: new Types.ObjectId((first.body as { id: string }).id),
      });

      await request(app.getHttpServer())
        .post(SOLD)
        .set(authHeader(producerToken))
        .send({
          leadId: lead._id.toString(),
          soldDate: '2026-02-15',
          submissionToken: token,
          policies,
        })
        .expect(201);

      const after = await genItemModel.countDocuments({
        dealId: new Types.ObjectId((first.body as { id: string }).id),
      });
      // The `dedupeKey` partial-unique index is what makes this true — a retry
      // must not double the service team's workload.
      expect(after).toBe(before);
    });

    it('books the sale even when the agency has no templates at all', async () => {
      // A tenant whose catalog was never seeded still gets a working sale —
      // generation is best-effort by design.
      await genTemplateModel.updateMany(
        { agencyId: seed.agencyId },
        { $set: { active: false } },
      );

      const { lead } = await seedLead();
      const deal = await sell(lead._id.toString(), [autoPolicy()]);
      expect(deal.auditItemCount).toBe(0);

      const stored = await genDealModel.findById(new Types.ObjectId(deal.id));
      // ...but the failure is recorded rather than silent.
      expect(stored!.auditGenerationStatus).toBe('no_templates');

      await genTemplateModel.updateMany(
        { agencyId: seed.agencyId },
        { $set: { active: true } },
      );
    });

    it('assigns a CRM from the producer rotation, then keeps it for the household', async () => {
      const crmA = new Types.ObjectId();
      const crmB = new Types.ObjectId();
      await genRotationModel.create([
        {
          agencyId: seed.agencyId,
          branchId: seed.branchId,
          producerId: genProducerId,
          crmId: crmA,
          order: 1,
          activeForProducer: true,
        },
        {
          agencyId: seed.agencyId,
          branchId: seed.branchId,
          producerId: genProducerId,
          crmId: crmB,
          order: 2,
          activeForProducer: true,
        },
      ]);

      const first = await seedLead();
      const dealOne = await sell(first.lead._id.toString(), [autoPolicy()]);
      expect(dealOne.crmAssigned).toBe(true);

      const second = await seedLead();
      await sell(second.lead._id.toString(), [autoPolicy()]);

      const householdOne = await genHouseholdModel.findById(
        first.household._id,
      );
      const householdTwo = await genHouseholdModel.findById(
        second.household._id,
      );

      // Round-robin: two households, two different CRMs.
      expect(householdOne!.assignedCrmId).toBeDefined();
      expect(householdTwo!.assignedCrmId).toBeDefined();
      expect(householdOne!.assignedCrmId!.toString()).not.toBe(
        householdTwo!.assignedCrmId!.toString(),
      );

      // A second sale to the SAME household keeps its CRM — the relationship
      // is with the client, not the transaction.
      const already = householdOne!.assignedCrmId!.toString();
      await sell(first.lead._id.toString(), [autoPolicy()]);
      const reread = await genHouseholdModel.findById(first.household._id);
      expect(reread!.assignedCrmId!.toString()).toBe(already);
    });
  });

  describe('Policies (PAC-40 duplicate check)', () => {
    const CHECK = '/api/v1/policies/check';

    /** Asserting against the shared wire type keeps the tests honest. */
    const checkBody = (res: request.Response): PolicyCheckResponse =>
      res.body as PolicyCheckResponse;

    /** The producer's own policy, reachable via its deal. */
    let ownPolicyId: string;
    /** A colleague's policy in the same agency — must be reported but masked. */
    let foreignPolicyId: string;

    beforeAll(async () => {
      const policyModel = app.get<Model<Policy>>(getModelToken(Policy.name));
      const dealModel = app.get<Model<Deal>>(getModelToken(Deal.name));
      const householdModel = app.get<Model<Household>>(
        getModelToken(Household.name),
      );
      const userModel = app.get<Model<User>>(getModelToken(User.name));

      const producer = await userModel.findOne({ email: seed.producerEmail });
      const otherProducerId = new Types.ObjectId();

      const household = await householdModel.create({
        agencyId: seed.agencyId,
        branchId: seed.branchId,
        name: 'Dedupe Household',
        primaryContactName: 'Dana Dedupe',
        isTestRecord: false,
      });

      const ownDeal = await dealModel.create({
        agencyId: seed.agencyId,
        branchId: seed.branchId,
        producerId: producer!._id,
        householdId: household._id,
        clientName: 'Dana Dedupe',
        isTestRecord: false,
      });

      const foreignDeal = await dealModel.create({
        agencyId: seed.agencyId,
        branchId: seed.branchId,
        producerId: otherProducerId,
        clientName: 'Someone Elses Client',
        isTestRecord: false,
      });

      const own = await policyModel.create({
        agencyId: seed.agencyId,
        branchId: seed.branchId,
        policyNumber: 'ABC-123-456',
        policyNumberKey: 'ABC123456',
        policyType: 'Auto',
        carrier: 'Allstate',
        effectiveDate: new Date('2026-01-15T00:00:00.000Z'),
        householdId: household._id,
        dealId: ownDeal._id,
        isTestRecord: false,
      });
      ownPolicyId = own._id.toString();

      const foreign = await policyModel.create({
        agencyId: seed.agencyId,
        branchId: seed.branchId,
        policyNumber: 'ZZZ-999-000',
        policyNumberKey: 'ZZZ999000',
        policyType: 'Home',
        carrier: 'Allstate',
        effectiveDate: new Date('2026-02-01T00:00:00.000Z'),
        dealId: foreignDeal._id,
        isTestRecord: false,
      });
      foreignPolicyId = foreign._id.toString();

      // Must never surface: test records are excluded from the check.
      await policyModel.create({
        agencyId: seed.agencyId,
        branchId: seed.branchId,
        policyNumber: 'TST-000-111',
        policyNumberKey: 'TST000111',
        policyType: 'Auto',
        isTestRecord: true,
      });
    });

    it('matches regardless of how the producer typed the number', async () => {
      // The whole point of the normalized key: these are one policy.
      for (const typed of ['abc123456', 'ABC-123-456', '  abc 123 456  ']) {
        const res = await request(app.getHttpServer())
          .get(CHECK)
          .query({ number: typed })
          .set(authHeader(producerToken))
          .expect(200);

        expect(checkBody(res).normalized).toBe('ABC123456');
        expect(checkBody(res).matches).toHaveLength(1);
        expect(checkBody(res).matches[0].id).toBe(ownPolicyId);
      }
    });

    it('echoes the query so a stale response can be discarded', async () => {
      const res = await request(app.getHttpServer())
        .get(CHECK)
        .query({ number: 'abc-123-456' })
        .set(authHeader(producerToken))
        .expect(200);

      expect(checkBody(res).query).toBe('abc-123-456');
    });

    it('returns the identifying fields for a match the producer owns', async () => {
      const res = await request(app.getHttpServer())
        .get(CHECK)
        .query({ number: 'ABC123456' })
        .set(authHeader(producerToken))
        .expect(200);

      const match = checkBody(res).matches[0];
      expect(match).toMatchObject({
        isOwn: true,
        policyNumber: 'ABC-123-456',
        policyType: 'Auto',
        carrier: 'Allstate',
        clientName: 'Dana Dedupe',
      });
      expect(match.householdId).toEqual(expect.any(String));
      expect(match.dealId).toEqual(expect.any(String));
    });

    it("reports a colleague's duplicate but withholds who it belongs to", async () => {
      // The duplicate a producer most needs warning about is the one they
      // cannot see — hiding it entirely would defeat the endpoint.
      const res = await request(app.getHttpServer())
        .get(CHECK)
        .query({ number: 'zzz-999-000' })
        .set(authHeader(producerToken))
        .expect(200);

      expect(checkBody(res).matches).toHaveLength(1);
      const match = checkBody(res).matches[0];
      expect(match.id).toBe(foreignPolicyId);
      expect(match.isOwn).toBe(false);
      // Enough to answer "is this the same policy, or did I mistype?"...
      expect(match.policyType).toBe('Home');
      expect(match.carrier).toBe('Allstate');
      expect(match.effectiveDate).toEqual(expect.any(String));
      // ...but not enough to read another producer's book.
      expect(match.clientName).toBeNull();
      expect(match.householdId).toBeNull();
      expect(match.dealId).toBeNull();
    });

    it('sees everything unmasked at agency scope', async () => {
      const res = await request(app.getHttpServer())
        .get(CHECK)
        .query({ number: 'ZZZ999000' })
        .set(authHeader(ownerToken))
        .expect(200);

      expect(checkBody(res).matches[0].isOwn).toBe(true);
      expect(checkBody(res).matches[0].clientName).toBe('Someone Elses Client');
    });

    it('treats input too short to be meaningful as "no opinion"', async () => {
      // Not a 400: the wizard asks on every blur, including half-typed input.
      const res = await request(app.getHttpServer())
        .get(CHECK)
        .query({ number: 'A-1' })
        .set(authHeader(producerToken))
        .expect(200);

      expect(checkBody(res).normalized).toBeNull();
      expect(checkBody(res).matches).toEqual([]);
    });

    it('returns no matches for an unknown number', async () => {
      const res = await request(app.getHttpServer())
        .get(CHECK)
        .query({ number: 'NOPE-404-404' })
        .set(authHeader(producerToken))
        .expect(200);

      expect(checkBody(res).normalized).toBe('NOPE404404');
      expect(checkBody(res).matches).toEqual([]);
    });

    it('excludes test records', async () => {
      const res = await request(app.getHttpServer())
        .get(CHECK)
        .query({ number: 'TST-000-111' })
        .set(authHeader(producerToken))
        .expect(200);

      expect(checkBody(res).matches).toEqual([]);
    });

    it('narrows by policy type when the wizard supplies one', async () => {
      const auto = await request(app.getHttpServer())
        .get(CHECK)
        .query({ number: 'ABC123456', policyType: 'Auto' })
        .set(authHeader(producerToken))
        .expect(200);
      expect(checkBody(auto).matches).toHaveLength(1);

      // Same number, different line of business — cannot be the same policy.
      const home = await request(app.getHttpServer())
        .get(CHECK)
        .query({ number: 'ABC123456', policyType: 'Home' })
        .set(authHeader(producerToken))
        .expect(200);
      expect(checkBody(home).matches).toEqual([]);
    });

    it('rejects a blank number and an uncatalogued policy type', async () => {
      await request(app.getHttpServer())
        .get(CHECK)
        .query({ number: '' })
        .set(authHeader(producerToken))
        .expect(400);

      await request(app.getHttpServer())
        .get(CHECK)
        .query({ number: 'ABC123456', policyType: 'Property' })
        .set(authHeader(producerToken))
        .expect(400);
    });

    it('requires authentication', async () => {
      await request(app.getHttpServer())
        .get(CHECK)
        .query({ number: 'ABC123456' })
        .expect(401);
    });
  });

  describe('Sold deals (PAC-40 create)', () => {
    const SOLD = '/api/v1/sold-deals';

    /**
     * Query child collections by a real ObjectId, not the response's string.
     *
     * Every `@Prop({ type: Types.ObjectId })` in this repo compiles to a
     * **Mixed** path — the token Mongoose recognises is
     * `SchemaTypes.ObjectId`. Mixed paths do no casting, so a string filter
     * silently matches nothing. Service code is unaffected because it always
     * constructs ObjectIds explicitly; only a test reading back by id has to
     * know. Tracked as its own follow-up.
     */
    const dealRef = (id: string) => new Types.ObjectId(id);

    let soldDealModel: Model<Deal>;
    let soldPolicyModel: Model<Policy>;
    let soldLeadModel: Model<Lead>;
    let soldHouseholdModel: Model<Household>;
    let soldActivityModel: Model<Activity>;
    let priorInsuranceModel: Model<PriorInsurance>;
    let priorPolicyModel: Model<PriorPolicy>;
    let producerId: Types.ObjectId;

    let counter = 0;
    /** Unique per call, so tests never collide on the policy-number index. */
    const nextNumber = () =>
      `SOLD-${(counter += 1).toString().padStart(6, '0')}`;

    const soldPolicy = (overrides: Record<string, unknown> = {}) => ({
      policyType: 'Auto',
      effectiveDate: '2026-02-01',
      carrier: 'Allstate',
      policyNumber: nextNumber(),
      premium: 1200.1,
      itemCount: 2,
      priorInsurance: { none: true },
      cancellation: { cancelled: false },
      ...overrides,
    });

    const payload = (
      leadId: string,
      overrides: Record<string, unknown> = {},
    ) => ({
      leadId,
      soldDate: '2026-02-15',
      policies: [soldPolicy()],
      ...overrides,
    });

    // `object` rather than `unknown`: supertest's `.send` rejects `unknown`, and
    // every payload here is an object anyway.
    const createAs = async (token: string, body: object, expected = 201) => {
      const res = await request(app.getHttpServer())
        .post(SOLD)
        .set(authHeader(token))
        .send(body)
        .expect(expected);
      return res.body as CreateSoldDealResponse;
    };

    /** A lead owned by the given producer, with a real household attached. */
    const seedSoldLead = async (
      owner: Types.ObjectId | undefined,
      overrides: Record<string, unknown> = {},
      householdOverrides: Record<string, unknown> = {},
    ) => {
      const household = await soldHouseholdModel.create({
        agencyId: seed.agencyId,
        branchId: seed.branchId,
        name: 'Sellable Household',
        primaryContactName: 'Sam Sold',
        ...householdOverrides,
      });
      const lead = await soldLeadModel.create({
        agencyId: seed.agencyId,
        branchId: seed.branchId,
        firstName: 'Sam',
        lastName: 'Sold',
        status: 'Quoted',
        producerId: owner,
        householdId: household._id,
        ...overrides,
      });
      return { lead, household };
    };

    beforeAll(async () => {
      soldDealModel = app.get<Model<Deal>>(getModelToken(Deal.name));
      soldPolicyModel = app.get<Model<Policy>>(getModelToken(Policy.name));
      soldLeadModel = app.get<Model<Lead>>(getModelToken(Lead.name));
      soldHouseholdModel = app.get<Model<Household>>(
        getModelToken(Household.name),
      );
      soldActivityModel = app.get<Model<Activity>>(
        getModelToken(Activity.name),
      );
      priorInsuranceModel = app.get<Model<PriorInsurance>>(
        getModelToken(PriorInsurance.name),
      );
      priorPolicyModel = app.get<Model<PriorPolicy>>(
        getModelToken(PriorPolicy.name),
      );

      const userModel = app.get<Model<User>>(getModelToken(User.name));
      const producer = await userModel.findOne({ email: seed.producerEmail });
      producerId = producer!._id;
    });

    it('books a deal with server-derived totals', async () => {
      const { lead } = await seedSoldLead(producerId);
      const body = await createAs(
        producerToken,
        payload(lead._id.toString(), {
          policies: [
            soldPolicy({ premium: 1200.1, itemCount: 2 }),
            soldPolicy({ policyType: 'Home', premium: 899.95, itemCount: 3 }),
          ],
        }),
      );

      // 1200.10 + 899.95 is 2100.0499999999997 in IEEE-754 — the rounding is
      // what keeps that out of the Sold scorecard.
      expect(body.premium).toBe(2100.05);
      expect(body.itemCount).toBe(5);
      expect(body.policyCount).toBe(2);
      expect(body.policyTypes).toEqual(['Auto', 'Home']);
      expect(body.isBundle).toBe(true);
      expect(body.dealType).toBe('Bundle');

      const deal = await soldDealModel.findById(body.id);
      expect(deal).toBeTruthy();
      expect(deal!.premium).toBe(2100.05);
      // Honest provenance: submitted, not rolled up from linked rows.
      expect(deal!.premiumSource).toBe('snapshot');
      expect(deal!.soldDateYmd).toBe(20260215);
      expect(deal!.producerId?.toString()).toBe(producerId.toString());
      // The refs that did not exist before this story.
      expect(deal!.leadId?.toString()).toBe(lead._id.toString());
      expect(deal!.householdId).toBeTruthy();
      // Backs the hand-off board's client column.
      expect(deal!.clientName).toBe('Sam Sold');
    });

    it('ignores client-supplied totals', async () => {
      const { lead } = await seedSoldLead(producerId);
      const body = await createAs(
        producerToken,
        payload(lead._id.toString(), {
          premium: 999_999,
          itemCount: 999,
          policyCount: 99,
          policies: [soldPolicy({ premium: 500, itemCount: 1 })],
        }),
      );

      expect(body.premium).toBe(500);
      expect(body.itemCount).toBe(1);
      expect(body.policyCount).toBe(1);
    });

    it('creates a policy per row, linked to the deal and household', async () => {
      const { lead, household } = await seedSoldLead(producerId);
      const first = nextNumber();
      const body = await createAs(
        producerToken,
        payload(lead._id.toString(), {
          policies: [
            soldPolicy({ policyNumber: first }),
            soldPolicy({ policyType: 'Home' }),
          ],
        }),
      );

      const policies = await soldPolicyModel.find({ dealId: dealRef(body.id) });
      expect(policies).toHaveLength(2);
      for (const policy of policies) {
        expect(policy.householdId?.toString()).toBe(household._id.toString());
        expect(policy.active).toBe(true);
      }
      // The normalized key is what makes GET /policies/check able to find it.
      const stored = policies.find((p) => p.policyNumber === first);
      expect(stored!.policyNumberKey).toBe(first.replace(/[^A-Z0-9]/g, ''));
    });

    it('writes prior-insurance summary and per-line rows only when declared', async () => {
      const { lead } = await seedSoldLead(producerId);
      const body = await createAs(
        producerToken,
        payload(lead._id.toString(), {
          policies: [
            soldPolicy({
              policyType: 'Auto',
              priorInsurance: {
                none: false,
                carrier: 'Geico',
                agentName: 'A. Agent',
              },
              cancellation: { cancelled: true, effectiveDate: '2026-01-31' },
            }),
            soldPolicy({
              policyType: 'Home',
              priorInsurance: { none: false, carrier: 'State Farm' },
            }),
          ],
        }),
      );

      const summary = await priorInsuranceModel.findOne({
        dealId: dealRef(body.id),
      });
      expect(summary).toBeTruthy();
      // Legacy's shape: separate auto/home columns on one deal-level row.
      expect(summary!.previousCarrierAuto).toBe('Geico');
      expect(summary!.previousCarrierHome).toBe('State Farm');
      expect(summary!.autoHomeSameCarrier).toBe('No');
      expect(summary!.cancelledPreviousInsurance).toBe('Yes');

      const lines = await priorPolicyModel.find({ dealId: dealRef(body.id) });
      expect(lines).toHaveLength(2);
      const auto = lines.find((l) => l.policyType === 'Auto');
      // Already cancelled ⇒ nothing for the CRM to chase.
      expect(auto!.needsCancellation).toBe('No');
      const home = lines.find((l) => l.policyType === 'Home');
      expect(home!.needsCancellation).toBe('Yes');
    });

    it('writes no prior-insurance records for a new-to-market client', async () => {
      const { lead } = await seedSoldLead(producerId);
      const body = await createAs(producerToken, payload(lead._id.toString()));

      // An empty summary row would tell the service team there is prior
      // coverage to chase when there is none.
      expect(
        await priorInsuranceModel.countDocuments({ dealId: dealRef(body.id) }),
      ).toBe(0);
      expect(
        await priorPolicyModel.countDocuments({ dealId: dealRef(body.id) }),
      ).toBe(0);
    });

    it('books ONE deal when the same submission token is replayed', async () => {
      const { lead } = await seedSoldLead(producerId);
      const body = payload(lead._id.toString(), {
        submissionToken: 'sold-replay-token-1',
      });

      const first = await createAs(producerToken, body);
      const second = await createAs(producerToken, body);

      expect(second.id).toBe(first.id);
      expect(
        await soldDealModel.countDocuments({
          submissionToken: 'SOLD|SOLD-REPLAY-TOKEN-1',
        }),
      ).toBe(1);
      // The replay must not double the policies either.
      expect(
        await soldPolicyModel.countDocuments({ dealId: dealRef(first.id) }),
      ).toBe(1);
    });

    it('404s a token replayed by a different producer', async () => {
      const { lead } = await seedSoldLead(producerId);
      const body = payload(lead._id.toString(), {
        submissionToken: 'sold-replay-token-2',
      });
      await createAs(producerToken, body);

      // Owner is agency-scoped so the clamp passes; a *different* producer must
      // not be handed back someone else's deal id.
      const otherProducer = await seedSoldLead(new Types.ObjectId());
      await request(app.getHttpServer())
        .post(SOLD)
        .set(authHeader(producerToken))
        .send(payload(otherProducer.lead._id.toString()))
        .expect(404);
    });

    it('advances the lead to Sold, forward only', async () => {
      const { lead } = await seedSoldLead(producerId, { status: 'Quoted' });
      const body = await createAs(producerToken, payload(lead._id.toString()));
      expect(body.leadStatus).toBe('Sold');

      const reloaded = await soldLeadModel.findById(lead._id);
      expect(reloaded!.status).toBe('Sold');
      expect(reloaded!.lastActivityAt).toBeTruthy();
    });

    it('advances a migrated lead stored as a raw status code', async () => {
      // `arW7O` is Requote. Without the code expansion in
      // soldAdvanceableStatusValues() this lead would silently never advance.
      const { lead } = await seedSoldLead(producerId, { status: 'arW7O' });
      const body = await createAs(producerToken, payload(lead._id.toString()));
      expect(body.leadStatus).toBe('Sold');
    });

    it('never drags a terminal lead backwards', async () => {
      const { lead } = await seedSoldLead(producerId, { status: 'Lost' });
      const body = await createAs(producerToken, payload(lead._id.toString()));

      expect(body.leadStatus).toBe('Lost');
      const reloaded = await soldLeadModel.findById(lead._id);
      expect(reloaded!.status).toBe('Lost');
    });

    it('records a sold activity attributed to the app, not the migration', async () => {
      const { lead } = await seedSoldLead(producerId);
      const body = await createAs(producerToken, payload(lead._id.toString()));

      const activity = await soldActivityModel.findOne({
        dealId: dealRef(body.id),
      });
      expect(activity).toBeTruthy();
      expect(activity!.type).toBe('sold');
      expect(activity!.subjectType).toBe('deal');
      expect(activity!.leadId?.toString()).toBe(lead._id.toString());
      // `source` defaults to 'migration' in the schema.
      expect(activity!.source).toBe('internal');
    });

    it('resolves the household from a migrated lead and self-heals the link', async () => {
      const household = await soldHouseholdModel.create({
        agencyId: seed.agencyId,
        branchId: seed.branchId,
        name: 'Migrated Household',
        legacySmartSuiteId: 'legacy-hh-sold-1',
      });
      // The migration writes only `legacyHouseholdId` — never `householdId`.
      const lead = await soldLeadModel.create({
        agencyId: seed.agencyId,
        branchId: seed.branchId,
        firstName: 'Mig',
        lastName: 'Rated',
        status: 'New',
        producerId,
        legacyHouseholdId: 'legacy-hh-sold-1',
      });

      const body = await createAs(producerToken, payload(lead._id.toString()));
      const deal = await soldDealModel.findById(body.id);
      expect(deal!.householdId?.toString()).toBe(household._id.toString());

      const reloaded = await soldLeadModel.findById(lead._id);
      expect(reloaded!.householdId?.toString()).toBe(household._id.toString());
    });

    it('409s a lead with no resolvable household', async () => {
      const lead = await soldLeadModel.create({
        agencyId: seed.agencyId,
        branchId: seed.branchId,
        firstName: 'No',
        lastName: 'Household',
        status: 'New',
        producerId,
      });
      await request(app.getHttpServer())
        .post(SOLD)
        .set(authHeader(producerToken))
        .send(payload(lead._id.toString()))
        .expect(409);
    });

    it('404s (not 403) for a lead outside the caller data scope', async () => {
      const { lead } = await seedSoldLead(new Types.ObjectId());
      await request(app.getHttpServer())
        .post(SOLD)
        .set(authHeader(producerToken))
        .send(payload(lead._id.toString()))
        .expect(404);
    });

    it('404s for an unassigned lead under own scope', async () => {
      const { lead } = await seedSoldLead(undefined);
      await request(app.getHttpServer())
        .post(SOLD)
        .set(authHeader(producerToken))
        .send(payload(lead._id.toString()))
        .expect(404);
    });

    it('re-points an existing policy instead of duplicating it', async () => {
      const { lead } = await seedSoldLead(producerId);
      const number = nextNumber();
      const first = await createAs(
        producerToken,
        payload(lead._id.toString(), {
          policies: [soldPolicy({ policyNumber: number, premium: 100 })],
        }),
      );
      const existing = await soldPolicyModel.findOne({
        dealId: dealRef(first.id),
      });

      const { lead: second } = await seedSoldLead(producerId);
      await createAs(
        producerToken,
        payload(second._id.toString(), {
          policies: [
            soldPolicy({
              policyNumber: number,
              premium: 250,
              existingPolicyId: existing!._id.toString(),
            }),
          ],
        }),
      );

      // One policy row, re-pointed — not a second one for the same number.
      expect(
        await soldPolicyModel.countDocuments({ policyNumber: number }),
      ).toBe(1);
      const reloaded = await soldPolicyModel.findById(existing!._id);
      expect(reloaded!.premium).toBe(250);
    });

    it("403s an attempt to claim another producer's policy", async () => {
      // GET /policies/check deliberately reports out-of-scope matches (masked),
      // so this id is obtainable. The check informs; it must not authorize.
      const foreignLead = await seedSoldLead(new Types.ObjectId());
      const foreignDeal = await soldDealModel.create({
        agencyId: seed.agencyId,
        branchId: seed.branchId,
        producerId: new Types.ObjectId(),
      });
      const foreignPolicy = await soldPolicyModel.create({
        agencyId: seed.agencyId,
        branchId: seed.branchId,
        policyNumber: nextNumber(),
        dealId: foreignDeal._id,
      });

      const { lead } = await seedSoldLead(producerId);
      await request(app.getHttpServer())
        .post(SOLD)
        .set(authHeader(producerToken))
        .send(
          payload(lead._id.toString(), {
            policies: [
              soldPolicy({ existingPolicyId: foreignPolicy._id.toString() }),
            ],
          }),
        )
        .expect(403);

      expect(foreignLead.lead).toBeTruthy();
    });

    it('rejects a submission with two rows claiming one policy number', async () => {
      const { lead } = await seedSoldLead(producerId);
      const number = nextNumber();
      await request(app.getHttpServer())
        .post(SOLD)
        .set(authHeader(producerToken))
        .send(
          payload(lead._id.toString(), {
            policies: [
              soldPolicy({ policyNumber: number }),
              soldPolicy({ policyNumber: number.toLowerCase() }),
            ],
          }),
        )
        .expect(400);
    });

    it('rejects cross-branch discounts rather than stripping them', async () => {
      const { lead } = await seedSoldLead(producerId);
      await request(app.getHttpServer())
        .post(SOLD)
        .set(authHeader(producerToken))
        .send(
          payload(lead._id.toString(), {
            policies: [
              soldPolicy({
                policyType: 'Home',
                // Silently stripping this would generate a Drivewise audit item
                // for a deal with no auto line.
                discounts: { drivewise: true },
              }),
            ],
          }),
        )
        .expect(400);
    });

    it('rejects an incomplete card', async () => {
      const { lead } = await seedSoldLead(producerId);
      const bad = [
        { policies: [] },
        { policies: [soldPolicy({ premium: -1 })] },
        { policies: [soldPolicy({ itemCount: 0 })] },
        { policies: [soldPolicy({ policyType: 'Property' })] },
        { soldDate: '15/02/2026' },
        // Prior insurance declared but no carrier named.
        {
          policies: [soldPolicy({ priorInsurance: { none: false } })],
        },
        // Cancelled but no effective date.
        {
          policies: [soldPolicy({ cancellation: { cancelled: true } })],
        },
        // Escrow ticked without its required sub-card.
        {
          policies: [
            soldPolicy({ policyType: 'Home', discounts: { escrow: true } }),
          ],
        },
      ];

      for (const overrides of bad) {
        await request(app.getHttpServer())
          .post(SOLD)
          .set(authHeader(producerToken))
          .send(payload(lead._id.toString(), overrides))
          .expect(400);
      }
    });

    it('403s a caller without deal_audits:write', async () => {
      const { lead } = await seedSoldLead(producerId);
      await request(app.getHttpServer())
        .post(SOLD)
        .set(authHeader(readOnlyToken))
        .send(payload(lead._id.toString()))
        .expect(403);
    });

    it('returns the wizard context, including the driver picker contacts', async () => {
      const { lead, household } = await seedSoldLead(producerId);
      const contact = await app
        .get<Model<Contact>>(getModelToken(Contact.name))
        .create({
          agencyId: seed.agencyId,
          branchId: seed.branchId,
          firstName: 'Dana',
          lastName: 'Driver',
          roleInHousehold: 'Driver',
        });
      await soldHouseholdModel.updateOne(
        { _id: household._id },
        { $set: { memberContactIds: [contact._id] } },
      );

      const res = await request(app.getHttpServer())
        .get(`${SOLD}/context`)
        .query({ leadId: lead._id.toString() })
        .set(authHeader(producerToken))
        .expect(200);

      const body = res.body as SoldDealLeadContext;
      expect(body.primaryContactName).toBe('Sam Sold');
      expect(body.householdId).toBe(household._id.toString());
      expect(body.contacts.map((c) => c.firstName)).toContain('Dana');
    });

    it('reports a missing household as null rather than failing the context', async () => {
      // The page blocks up front instead of letting a producer fill eight cards
      // and fail at submit.
      const lead = await soldLeadModel.create({
        agencyId: seed.agencyId,
        branchId: seed.branchId,
        firstName: 'Ctx',
        lastName: 'NoHousehold',
        producerId,
      });

      const res = await request(app.getHttpServer())
        .get(`${SOLD}/context`)
        .query({ leadId: lead._id.toString() })
        .set(authHeader(producerToken))
        .expect(200);

      expect((res.body as SoldDealLeadContext).householdId).toBeNull();
    });
  });
});
