import { INestApplication } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  DataScope,
  DEFAULT_ROLE_TEMPLATES,
  ModuleKey,
  SERVICE_TICKET_ARCHIVE_AFTER_DAYS,
  modulePermission,
} from '@sfa/shared';
import * as bcrypt from 'bcrypt';
import { AgencyRole } from '../src/roles/schemas/agency-role.schema';
import type {
  ContactDetail,
  CreateActivityResponse,
  CreateSoldDealResponse,
  HotLeadListResponse,
  LeaderboardResponse,
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
import { ServiceTicketsService } from '../src/crm/service-tickets.service';
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
import { ProducerGoal } from '../src/producer-goals/schemas/producer-goal.schema';
import { PriorPolicy } from '../src/prior-policies/schemas/prior-policy.schema';
import { Carrier } from '../src/carriers/schemas/carrier.schema';
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

    /*
     * The OR gate must still *deny* someone holding neither permission —
     * otherwise it is an "always allow" and this whole suite proves nothing.
     *
     * This used to be asserted with `producerToken`, on the stated premise that
     * "the producer role has neither". **PAC-38 invalidated that**: it granted
     * Producer `clients:write` for contact editing on Lead Detail, and write
     * implies read, so a producer now legitimately passes the gate. The test
     * kept asserting 403 and started failing — the premise rotted, not the gate.
     *
     * No seeded role lacks both any more (the two test roles hold read on every
     * module), so the negative case needs a purpose-built one rather than
     * borrowing a persona whose permissions can drift again.
     */
    it('GET /households/:id — forbidden for a user with neither permission', async () => {
      const roleModel = app.get<Model<AgencyRole>>(
        getModelToken(AgencyRole.name),
      );
      const userModel = app.get<Model<User>>(getModelToken(User.name));

      const narrowRole = await roleModel.create({
        agencyId: new Types.ObjectId(seed.agencyId),
        name: 'Neither Clients Nor CRM',
        slug: 'neither_clients_nor_crm',
        // Deliberately one unrelated page: enough to authenticate and pass the
        // tenant guard, nothing that reaches a client record.
        permissions: [`${ModuleKey.Leads}:read`],
        dataScope: DataScope.Agency,
        isSystemTemplate: false,
      });
      const email = 'test-neither@sfa.local';
      await userModel.updateOne(
        { email },
        {
          $set: {
            email,
            passwordHash: await bcrypt.hash(TEST_PASSWORD, 12),
            firstName: 'Neither',
            lastName: 'Permission',
            agencyId: new Types.ObjectId(seed.agencyId),
            branchId: new Types.ObjectId(seed.branchId),
            roleIds: [narrowRole._id],
            isActive: true,
          },
        },
        { upsert: true },
      );

      const { accessToken } = await login(app, email, TEST_PASSWORD);
      await request(app.getHttpServer())
        .get(`/api/v1/households/${seed.householdId}`)
        .set(authHeader(accessToken))
        .expect(403);
    });

    /*
     * The other half of what PAC-38 changed, now pinned so the next reader does
     * not mistake it for the regression above: a producer *does* reach a
     * household, through `clients:write` implying `clients:read`.
     */
    it('GET /households/:id — producer reaches it via clients:write (PAC-38)', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/households/${seed.householdId}`)
        .set(authHeader(producerToken))
        .expect(200);
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
      { path: 'households', module: ModuleKey.Clients },
      { path: 'deals', module: ModuleKey.Clients },
      // NOTE: `deal-audits` (DealAuditsModule / PAC-12/14), `leads`
      // (LeadsModule / PAC-36), `quote-recaps` (QuoteRecapsModule / PAC-39),
      // `contacts` (ContactsModule / PAC-38), `performance`
      // (PerformanceModule / PAC-10+11), `leaderboard` (LeaderboardModule /
      // PAC-13) and `crm/service-tickets` (CrmModule) are real modules, not
      // `{status:'ready'}` stubs — each is covered by its own describe block
      // below. The `files` stub was removed with PAC-39: it borrowed the
      // `quote_recaps` gate and the real file API is now
      // `POST /quote-recaps/quote-document/presign`.
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

  describe('CSR role access matrix', () => {
    // CSR = dashboard:read, leads:write, mailers:write, performance:read,
    // crm_service:write, quote_recaps:write. Scoped to exactly these 6 pages.
    //
    // `quote_recaps` was added for Start Quote on the Household page: step 1
    // creates the lead, step 2 writes the recap, and the CSR runs both and
    // takes the quote ticket that comes out. It adds no nav entry — there is no
    // `quote_recaps` item in `nav-items.ts` — so it widens the API surface
    // without widening the CSR's visible app.
    /*
     * Pages still served by a `createFeatureController` stub, which echoes
     * `{ module }` — so the echo is worth asserting: it proves *which*
     * controller answered, not merely that something did.
     */
    const csrStubReads = [
      { path: 'dashboard', module: ModuleKey.Dashboard },
      { path: 'mailers', module: ModuleKey.Mailers },
    ];

    it.each(csrStubReads)(
      'GET /api/v1/$path — CSR can read',
      async ({ path, module }) => {
        const res = await request(app.getHttpServer())
          .get(`/api/v1/${path}`)
          .set(authHeader(csrToken))
          .expect(200);

        expect(res.body.module).toBe(module);
      },
    );

    /*
     * Pages whose stub has been replaced by a real controller (PAC-10/11 for
     * performance, PAC-36 for leads). There is no `{ module }` echo to assert
     * any more — a real payload came back instead, which is the point.
     *
     * Kept in this block deliberately: what is under test here is the *access
     * matrix*, not the payload. A 200 says the guard chain let the CSR through;
     * the shape of what it returned is covered by those features' own suites.
     */
    it.each(['leads', 'performance'])(
      'GET /api/v1/%s — CSR can read (real module)',
      async (path) => {
        await request(app.getHttpServer())
          .get(`/api/v1/${path}`)
          .set(authHeader(csrToken))
          .expect(200);
      },
    );

    it('GET /api/v1/crm/service-tickets — CSR can read (real module)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/crm/service-tickets')
        .set(authHeader(csrToken))
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });

    // Still a stub, so the bare `PATCH /mailers` write probe still answers.
    it('PATCH /api/v1/mailers — CSR can write', async () => {
      await request(app.getHttpServer())
        .patch('/api/v1/mailers')
        .set(authHeader(csrToken))
        .expect(200);
    });

    /*
     * Leads has a real controller now, so there is no bare `PATCH /leads` to
     * probe — the write route is `PATCH /leads/:id`.
     *
     * **404, not 403, is the assertion that matters.** A 403 would mean the
     * guard chain rejected the CSR for lacking `leads:write`; a 404 means it let
     * them through and the *lead* was not found — which is exactly what
     * `LeadAccessService.loadOwnedLead` returns for an id outside the caller's
     * scope, deliberately, so that whether it exists is not disclosed. So this
     * pins the permission while asserting nothing about any particular lead.
     */
    it('PATCH /api/v1/leads/:id — CSR passes the write gate (real module)', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/leads/${new Types.ObjectId().toString()}`)
        .set(authHeader(csrToken))
        .send({ status: 'Contacted' })
        .expect(404);
    });

    it('POST /api/v1/crm/service-tickets — CSR can write (real module)', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/crm/service-tickets')
        .set(authHeader(csrToken))
        .send({ clientName: 'CSR Write Check', category: 'Policy Change' })
        .expect(201);
    });

    it('CSR holds quote_recaps write — Start Quote step 2 is reachable', () => {
      const csr = DEFAULT_ROLE_TEMPLATES.find((t) => t.slug === 'csr');
      expect(csr!.permissions).toContain(
        modulePermission(ModuleKey.QuoteRecaps, 'write'),
      );
      // Both halves of Start Quote, in one assertion — step 1 is a `leads`
      // write and step 2 a `quote_recaps` write, and the button on the
      // Household page is gated on holding both.
      expect(csr!.permissions).toContain(
        modulePermission(ModuleKey.Leads, 'write'),
      );
    });

    /*
     * Performance is read-only, and since PAC-10/11 replaced its stub that is
     * now structural rather than permission-enforced: the real controller
     * declares no mutating handler at all, so there is nothing to be forbidden
     * from and the router answers 404.
     *
     * A stronger guarantee than the 403 this used to assert — a route that does
     * not exist cannot be reached by anyone, whatever they hold.
     */
    it('PATCH /api/v1/performance — no write route exists', async () => {
      await request(app.getHttpServer())
        .patch('/api/v1/performance')
        .set(authHeader(csrToken))
        .expect(404);
    });

    const csrDeniedFeatureRoutes = [
      // `quote-recaps` is deliberately absent — the CSR now holds it (see the
      // note at the top of this block).
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
      // `performance` (PAC-10/11) and `leaderboard` (PAC-13) are real read-only
      // modules now, with no mutating handler at all, so neither can appear in
      // this list. `crm/service-tickets` is a real module (CrmModule) with its
      // own describe block too.
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

    // NOTE: the "read-only user can read a read-only page" test that lived here
    // moved into `Leaderboard / Motivation Hub (PAC-13)` below, where it now
    // asserts a real payload rather than a stub's `{status:'ready'}`.
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

  describe('Activity log (PAC-16)', () => {
    let ownLeadId: string;
    let foreignLeadId: string;
    let createdLeadIds: Types.ObjectId[] = [];

    beforeAll(async () => {
      const userModel = app.get<Model<User>>(getModelToken(User.name));
      const leadModel = app.get<Model<Lead>>(getModelToken(Lead.name));

      const producer = await userModel.findOne({ email: seed.producerEmail });
      const owner = await userModel.findOne({ email: seed.ownerEmail });
      const base = { agencyId: seed.agencyId, branchId: seed.branchId };

      const [own, foreign] = await leadModel.create([
        {
          ...base,
          firstName: 'Touchable',
          lastName: 'Lead',
          status: 'Contacted',
          temperature: 'Warm',
          producerId: producer!._id,
          lastActivityAt: new Date('2026-01-01T00:00:00.000Z'),
        },
        {
          ...base,
          firstName: 'Not',
          lastName: 'Yours',
          status: 'New',
          temperature: 'Warm',
          producerId: owner!._id,
        },
      ]);
      ownLeadId = own._id.toString();
      foreignLeadId = foreign._id.toString();
      createdLeadIds = [own._id, foreign._id];
    });

    // Same reason as the Hot Leads block: `Leads (PAC-36 list)` asserts exact
    // agency-wide totals and declares later.
    afterAll(async () => {
      const leadModel = app.get<Model<Lead>>(getModelToken(Lead.name));
      const activityModel = app.get<Model<Activity>>(
        getModelToken(Activity.name),
      );
      await activityModel.deleteMany({ leadId: { $in: createdLeadIds } });
      await leadModel.deleteMany({ _id: { $in: createdLeadIds } });
      createdLeadIds = [];
    });

    it('a producer logs a call on their own lead', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/activities')
        .set(authHeader(producerToken))
        .send({ leadId: ownLeadId, type: 'call' })
        .expect(201);

      const body = res.body as CreateActivityResponse;
      expect(body.activity.type).toBe('call');
      // Defaulted, because a call is an event that stands on its own.
      expect(body.activity.summary).toBe('Call logged');
      expect(body.leadLastActivityAt).toBeTruthy();
    });

    it('bumps the lead’s lastActivityAt', async () => {
      const leadModel = app.get<Model<Lead>>(getModelToken(Lead.name));

      await request(app.getHttpServer())
        .post('/api/v1/activities')
        .set(authHeader(producerToken))
        .send({ leadId: ownLeadId, type: 'text' })
        .expect(201);

      const lead = await leadModel.findById(ownLeadId);
      expect(lead?.lastActivityAt?.getTime()).toBeGreaterThan(
        new Date('2026-01-01T00:00:00.000Z').getTime(),
      );
    });

    it('a backdated touch does not drag lastActivityAt backwards', async () => {
      // `$max`, not `$set`. Otherwise logging a call you made last week would
      // float the lead to the top of a stalest-first panel.
      const leadModel = app.get<Model<Lead>>(getModelToken(Lead.name));
      const before = (await leadModel.findById(ownLeadId))?.lastActivityAt;

      await request(app.getHttpServer())
        .post('/api/v1/activities')
        .set(authHeader(producerToken))
        .send({
          leadId: ownLeadId,
          type: 'note',
          summary: 'Backdated note',
          occurredAt: '2020-01-01T00:00:00.000Z',
        })
        .expect(201);

      const after = (await leadModel.findById(ownLeadId))?.lastActivityAt;
      expect(after?.getTime()).toBe(before?.getTime());
    });

    it('marks the row as app-written, not migrated', async () => {
      // The schema default for `source` is `'migration'`, so an omission here
      // would label a producer's note as imported data.
      const activityModel = app.get<Model<Activity>>(
        getModelToken(Activity.name),
      );

      const res = await request(app.getHttpServer())
        .post('/api/v1/activities')
        .set(authHeader(producerToken))
        .send({ leadId: ownLeadId, type: 'email' })
        .expect(201);

      const { activity } = res.body as CreateActivityResponse;
      const row = await activityModel
        .findById(activity.id)
        .lean<{ source?: string; isTestRecord?: boolean } | null>();
      expect(row).not.toBeNull();
      expect(row?.source).toBe('internal');
      expect(row?.isTestRecord).toBe(false);
    });

    it('records the author as `userId`, with no stray `producerId`', async () => {
      /*
       * The guard for the PAC-65 rename. Two of the activity write paths take
       * an untyped bag — `migration.service.ts`'s `emit(key, doc)` and the demo
       * seed's `activity(ctx, key, fields)` — and Mongoose's `create()` accepts
       * excess keys, so a writer left on the old field name compiles clean and
       * silently persists a dead `producerId`. Nothing but a database read
       * catches that.
       */
      const activityModel = app.get<Model<Activity>>(
        getModelToken(Activity.name),
      );

      const res = await request(app.getHttpServer())
        .post('/api/v1/activities')
        .set(authHeader(producerToken))
        .send({ leadId: ownLeadId, type: 'call' })
        .expect(201);

      const { activity } = res.body as CreateActivityResponse;
      const row = await activityModel.findById(activity.id).lean();
      expect(row).not.toBeNull();
      expect(row).toHaveProperty('userId');
      expect(row).not.toHaveProperty('producerId');
    });

    it('surfaces the logged activity on the lead timeline', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/activities')
        .set(authHeader(producerToken))
        .send({ leadId: ownLeadId, type: 'note', summary: 'Spoke to spouse' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/leads/${ownLeadId}`)
        .set(authHeader(producerToken))
        .expect(200);

      const summaries = (res.body as LeadDetail).activities.map(
        (a) => a.summary,
      );
      expect(summaries).toContain('Spoke to spouse');
    });

    /*
     * The security-relevant one. `ACTIVITY_TYPES` is the read vocabulary and
     * includes `sold`; the write vocabulary must not. A client able to post a
     * `sold` row could invent a sale on the Sold scorecard and the Leaderboard.
     */
    it('refuses a system-generated type', async () => {
      for (const type of [
        'sold',
        'quoted',
        'lead_created',
        'audit_resolved',
        // The edit log (PAC-65 #9). A client able to post one could fabricate
        // an audit trail — or bury a real edit under noise.
        'field_changed',
      ]) {
        await request(app.getHttpServer())
          .post('/api/v1/activities')
          .set(authHeader(producerToken))
          .send({ leadId: ownLeadId, type })
          .expect(400);
      }
    });

    it('refuses a note with no text — a note IS its text', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/activities')
        .set(authHeader(producerToken))
        .send({ leadId: ownLeadId, type: 'note' })
        .expect(400);
    });

    it('404s on another producer’s lead, never 403', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/activities')
        .set(authHeader(producerToken))
        .send({ leadId: foreignLeadId, type: 'call' })
        .expect(404);
    });

    it('404s on a malformed lead id rather than 500', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/activities')
        .set(authHeader(producerToken))
        .send({ leadId: 'not-an-object-id', type: 'call' })
        .expect(404);
    });

    it('403s for a role without leads:write', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/activities')
        .set(authHeader(readOnlyToken))
        .send({ leadId: ownLeadId, type: 'call' })
        .expect(403);
    });
  });

  describe('Hot Leads (PAC-15)', () => {
    let staleHotLeadId: string;
    /*
     * Tracked so `afterAll` can remove exactly what this block created.
     *
     * Cleanup is mandatory here, not tidiness: `Leads (PAC-36 list)` asserts
     * exact agency-wide totals (`body.total).toBe(2)`), and this block declares
     * earlier, so leaving five extra leads behind fails five of its tests with
     * numbers that say nothing about the code.
     */
    let createdLeadIds: Types.ObjectId[] = [];

    afterAll(async () => {
      const leadModel = app.get<Model<Lead>>(getModelToken(Lead.name));
      const activityModel = app.get<Model<Activity>>(
        getModelToken(Activity.name),
      );
      await activityModel.deleteMany({ leadId: { $in: createdLeadIds } });
      await leadModel.deleteMany({ _id: { $in: createdLeadIds } });
      createdLeadIds = [];
    });

    beforeAll(async () => {
      const userModel = app.get<Model<User>>(getModelToken(User.name));
      const leadModel = app.get<Model<Lead>>(getModelToken(Lead.name));
      const activityModel = app.get<Model<Activity>>(
        getModelToken(Activity.name),
      );

      const producer = await userModel.findOne({ email: seed.producerEmail });
      const base = { agencyId: seed.agencyId, branchId: seed.branchId };
      const own = { ...base, producerId: producer!._id };

      const [stale, recent, warm, lost, foreign] = await leadModel.create([
        {
          ...own,
          firstName: 'Stale',
          lastName: 'Hotlead',
          status: 'Contacted',
          temperature: 'Hot',
          lastActivityAt: new Date('2026-01-01T00:00:00.000Z'),
          phones: ['5550001111'],
          emails: ['stale@example.test'],
        },
        {
          ...own,
          firstName: 'Recent',
          lastName: 'Hotlead',
          status: 'Quoted',
          temperature: 'Hot',
          lastActivityAt: new Date('2026-07-01T00:00:00.000Z'),
        },
        {
          ...own,
          firstName: 'Warm',
          lastName: 'Topup',
          status: 'New',
          temperature: 'Warm',
          lastActivityAt: new Date('2025-01-01T00:00:00.000Z'),
        },
        // Terminal: must never appear, however hot it was left. Stored as the
        // raw SmartSuite code for `Lost` so the code expansion is exercised.
        {
          ...own,
          firstName: 'Lost',
          lastName: 'Cause',
          status: 'jp76g',
          temperature: 'Hot',
          lastActivityAt: new Date('2020-01-01T00:00:00.000Z'),
        },
        // Another producer's hot lead: invisible under `own` scope.
        {
          ...base,
          firstName: 'Someone',
          lastName: 'Elses',
          status: 'New',
          temperature: 'Hot',
          lastActivityAt: new Date('2019-01-01T00:00:00.000Z'),
        },
      ]);
      staleHotLeadId = stale._id.toString();
      createdLeadIds = [stale, recent, warm, lost, foreign].map((l) => l._id);

      await activityModel.create([
        {
          ...base,
          leadId: stale._id,
          userId: producer!._id,
          type: 'note',
          subjectType: 'lead',
          summary: 'Waiting on premium approval',
          occurredAt: new Date('2026-01-01T00:00:00.000Z'),
          source: 'internal',
        },
        // Older, so it must lose to the note above.
        {
          ...base,
          leadId: stale._id,
          userId: producer!._id,
          type: 'lead_created',
          subjectType: 'lead',
          summary: 'Lead created',
          occurredAt: new Date('2025-12-01T00:00:00.000Z'),
          source: 'internal',
        },
      ]);
    });

    /*
     * The regression guard for the most likely way this route breaks.
     * `@Get(':id')` matches the literal string `hot` just as happily as an
     * ObjectId, so a reordering in the controller would turn this endpoint into
     * a lead-detail lookup for a lead that does not exist.
     */
    it('resolves as its own route, not as GET /leads/:id', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/leads/hot')
        .set(authHeader(producerToken))
        .expect(200);

      const body = res.body as HotLeadListResponse;
      expect(Array.isArray(body.items)).toBe(true);
      // A detail response would have `id`/`contact` at the top level instead.
      expect(body).not.toHaveProperty('id');
    });

    it('orders stalest first — the inverse of the Leads list', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/leads/hot')
        .set(authHeader(producerToken))
        .expect(200);

      const names = (res.body as HotLeadListResponse).items.map((i) => i.name);
      expect(names.indexOf('Stale Hotlead')).toBeLessThan(
        names.indexOf('Recent Hotlead'),
      );
    });

    it('ranks every Hot lead above any Warm one', async () => {
      // The Warm lead is staler than both Hot leads, so a single sort across
      // temperatures would float it to the top.
      const res = await request(app.getHttpServer())
        .get('/api/v1/leads/hot')
        .set(authHeader(producerToken))
        .expect(200);

      const items = (res.body as HotLeadListResponse).items;
      const firstWarm = items.findIndex((i) => i.temperature === 'Warm');
      const lastHot = items.map((i) => i.temperature).lastIndexOf('Hot');
      if (firstWarm !== -1) expect(lastHot).toBeLessThan(firstWarm);
    });

    it('carries the narrative line from the most recent activity', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/leads/hot')
        .set(authHeader(producerToken))
        .expect(200);

      const stale = (res.body as HotLeadListResponse).items.find(
        (i) => i.id === staleHotLeadId,
      );
      expect(stale?.lastActivitySummary).toBe('Waiting on premium approval');
      expect(stale?.lastActivityType).toBe('note');
      expect(stale?.initials).toBe('SH');
    });

    it('excludes terminal statuses, including migrated raw codes', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/leads/hot')
        .query({ limit: 25 })
        .set(authHeader(producerToken))
        .expect(200);

      const names = (res.body as HotLeadListResponse).items.map((i) => i.name);
      expect(names).not.toContain('Lost Cause');
    });

    it('clamps a producer to their own leads even when asking for agency', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/leads/hot')
        .query({ limit: 25, scope: 'agency' })
        .set(authHeader(producerToken))
        .expect(200);

      const names = (res.body as HotLeadListResponse).items.map((i) => i.name);
      expect(names).not.toContain('Someone Elses');
    });

    it('honours the limit', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/leads/hot')
        .query({ limit: 1 })
        .set(authHeader(producerToken))
        .expect(200);

      expect((res.body as HotLeadListResponse).items).toHaveLength(1);
    });

    it('is not the paginated envelope — this panel has no page controls', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/leads/hot')
        .set(authHeader(producerToken))
        .expect(200);

      for (const key of ['page', 'pageSize', 'total', 'totalPages']) {
        expect(res.body).not.toHaveProperty(key);
      }
    });

    it.each([
      ['a limit above the cap', { limit: 99 }],
      ['a zero limit', { limit: 0 }],
      ['an unknown temperature', { temperature: 'Lukewarm' }],
    ])('rejects %s with 400', async (_label, query) => {
      await request(app.getHttpServer())
        .get('/api/v1/leads/hot')
        .query(query)
        .set(authHeader(producerToken))
        .expect(400);
    });
  });

  describe('Leaderboard / Motivation Hub (PAC-13)', () => {
    /*
     * April 2026 — this block seeds its own deals rather than leaning on the
     * performance block's May fixtures. Sharing them would make these tests
     * pass only when both describes run, so any filtered run (`-t`) would
     * report failures that say nothing about the code.
     */
    const MONTH = '2026-04';

    beforeAll(async () => {
      const userModel = app.get<Model<User>>(getModelToken(User.name));
      const dealModel = app.get<Model<Deal>>(getModelToken(Deal.name));
      const goalModel = app.get<Model<ProducerGoal>>(
        getModelToken(ProducerGoal.name),
      );

      const producer = await userModel.findOne({ email: seed.producerEmail });
      const owner = await userModel.findOne({ email: seed.ownerEmail });
      const base = { agencyId: seed.agencyId, branchId: seed.branchId };

      await dealModel.create([
        {
          ...base,
          producerId: producer!._id,
          soldDateYmd: 20260410,
          premium: 2000,
          itemCount: 2,
        },
        {
          ...base,
          producerId: owner!._id,
          soldDateYmd: 20260415,
          premium: 77_777,
          itemCount: 9,
        },
        // Must not reach the office total.
        {
          ...base,
          producerId: producer!._id,
          soldDateYmd: 20260420,
          premium: 500_000,
          itemCount: 1,
          isTestRecord: true,
        },
        // Outside the month.
        {
          ...base,
          producerId: producer!._id,
          soldDateYmd: 20260331,
          premium: 400_000,
          itemCount: 1,
        },
      ]);

      await goalModel.create([
        // Producer sold 2,000 against 4,000 -> 50%.
        {
          agencyId: seed.agencyId,
          branchId: seed.branchId,
          producerId: producer!._id,
          month: MONTH,
          goalPremium: 4000,
        },
        // Owner sold 77,777 against 100,000 -> 77.8%, so they outrank the
        // producer on attainment despite a far larger goal.
        {
          agencyId: seed.agencyId,
          branchId: seed.branchId,
          producerId: owner!._id,
          month: MONTH,
          goalPremium: 100_000,
        },
      ]);
    });

    it('returns the office total, ranked entries, and the caller row', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/leaderboard')
        .query({ month: MONTH })
        .set(authHeader(producerToken))
        .expect(200);

      const body = res.body as LeaderboardResponse;
      expect(body.month).toBe(MONTH);
      expect(body.officeTotalPremium).toBe(2000 + 77_777);
      expect(body.entries.length).toBeGreaterThan(0);
      expect(body.self).not.toBeNull();
      expect(body.self!.premium).toBe(2000);
      expect(body.self!.attainmentPct).toBe(50);
    });

    it('a producer sees the whole board — the DataScope bypass is the feature', async () => {
      // `own` scope everywhere else means "your rows only". Here it must not:
      // a motivation panel showing a producer only themselves is pointless.
      const res = await request(app.getHttpServer())
        .get('/api/v1/leaderboard')
        .query({ month: MONTH })
        .set(authHeader(producerToken))
        .expect(200);

      const body = res.body as LeaderboardResponse;
      expect(body.entries.some((entry) => !entry.isSelf)).toBe(true);
      expect(body.producerCount).toBeGreaterThanOrEqual(2);
    });

    // The privacy contract, as an executable assertion. This is the reason the
    // bypass above is acceptable, so it must fail loudly if anyone widens the
    // response type.
    it('never exposes another producer’s dollars', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/leaderboard')
        .query({ month: MONTH })
        .set(authHeader(producerToken))
        .expect(200);

      const body = res.body as LeaderboardResponse;
      for (const entry of body.entries) {
        expect(entry).not.toHaveProperty('premium');
        expect(entry).not.toHaveProperty('goalPremium');
      }
    });

    it('ranks by attainment, not by premium', async () => {
      // The owner sold ~39x the producer's premium but hit 77.8% of a much
      // larger goal; the producer hit 50%. Ranking by premium would invert this.
      const res = await request(app.getHttpServer())
        .get('/api/v1/leaderboard')
        .query({ month: MONTH })
        .set(authHeader(ownerToken))
        .expect(200);

      const body = res.body as LeaderboardResponse;
      expect(body.entries[0].attainmentPct).toBe(77.8);
      expect(body.entries[0].rank).toBe(1);
      expect(body.entries[1].attainmentPct).toBe(50);
    });

    it('defaults to the current month when none is given', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/leaderboard')
        .set(authHeader(producerToken))
        .expect(200);

      expect((res.body as LeaderboardResponse).month).toMatch(
        /^\d{4}-(0[1-9]|1[0-2])$/,
      );
    });

    it('read-only user can read (read access does not imply write)', async () => {
      // Re-homed from the feature-stub block, which no longer has a leaderboard
      // route to point at.
      await request(app.getHttpServer())
        .get('/api/v1/leaderboard')
        .set(authHeader(readOnlyToken))
        .expect(200);
    });

    it.each([
      ['a malformed month', { month: '2026-5' }],
      ['a month out of range', { month: '2026-13' }],
      ['a limit above the cap', { limit: 99 }],
      ['a zero limit', { limit: 0 }],
    ])('rejects %s with 400', async (_label, query) => {
      await request(app.getHttpServer())
        .get('/api/v1/leaderboard')
        .query(query)
        .set(authHeader(producerToken))
        .expect(400);
    });

    it('has no mutating handler', async () => {
      await request(app.getHttpServer())
        .patch('/api/v1/leaderboard')
        .set(authHeader(ownerToken))
        .expect(404);
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

    it('scopes the policy picker to one household when asked', async () => {
      // Unfiltered, the picker offers both in-scope households' policies.
      const all = await request(app.getHttpServer())
        .get('/api/v1/policies/search?q=TEST-000')
        .set(authHeader(csrToken))
        .expect(200);
      const allIds = (all.body as { id: string }[]).map((p) => p.id);
      expect(allIds).toContain(seed.policyId);
      expect(allIds).toContain(seed.secondPolicyId);

      // Opened from a household page it must offer only that household's — the
      // other one is fully in scope, so only the filter can exclude it.
      const scoped = await request(app.getHttpServer())
        .get(
          `/api/v1/policies/search?q=TEST-000&householdId=${seed.householdId}`,
        )
        .set(authHeader(csrToken))
        .expect(200);
      expect((scoped.body as { id: string }[]).map((p) => p.id)).toEqual([
        seed.policyId,
      ]);
    });

    it('never widens to the whole book on a bad householdId', async () => {
      // Malformed: 400 from validation rather than an unfiltered list.
      await request(app.getHttpServer())
        .get('/api/v1/policies/search?householdId=not-an-id')
        .set(authHeader(csrToken))
        .expect(400);

      // Well-formed but another agency's: empty, not everything.
      const foreign = await request(app.getHttpServer())
        .get(
          `/api/v1/policies/search?householdId=${seed.otherAgencyHouseholdId}`,
        )
        .set(authHeader(csrToken))
        .expect(200);
      expect(foreign.body).toEqual([]);
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

    /**
     * PAC-56 #7 — the `HH-2614` identifier on the household.
     *
     * Pinned here because the failure mode is invisible in a single-request
     * test: a broken allocator still returns 201 and still writes *a* household,
     * it just hands two of them the same number. The concurrent case is the one
     * that matters — `$inc` is atomic, but the allocation runs inside the intake
     * transaction, so this is also what proves the write-conflict retries in
     * `withTransaction` resolve rather than duplicate.
     */
    it('gives each new household a distinct sequential reference, even concurrently', async () => {
      const first = await createAs(producerToken, payload('Ashgrove'));
      const firstLead = await leadModel.findById(first.id);
      const firstHousehold = await householdModel.findById(
        firstLead!.householdId,
      );
      expect(firstHousehold!.householdRef).toMatch(/^HH-[1-9][0-9]*$/);

      const created = await Promise.all(
        ['Bellhaven', 'Corrymore', 'Danecroft', 'Ellerslie', 'Fenwick'].map(
          (key) => createAs(producerToken, payload(key)),
        ),
      );

      const leads = await leadModel.find({
        _id: { $in: created.map((c) => c.id) },
      });
      const households = await householdModel.find({
        _id: { $in: leads.map((l) => l.householdId) },
      });

      expect(households).toHaveLength(5);
      const refs = households.map((h) => h.householdRef);
      expect(refs.every((ref) => /^HH-[1-9][0-9]*$/.test(ref ?? ''))).toBe(
        true,
      );
      // The assertion the whole feature rests on.
      expect(new Set(refs).size).toBe(refs.length);
      expect(refs).not.toContain(firstHousehold!.householdRef);
    });

    it('exposes the household reference on the lead detail contract', async () => {
      const created = await createAs(producerToken, payload('Gullhaven'));
      const res = await request(app.getHttpServer())
        .get(`/api/v1/leads/${created.id}`)
        .set(authHeader(producerToken))
        .expect(200);

      const household = (res.body as { household: { reference: string } })
        .household;
      // The card copies this string verbatim now, so it has to be the real
      // reference rather than anything derived from the ObjectId.
      expect(household.reference).toMatch(/^HH-[1-9][0-9]*$/);
      const stored = await householdModel.findOne({
        householdRef: household.reference,
      });
      expect(stored).not.toBeNull();
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
    it('stores the policies of interest with their item counts (PAC-56 #2)', async () => {
      const created = await createAs(
        producerToken,
        payload('Kelbrook', {
          policiesOfInterest: [
            { policyType: 'Auto', itemCount: 2 },
            { policyType: 'Umbrella', itemCount: 1 },
          ],
        }),
      );

      const lead = await leadModel.findById(created.id);
      expect(
        lead!.policiesOfInterest.map((p) => [p.policyType, p.itemCount]),
      ).toEqual([
        ['Auto', 2],
        ['Umbrella', 1],
      ]);
    });

    it('defaults the policies of interest to an empty array when omitted', async () => {
      // The web form requires a selection; the endpoint must not, or a partial
      // submission would 400 and the lead would be lost outright.
      const created = await createAs(producerToken, payload('Lanyon'));

      const lead = await leadModel.findById(created.id);
      expect(lead!.policiesOfInterest).toEqual([]);
    });

    it('rejects a policy type outside the canonical vocabulary', async () => {
      await createAs(
        producerToken,
        payload('Marlow', {
          policiesOfInterest: [{ policyType: 'Pet', itemCount: 1 }],
        }),
        400,
      );
    });

    it('unions the policies of interest when deduping onto an existing lead', async () => {
      const first = await createAs(
        producerToken,
        payload('Norbury', {
          quoteControlNumber: 'QCN-PAC56-1',
          policiesOfInterest: [{ policyType: 'Auto', itemCount: 1 }],
        }),
      );

      // Same QCN — signal 2 merges the second submission onto the first lead.
      const second = await createAs(
        producerToken,
        payload('Norbury', {
          quoteControlNumber: 'QCN-PAC56-1',
          policiesOfInterest: [
            // Restating Auto with a different count must NOT add a second row.
            { policyType: 'Auto', itemCount: 3 },
            { policyType: 'Umbrella', itemCount: 1 },
          ],
          address: {
            street: '9 Norbury Rise',
            city: 'Tulsa',
            state: 'OK',
            zip: '74109',
          },
        }),
      );

      expect(second.id).toBe(first.id);
      const lead = await leadModel.findById(first.id);
      // Additive: someone re-enquiring about a second line wants both quoted,
      // and the count already on file wins over the restatement.
      expect(
        lead!.policiesOfInterest.map((p) => [p.policyType, p.itemCount]),
      ).toEqual([
        ['Auto', 1],
        ['Umbrella', 1],
      ]);
    });

    it('keeps two same-type policies at different addresses distinct on merge', async () => {
      // Type alone stopped being an identity once the dwelling moved onto the
      // row (PAC-56 #14): a second Landlord policy on another building is a
      // second interest, not the first one restated.
      const landlord = (street: string) => ({
        policyType: 'Landlord',
        itemCount: 1,
        sameAsHousehold: false,
        propertyAddress: { street, city: 'Bixby', state: 'OK', zip: '74008' },
      });

      const first = await createAs(
        producerToken,
        payload('Trellis', {
          quoteControlNumber: 'QCN-PAC56-14',
          policiesOfInterest: [landlord('4 Rental Row')],
        }),
      );
      const second = await createAs(
        producerToken,
        payload('Trellis', {
          quoteControlNumber: 'QCN-PAC56-14',
          policiesOfInterest: [
            // Same building — collapses onto the row already on file.
            landlord('4 Rental Row'),
            landlord('88 Second Rental Ave'),
          ],
        }),
      );

      expect(second.id).toBe(first.id);
      const lead = await leadModel.findById(first.id);
      expect(
        lead!.policiesOfInterest.map((p) => p.propertyAddress?.street),
      ).toEqual(['4 Rental Row', '88 Second Rental Ave']);
    });

    it('copies the household address onto a same-as policy row (PAC-56 #6/#14)', async () => {
      const created = await createAs(
        producerToken,
        payload('Oakridge', {
          policiesOfInterest: [
            {
              policyType: 'Home',
              itemCount: 1,
              sameAsHousehold: true,
              // Discarded: a row cannot claim "same as household" and store
              // something else.
              propertyAddress: {
                street: '999 Elsewhere Ave',
                city: 'Broken Arrow',
                state: 'OK',
                zip: '74011',
              },
            },
          ],
        }),
      );

      const lead = await leadModel.findById(created.id);
      expect(lead!.policiesOfInterest[0].propertyAddress?.street).toBe(
        '77 Oakridge Lane',
      );
      expect(lead!.policiesOfInterest[0].sameAsHousehold).toBe(true);
      // The lead-level field is migration-only now and must stay unwritten.
      expect(lead!.propertyAddress).toBeUndefined();
    });

    it('gives each property policy its own address (PAC-56 #14)', async () => {
      // The case this ticket exists for: one household insuring the home they
      // live in AND a rental they let out.
      const created = await createAs(
        producerToken,
        payload('Pinehurst', {
          policiesOfInterest: [
            { policyType: 'Home', itemCount: 1, sameAsHousehold: true },
            {
              policyType: 'Landlord',
              itemCount: 2,
              sameAsHousehold: false,
              propertyAddress: {
                street: '4 Rental Row',
                city: 'Bixby',
                state: 'OK',
                zip: '74008',
              },
            },
          ],
        }),
      );

      const lead = await leadModel.findById(created.id);
      expect(
        lead!.policiesOfInterest.map((p) => [
          p.policyType,
          p.propertyAddress?.street,
        ]),
      ).toEqual([
        ['Home', '77 Pinehurst Lane'],
        ['Landlord', '4 Rental Row'],
      ]);
      // The living address is untouched — they are different places.
      expect(lead!.address?.street).toBe('77 Pinehurst Lane');
    });

    it('rejects a property policy with no address once same-as is cleared', async () => {
      await createAs(
        producerToken,
        payload('Quarry', {
          policiesOfInterest: [
            {
              policyType: 'Home',
              itemCount: 1,
              sameAsHousehold: false,
              propertyAddress: { street: '', city: '', state: '', zip: '' },
            },
          ],
        }),
        400,
      );
    });

    it('stores no property address for a non-property policy, even with same-as on', async () => {
      // `sameAsHousehold` DEFAULTS to true, so this is the regression guard: an
      // Auto-only lead must not silently acquire a copy of the living address.
      const created = await createAs(
        producerToken,
        payload('Ravenswood', {
          policiesOfInterest: [
            { policyType: 'Auto', itemCount: 1, sameAsHousehold: true },
          ],
        }),
      );

      const lead = await leadModel.findById(created.id);
      expect(lead!.policiesOfInterest[0].propertyAddress).toBeUndefined();
      expect(lead!.policiesOfInterest[0].sameAsHousehold).toBe(false);
      expect(lead!.propertyAddress).toBeUndefined();
    });

    it('stores no property address when policies of interest are not asked for', async () => {
      // The internal `/leads/new` form omits the section entirely — it never
      // asks what to quote. Nothing about a property must be inferred from that.
      const created = await createAs(producerToken, payload('Selby'));

      const lead = await leadModel.findById(created.id);
      expect(lead!.policiesOfInterest).toEqual([]);
      expect(lead!.propertyAddress).toBeUndefined();
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
        // `PYgez` is stored as the raw Quote Recaps choice code, to prove the
        // read path normalizes this field like every other policy type here.
        policiesOfInterest: [
          // No row address — the pre-PAC-56-#14 shape, which must still read.
          { policyType: 'PYgez', itemCount: 2 },
          {
            policyType: 'Home',
            itemCount: 1,
            propertyAddress: {
              street: '11 Insured Way',
              city: 'Jenks',
              state: 'OK',
              zip: '74037',
            },
            sameAsHousehold: false,
          },
        ],
        // The lead-level dwelling migrated records carry. Kept alongside the
        // row address above so one fixture exercises both read paths.
        propertyAddress: {
          street: '3 Legacy Lane',
          city: 'Jenks',
          state: 'OK',
          zip: '74037',
        },
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
          userId: producer!._id,
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
          userId: producer!._id,
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
          userId: producer!._id,
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
      // `PYgez` is the SmartSuite code for Auto — normalized on read. The
      // dwelling rides on the row that needs it (PAC-56 #14); a row without one
      // reads `null` rather than borrowing the lead's.
      expect(body.policiesOfInterest).toEqual([
        { policyType: 'Auto', itemCount: 2, propertyAddress: null },
        {
          policyType: 'Home',
          itemCount: 1,
          propertyAddress: {
            street: '11 Insured Way',
            city: 'Jenks',
            state: 'OK',
            zip: '74037',
          },
        },
      ]);
      // Still surfaced, for the migrated leads that only have this.
      expect(body.propertyAddress).toEqual({
        street: '3 Legacy Lane',
        city: 'Jenks',
        state: 'OK',
        zip: '74037',
      });
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

    it('returns every recap in full, newest first', async () => {
      const body = await getAs(producerToken, leadId);

      expect(body.latestQuoteRecap?.id).toBe(newerRecapId);
      expect(body.latestQuoteRecap?.premium).toBe(1872);
      // Stored as `['PYgez', 'sNMRK']`.
      expect(body.latestQuoteRecap?.productsQuoted).toEqual(['Auto', 'Home']);
      expect(body.latestQuoteRecap?.policies).toHaveLength(2);
      expect(body.latestQuoteRecap?.notes).toContain('multi-policy');

      /*
       * Earlier recaps used to be summary-shaped — a date, a status and a
       * total. That could not answer the only question the "N earlier recaps"
       * expander is opened to ask: *what changed between this quote and the one
       * before it?* Since PAC-56 #11 they carry the same full shape, so the
       * expander renders the identical body component (a handful of recaps per
       * lead, so the payload cost is negligible).
       */
      expect(body.earlierQuoteRecaps).toHaveLength(1);
      expect(body.earlierQuoteRecaps[0].id).toBe(olderRecapId);
      expect(body.earlierQuoteRecaps[0]).toHaveProperty('policies');
      expect(body.earlierQuoteRecaps[0]).toHaveProperty('notes');
      expect(body.earlierQuoteRecaps[0]).toHaveProperty('document');
      expect(body.earlierQuoteRecaps[0].policies[0].policyType).toBe('Auto');
    });

    it('exposes recap authorship for the notes block', async () => {
      // PAC-56 #13: a note rendered under system-derived totals is unreadable
      // without knowing a person wrote it, so the card needs an author and a
      // date. These fixtures are migration-shaped and carry no `producerId`,
      // which is exactly the case that must resolve to `null` rather than to a
      // placeholder — "Unknown" would read as a person's name.
      const body = await getAs(producerToken, leadId);

      expect(body.latestQuoteRecap).toHaveProperty('producerName');
      expect(body.latestQuoteRecap?.producerName).toBeNull();
      expect(body.latestQuoteRecap?.createdAt).toEqual(expect.any(String));
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

    it('returns the activity timeline newest-first with the author resolved', async () => {
      const body = await getAs(producerToken, leadId);

      expect(body.activities.map((a) => a.type)).toEqual([
        'sold',
        'quoted',
        'lead_created',
      ]);
      expect(body.activities[0].userName).toBeTruthy();
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

  /**
   * The Start Quote tie between a lead and its service ticket.
   *
   * The rule under test is that the two share one lifecycle: the ticket has no
   * status of its own, and the lead is the only thing that can end it. Both
   * halves are asserted — the refusal *and* the automatic resolution — because
   * either alone would leave the ticket in a state nobody can clear.
   */
  describe('Lead service tickets (Start Quote)', () => {
    let leadModel: Model<Lead>;

    const newLead = async (key: string) => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/leads')
        .set(authHeader(producerToken))
        .send({
          primaryContact: {
            firstName: 'Quinn',
            lastName: key,
            dateOfBirth: '1990-06-02',
            phone: '(555) 909-1010',
            email: `quinn.${key}@example.com`,
          },
          address: {
            street: `12 ${key} Way`,
            city: 'Tulsa',
            state: 'OK',
            zip: '74101',
          },
          members: [],
          leadSourceCode: 'WCO7l',
        })
        .expect(201);
      return res.body.id as string;
    };

    const openTicket = (token: string, id: string, expected = 201) =>
      request(app.getHttpServer())
        .post(`/api/v1/leads/${id}/service-ticket`)
        .set(authHeader(token))
        .expect(expected);

    beforeAll(() => {
      leadModel = app.get<Model<Lead>>(getModelToken(Lead.name));
    });

    it('opens a QTE- ticket linked to the lead and assigned to the caller', async () => {
      const leadId = await newLead('Ashby');
      const res = await openTicket(producerToken, leadId);

      expect(res.body.category).toBe('Quote');
      expect(res.body.ticketNumber).toMatch(/^QTE-/);
      expect(res.body.status).toBe('open');
      expect(res.body.resolvedAt).toBeNull();
      expect(res.body.leadId).toBe(leadId);
      expect(res.body.isStatusLocked).toBe(true);
      expect(res.body.assignedUserId).toBeTruthy();
      expect(res.body.timeline[0].type).toBe('created');
    });

    it('is idempotent — a second call returns the same ticket', async () => {
      const leadId = await newLead('Brixton');
      const first = await openTicket(producerToken, leadId);
      const second = await openTicket(producerToken, leadId);

      expect(second.body.id).toBe(first.body.id);
      expect(second.body.ticketNumber).toBe(first.body.ticketNumber);
    });

    it('refuses a manual status change on a lead-linked ticket (400)', async () => {
      const leadId = await newLead('Calder');
      const ticket = await openTicket(producerToken, leadId);

      // The owner holds `crm_service:write` and agency scope — the refusal is
      // the ticket's own rule, not a permission or scope miss.
      await request(app.getHttpServer())
        .patch(`/api/v1/crm/service-tickets/${ticket.body.id}/status`)
        .set(authHeader(ownerToken))
        .send({ status: 'resolved' })
        .expect(400);

      const after = await request(app.getHttpServer())
        .get(`/api/v1/crm/service-tickets/${ticket.body.id}`)
        .set(authHeader(ownerToken))
        .expect(200);
      expect(after.body.status).toBe('open');
      expect(after.body.resolvedAt).toBeNull();
    });

    it('a non-terminal lead status leaves the ticket open', async () => {
      const leadId = await newLead('Danby');
      const ticket = await openTicket(producerToken, leadId);

      await request(app.getHttpServer())
        .patch(`/api/v1/leads/${leadId}`)
        .set(authHeader(producerToken))
        .send({ status: 'Contacted' })
        .expect(200);

      const after = await request(app.getHttpServer())
        .get(`/api/v1/crm/service-tickets/${ticket.body.id}`)
        .set(authHeader(ownerToken))
        .expect(200);
      expect(after.body.status).toBe('open');
    });

    it.each(['Sold', 'Closed', 'Lost'])(
      'marking the lead %s resolves the ticket',
      async (status) => {
        const leadId = await newLead(`Everly${status}`);
        const ticket = await openTicket(producerToken, leadId);

        await request(app.getHttpServer())
          .patch(`/api/v1/leads/${leadId}`)
          .set(authHeader(producerToken))
          .send({ status })
          .expect(200);

        const after = await request(app.getHttpServer())
          .get(`/api/v1/crm/service-tickets/${ticket.body.id}`)
          .set(authHeader(ownerToken))
          .expect(200);

        expect(after.body.status).toBe('resolved');
        expect(after.body.resolvedAt).not.toBeNull();
        expect(
          after.body.timeline.some(
            (e: { type: string; content: string }) =>
              e.type === 'system' && e.content.includes(status),
          ),
        ).toBe(true);
      },
    );

    it('reports the lead status on the single-ticket read only', async () => {
      const leadId = await newLead('Fenwick');
      const ticket = await openTicket(producerToken, leadId);

      const one = await request(app.getHttpServer())
        .get(`/api/v1/crm/service-tickets/${ticket.body.id}`)
        .set(authHeader(ownerToken))
        .expect(200);
      expect(one.body.leadStatus).toBe('New');

      const list = await request(app.getHttpServer())
        .get('/api/v1/crm/service-tickets')
        .set(authHeader(ownerToken))
        .expect(200);
      const row = list.body.find(
        (t: { id: string }) => t.id === ticket.body.id,
      );
      expect(row.leadStatus).toBeNull();
      expect(row.isStatusLocked).toBe(true);
    });

    it('a ticket with no lead still accepts a manual status change', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/crm/service-tickets')
        .set(authHeader(ownerToken))
        .send({ clientName: 'Unlinked Client', category: 'Billing' })
        .expect(201);
      expect(created.body.isStatusLocked).toBe(false);
      expect(created.body.leadId).toBeNull();

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/crm/service-tickets/${created.body.id}/status`)
        .set(authHeader(ownerToken))
        .send({ status: 'resolved' })
        .expect(200);
      expect(res.body.status).toBe('resolved');
    });

    it("another producer's lead is a 404, and opens no ticket", async () => {
      const leadId = await newLead('Garrick');
      await leadModel.updateOne(
        { _id: leadId },
        { $set: { producerId: new Types.ObjectId() } },
      );

      await openTicket(producerToken, leadId, 404);
    });

    it('a read-only user is forbidden (403)', async () => {
      const leadId = await newLead('Halloway');
      await openTicket(readOnlyToken, leadId, 403);
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
      // Required on create since PAC-56 #16.
      insuranceRenewalMonth: 'March',
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
          policies: [
            {
              policyType: 'Home',
              premium: 800,
              itemCount: 1,
              sameAsHousehold: true,
              propertyAddress: {
                street: 'Somewhere Else',
                city: 'X',
                state: 'Y',
                zip: '00000',
              },
            },
          ],
        }),
      );

      const recap = await quoteRecapModel.findById(body.id);
      expect(recap!.policies[0].propertyAddress?.street).toBe('9 Quote Way');
      expect(recap!.policies[0].sameAsHousehold).toBe(true);
      // The recap-level field is pre-PAC-56-#14 only and must stay unwritten.
      expect(recap!.propertyAddress).toBeUndefined();
    });

    it('gives each quoted property policy its own address (PAC-56 #14)', async () => {
      // A home and a landlord policy are two buildings; one recap-level address
      // could only ever have named one of them.
      const producer = await userModel.findOne({ email: seed.producerEmail });
      const { lead } = await seedLead(producer!._id);
      upload(lead._id.toString());

      const body = await createAs(
        producerToken,
        payload(lead._id.toString(), {
          policies: [
            {
              policyType: 'Home',
              premium: 800,
              itemCount: 1,
              sameAsHousehold: true,
            },
            {
              policyType: 'Landlord',
              premium: 640,
              itemCount: 1,
              sameAsHousehold: false,
              propertyAddress: {
                street: '4 Rental Row',
                city: 'Bixby',
                state: 'OK',
                zip: '74008',
              },
            },
            // Non-property: gets no address even though same-as defaults on.
            { policyType: 'Auto', premium: 1200, itemCount: 2 },
          ],
        }),
      );

      const recap = await quoteRecapModel.findById(body.id);
      expect(
        recap!.policies.map((p) => [p.policyType, p.propertyAddress?.street]),
      ).toEqual([
        ['Home', '9 Quote Way'],
        ['Landlord', '4 Rental Row'],
        ['Auto', undefined],
      ]);
    });

    it('rejects a quoted property policy with no address once same-as is cleared', async () => {
      const producer = await userModel.findOne({ email: seed.producerEmail });
      const { lead } = await seedLead(producer!._id);
      upload(lead._id.toString());

      await createAs(
        producerToken,
        payload(lead._id.toString(), {
          policies: [
            {
              policyType: 'Landlord',
              premium: 640,
              itemCount: 1,
              sameAsHousehold: false,
              propertyAddress: { street: '', city: '', state: '', zip: '' },
            },
          ],
        }),
        400,
      );
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
      // The renewal month is required on create (PAC-56 #16) — and only the
      // twelve canonical labels are accepted, not SmartSuite's choice UUIDs,
      // for the same reason `policyType` rejects raw codes above.
      await createAs(
        producerToken,
        payload(id, { insuranceRenewalMonth: undefined }),
        400,
      );
      await createAs(
        producerToken,
        payload(id, {
          insuranceRenewalMonth: '0897f82f-de3a-4bbb-b973-c56bb1f4fecb',
        }),
        400,
      );
      // A property policy with no address and no "same as household".
      await createAs(
        producerToken,
        payload(id, {
          policies: [
            {
              policyType: 'Home',
              premium: 900,
              itemCount: 1,
              sameAsHousehold: false,
            },
          ],
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

    it('round-trips the renewal month through the edit view (PAC-56 #16)', async () => {
      const producer = await userModel.findOne({ email: seed.producerEmail });
      const { lead } = await seedLead(producer!._id);
      const id = lead._id.toString();
      upload(id);

      const created = await createAs(
        producerToken,
        payload(id, { insuranceRenewalMonth: 'September' }),
      );

      const view = await request(app.getHttpServer())
        .get(`/api/v1/quote-recaps/${created.id}`)
        .set(authHeader(producerToken))
        .expect(200);
      expect(
        (view.body as { insuranceRenewalMonth: string | null })
          .insuranceRenewalMonth,
      ).toBe('September');

      await request(app.getHttpServer())
        .patch(`/api/v1/quote-recaps/${created.id}`)
        .set(authHeader(producerToken))
        .send({ insuranceRenewalMonth: 'January' })
        .expect(200);

      const after = await request(app.getHttpServer())
        .get(`/api/v1/quote-recaps/${created.id}`)
        .set(authHeader(producerToken))
        .expect(200);
      expect(
        (after.body as { insuranceRenewalMonth: string | null })
          .insuranceRenewalMonth,
      ).toBe('January');
    });

    it('a recap with no renewal month is still editable (PAC-56 #16)', async () => {
      /*
       * The trap the create/patch asymmetry exists for. Every migrated recap
       * predates the field; if the patch DTO required it, all of them would be
       * un-saveable — and the failure would only show up against real migrated
       * data, not in development.
       */
      const producer = await userModel.findOne({ email: seed.producerEmail });
      const { lead, household } = await seedLead(producer!._id);
      const legacy = await quoteRecapModel.create({
        agencyId: seed.agencyId,
        branchId: seed.branchId,
        leadId: lead._id,
        householdId: household._id,
        producerId: producer!._id,
        premium: 900,
        itemCount: 1,
        productsQuoted: ['Auto'],
        policies: [{ policyType: 'Auto', premium: 900, itemCount: 1 }],
        // No `insuranceRenewalMonth` — exactly what the migration writes.
      });

      const view = await request(app.getHttpServer())
        .get(`/api/v1/quote-recaps/${String(legacy._id)}`)
        .set(authHeader(producerToken))
        .expect(200);
      expect(
        (view.body as { insuranceRenewalMonth: string | null })
          .insuranceRenewalMonth,
      ).toBeNull();

      await request(app.getHttpServer())
        .patch(`/api/v1/quote-recaps/${String(legacy._id)}`)
        .set(authHeader(producerToken))
        .send({ notes: 'Corrected the premium.' })
        .expect(200);
    });

    /*
     * PAC-65 #9 — every edit is logged, and the log is for owners and managers.
     *
     * The product owner was explicit that editing stays open (users complain
     * about friction) and that the answer to the transparency concern is a log
     * rather than a lock, with price changes the case he named. So the
     * behaviour under test is two-sided: the row must exist, and the producer
     * who made the edit must not be able to see it.
     */
    describe('edit log (PAC-65 #9)', () => {
      /** Edit a producer-owned recap's premium, and return its lead id. */
      const editPremium = async (): Promise<string> => {
        const producer = await userModel.findOne({ email: seed.producerEmail });
        const { lead } = await seedLead(producer!._id);
        const leadId = lead._id.toString();
        upload(leadId);

        const created = await createAs(producerToken, payload(leadId));
        await request(app.getHttpServer())
          .patch(`/api/v1/quote-recaps/${created.id}`)
          .set(authHeader(producerToken))
          .send({
            policies: [{ policyType: 'Auto', premium: 1400.5, itemCount: 2 }],
          })
          .expect(200);

        return leadId;
      };

      const timelineAs = async (token: string, leadId: string) => {
        const res = await request(app.getHttpServer())
          .get(`/api/v1/leads/${leadId}`)
          .set(authHeader(token))
          .expect(200);
        return (res.body as LeadDetail).activities;
      };

      it('records the premium change for a reader who holds the permission', async () => {
        const leadId = await editPremium();

        const row = (await timelineAs(ownerToken, leadId)).find(
          (activity) => activity.type === 'field_changed',
        );
        expect(row).toBeDefined();
        // Origin comes from the row's own `quoteRecapId`, so the chip already
        // says which record was edited — no new `ACTIVITY_ORIGINS` member.
        expect(row!.origin).toBe('quote_recap');

        const premium = row!.changes?.find((c) => c.field === 'premium');
        expect(premium).toBeDefined();
        expect(premium!.kind).toBe('currency');
        // Cents survive the round trip on both sides. Whole-dollar rounding
        // anywhere on this path turns a real correction into a row asserting
        // that nothing changed.
        expect(premium!.from).toBe(1200.1);
        expect(premium!.to).toBe(1400.5);
      });

      it('keeps the values out of `summary`', async () => {
        /*
         * `summary` is the one field that escapes the permission gate —
         * `HotLeadsService` renders the newest activity's summary onto the
         * producer's own dashboard. Keeping it value-free means a missed filter
         * degrades to a bland heading rather than leaking a premium.
         */
        const leadId = await editPremium();
        const row = (await timelineAs(ownerToken, leadId)).find(
          (activity) => activity.type === 'field_changed',
        );
        expect(row!.summary).toBe('Quote recap edited');
        expect(row!.summary).not.toMatch(/1400|1200|\$/);
      });

      it('hides the row from the producer who made the edit', async () => {
        const leadId = await editPremium();
        const types = (await timelineAs(producerToken, leadId)).map(
          (activity) => activity.type,
        );
        expect(types).not.toContain('field_changed');
      });

      it('hides the row from a reader with agency scope but no permission', async () => {
        // `readOnlyToken` holds every `{module}:read` and no `agency:*`, so this
        // is the assertion that proves the gate is permission-driven rather
        // than a side effect of data scope.
        const leadId = await editPremium();
        const types = (await timelineAs(readOnlyToken, leadId)).map(
          (activity) => activity.type,
        );
        expect(types).not.toContain('field_changed');
      });

      it("does not spend the producer's 50-row timeline budget", async () => {
        /*
         * The regression guard for filtering in the query rather than after
         * `.limit(ACTIVITY_LIMIT)`. A post-filter would let a burst of edits
         * push a producer's own notes out of the window entirely — the
         * timeline would go silently empty, which is a correctness bug rather
         * than a slow query.
         */
        const producer = await userModel.findOne({ email: seed.producerEmail });
        const { lead } = await seedLead(producer!._id);
        const leadId = lead._id.toString();
        upload(leadId);
        const created = await createAs(producerToken, payload(leadId));

        await request(app.getHttpServer())
          .post('/api/v1/activities')
          .set(authHeader(producerToken))
          .send({ leadId, type: 'note', summary: 'Call back Tuesday' })
          .expect(201);

        // Comfortably past ACTIVITY_LIMIT (50).
        for (let i = 0; i < 55; i += 1) {
          await request(app.getHttpServer())
            .patch(`/api/v1/quote-recaps/${created.id}`)
            .set(authHeader(producerToken))
            .send({ notes: `Revision ${i}` })
            .expect(200);
        }

        const summaries = (await timelineAs(producerToken, leadId)).map(
          (activity) => activity.summary,
        );
        expect(summaries).toContain('Call back Tuesday');
      });

      it('writes nothing when the patch changed no value', async () => {
        const producer = await userModel.findOne({ email: seed.producerEmail });
        const { lead } = await seedLead(producer!._id);
        const leadId = lead._id.toString();
        upload(leadId);
        const created = await createAs(
          producerToken,
          payload(leadId, { insuranceRenewalMonth: 'September' }),
        );

        await request(app.getHttpServer())
          .patch(`/api/v1/quote-recaps/${created.id}`)
          .set(authHeader(producerToken))
          .send({ insuranceRenewalMonth: 'September' })
          .expect(200);

        const types = (await timelineAs(ownerToken, leadId)).map(
          (activity) => activity.type,
        );
        expect(types).not.toContain('field_changed');
      });
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

    it('records the policies of interest submitted publicly (PAC-56 #2)', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/public/leads/${activeToken}`)
        .send({
          ...submission('Oyelaran'),
          policiesOfInterest: [
            { policyType: 'Home', itemCount: 1, sameAsHousehold: true },
            { policyType: 'Auto', itemCount: 2 },
          ],
        })
        .expect(201);

      const lead = await leadModel.findOne({ lastName: 'Oyelaran' });
      expect(
        lead!.policiesOfInterest.map((p) => [
          p.policyType,
          p.itemCount,
          p.propertyAddress?.street,
        ]),
      ).toEqual([
        // A Home row with "same as household" ticked resolves server-side; the
        // Auto row beside it gets no dwelling at all.
        ['Home', 1, '5 Oyelaran Street'],
        ['Auto', 2, undefined],
      ]);
    });

    it('rejects a public property policy with no address once same-as is cleared', async () => {
      // The public path runs the identical refinement — it is on the shared
      // policy row schema, not bolted onto the authenticated one.
      await request(app.getHttpServer())
        .post(`/api/v1/public/leads/${activeToken}`)
        .send({
          ...submission('Osei'),
          policiesOfInterest: [
            { policyType: 'Renters', itemCount: 1, sameAsHousehold: false },
          ],
        })
        .expect(400);

      expect(await leadModel.countDocuments({ lastName: 'Osei' })).toBe(0);
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
      fireSubscription: { selected: false },
      roofReceipt: { selected: false },
      acvPersonalProperty: false,
      acvDwellingProtection: false,
      drivewise: false,
      defensiveDriver: { selected: false, drivers: [] },
      studentDiscount: { selected: false },
      priorInsuranceDiscount: false,
    };

    /** A key under the NBA prefix, which `assertKeyOwnership` enforces (#23). */
    const nbaKey = (leadId: string) =>
      `agencies/${seed.agencyId}/sold-deals/${leadId}/nba/2026/application.pdf`;

    const uploadNba = (leadId: string) => {
      const key = nbaKey(leadId);
      uploaded.set(key, { size: 2048, contentType: 'application/pdf' });
      return {
        key,
        filename: 'application.pdf',
        contentType: 'application/pdf',
        size: 2048,
      };
    };

    /**
     * ⚠ `leadId` is required now: the new business application is per policy
     * and its key is lead-scoped (PAC-56 #23).
     */
    const policyWith = (
      leadId: string,
      overrides: Record<string, unknown> = {},
    ) => ({
      policyType: 'Auto',
      effectiveDate: '2026-02-01',
      carrier: 'Allstate',
      policyNumber: nextCard5Number(),
      premium: 500,
      itemCount: 1,
      newBusinessApplication: uploadNba(leadId),
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

    describe('carrier policy-number rules (PAC-56 #20)', () => {
      /*
       * ⚠ The rest of this suite passes only because the `carriers` collection
       * is **empty** under test — `seedTestData` does not run the core seed, so
       * `assertPolicyNumberFormats` short-circuits and every `C5-000001`-style
       * number sails through. That is a real coverage hole, so this block seeds
       * its own catalog rather than relying on the global one.
       */
      let carrierModel: Model<Carrier>;

      beforeAll(async () => {
        carrierModel = app.get<Model<Carrier>>(getModelToken(Carrier.name));
        await carrierModel.create([
          {
            agencyId: null,
            name: 'E2E Digits',
            slug: 'e2e-digits',
            active: true,
            policyNumberPattern: '\\d+',
            policyNumberHint: 'E2E Digits policy numbers are digits only.',
          },
          {
            agencyId: null,
            name: 'E2E Anything',
            slug: 'e2e-anything',
            active: true,
          },
        ]);
      });

      afterAll(async () => {
        await carrierModel.deleteMany({
          slug: { $in: ['e2e-digits', 'e2e-anything'] },
        });
      });

      it('rejects a number that violates its carrier’s pattern', async () => {
        const lead = await seedLead();
        const res = await post(
          {
            leadId: lead._id.toString(),
            soldDate: '2026-02-15',
            policies: [
              policyWith(lead._id.toString(), {
                carrier: 'E2E Digits',
                policyNumber: 'AB-123-456',
              }),
            ],
          },
          400,
        );
        const body = res.body as { message: string };
        // Names the policy and quotes the carrier's own hint — "invalid policy
        // number" on a five-policy sale tells a producer nothing.
        expect(body.message).toContain('Policy 1');
        expect(body.message).toContain('digits only');
      });

      it('accepts punctuation, because the rule is applied to the normalized key', async () => {
        const lead = await seedLead();
        await post({
          leadId: lead._id.toString(),
          soldDate: '2026-02-15',
          policies: [
            policyWith(lead._id.toString(), {
              carrier: 'E2E Digits',
              policyNumber: '123-456-789',
            }),
          ],
        });
      });

      it('leaves a carrier with no pattern unvalidated', async () => {
        const lead = await seedLead();
        await post({
          leadId: lead._id.toString(),
          soldDate: '2026-02-15',
          policies: [
            policyWith(lead._id.toString(), {
              carrier: 'E2E Anything',
              policyNumber: 'AB-123-456',
            }),
          ],
        });
      });

      it('leaves a carrier absent from the catalog unvalidated — the "Other" path', async () => {
        const lead = await seedLead();
        await post({
          leadId: lead._id.toString(),
          soldDate: '2026-02-15',
          policies: [
            policyWith(lead._id.toString(), {
              carrier: 'Some Regional Mutual',
              policyNumber: 'AB-123-456',
            }),
          ],
        });
      });

      it('rejects the client-side "Other" sentinel as a carrier name', async () => {
        const lead = await seedLead();
        await post(
          {
            leadId: lead._id.toString(),
            soldDate: '2026-02-15',
            policies: [
              policyWith(lead._id.toString(), { carrier: '__other__' }),
            ],
          },
          400,
        );
      });

      it('404s a foreign lead before it ever checks the format', async () => {
        // Ordering matters: a format error on someone else's lead would leak
        // that the lead exists.
        const owner = await app
          .get<Model<User>>(getModelToken(User.name))
          .findOne({ email: seed.ownerEmail });
        const household = await card5HouseholdModel.create({
          agencyId: seed.agencyId,
          branchId: seed.branchId,
          name: 'Foreign Household',
        });
        const foreign = await card5LeadModel.create({
          agencyId: seed.agencyId,
          branchId: seed.branchId,
          firstName: 'Foreign',
          lastName: 'Lead',
          status: 'Quoted',
          producerId: owner!._id,
          householdId: household._id,
        });

        await post(
          {
            leadId: foreign._id.toString(),
            soldDate: '2026-02-15',
            policies: [
              policyWith(foreign._id.toString(), {
                carrier: 'E2E Digits',
                policyNumber: 'AB-123',
              }),
            ],
          },
          404,
        );
      });
    });

    describe('new business application (PAC-56 #23)', () => {
      it('presigns it under its own prefix, so the kind is enforced by the key', async () => {
        // `presignSpy` captures the key the service asked storage to sign,
        // which is the thing that actually matters here.
        const lead = await seedLead();
        lastSignedKey = undefined;

        await request(app.getHttpServer())
          .post(PRESIGN)
          .set(authHeader(producerToken))
          .send({
            leadId: lead._id.toString(),
            kind: 'new_business_application',
            filename: 'application.pdf',
            contentType: 'application/pdf',
            size: 2048,
          })
          .expect(201);

        expect(lastSignedKey).toContain(
          `/sold-deals/${lead._id.toString()}/nba/`,
        );
      });

      it('keeps the discount-proof prefix byte-identical', async () => {
        // In-flight keys exist in every environment and the verification path
        // matches on this prefix — changing it would orphan them.
        const lead = await seedLead();
        lastSignedKey = undefined;

        await request(app.getHttpServer())
          .post(PRESIGN)
          .set(authHeader(producerToken))
          .send({
            leadId: lead._id.toString(),
            filename: 'proof.pdf',
            contentType: 'application/pdf',
            size: 2048,
          })
          .expect(201);

        expect(lastSignedKey).toContain(`/sold-deals/${lead._id.toString()}/`);
        expect(lastSignedKey).not.toContain('/nba/');
      });

      it('refuses to presign a non-PDF application', async () => {
        const lead = await seedLead();
        await request(app.getHttpServer())
          .post(PRESIGN)
          .set(authHeader(producerToken))
          .send({
            leadId: lead._id.toString(),
            kind: 'new_business_application',
            filename: 'application.png',
            contentType: 'image/png',
            size: 2048,
          })
          .expect(400);
      });

      it('rejects an image declared as the application, even if presigned as a proof', async () => {
        /*
         * The bypass the presign narrowing alone would not catch: presign a PNG
         * as a discount proof, then declare that key as the application. Two
         * independent gates stop it — the key sits under the wrong prefix, and
         * `HeadObject` reports `image/png` for a PDF-only slot.
         */
        const lead = await seedLead();
        const proofKey = keyFor(lead._id.toString());
        uploaded.set(proofKey, { size: 2048, contentType: 'image/png' });

        await post(
          {
            leadId: lead._id.toString(),
            soldDate: '2026-02-15',
            policies: [
              policyWith(lead._id.toString(), {
                newBusinessApplication: {
                  key: proofKey,
                  filename: 'application.png',
                  contentType: 'application/pdf',
                  size: 2048,
                },
              }),
            ],
          },
          400,
        );
      });

      it('requires one per policy', async () => {
        const lead = await seedLead();
        await post(
          {
            leadId: lead._id.toString(),
            soldDate: '2026-02-15',
            policies: [
              policyWith(lead._id.toString(), {
                newBusinessApplication: undefined,
              }),
            ],
          },
          400,
        );
      });

      it('persists it on the policy with a server-stamped uploadedAt', async () => {
        const lead = await seedLead();
        const application = uploadNba(lead._id.toString());

        const res = await post({
          leadId: lead._id.toString(),
          soldDate: '2026-02-15',
          policies: [
            policyWith(lead._id.toString(), {
              newBusinessApplication: application,
            }),
          ],
        });

        const dealId = new Types.ObjectId((res.body as { id: string }).id);
        const [policy] = await card5PolicyModel.find({ dealId });
        expect(policy.newBusinessApplication?.key).toBe(application.key);
        expect(policy.newBusinessApplication?.contentType).toBe(
          'application/pdf',
        );
        expect(policy.newBusinessApplication?.uploadedAt).toBeInstanceOf(Date);
      });
    });

    describe('the wizard gate (PAC-56 #17)', () => {
      const context = (leadId: string) =>
        request(app.getHttpServer())
          .get(`${SOLD}/context?leadId=${leadId}`)
          .set(authHeader(producerToken))
          .expect(200);

      it('reports no quote recap on a bare lead', async () => {
        const lead = await seedLead();
        const res = await context(lead._id.toString());
        expect((res.body as { hasQuoteRecap: boolean }).hasQuoteRecap).toBe(
          false,
        );
      });

      it('reports a recap linked by leadId', async () => {
        const lead = await seedLead();
        const recapModel = app.get<Model<QuoteRecap>>(
          getModelToken(QuoteRecap.name),
        );
        await recapModel.create({
          agencyId: seed.agencyId,
          branchId: seed.branchId,
          leadId: lead._id,
          premium: 100,
          itemCount: 1,
        });

        const res = await context(lead._id.toString());
        expect((res.body as { hasQuoteRecap: boolean }).hasQuoteRecap).toBe(
          true,
        );
      });

      it('reports a recap reachable only by legacyLeadId', async () => {
        /*
         * The trap. The migration links recaps to leads *only* by legacy id, so
         * a bare `{ leadId }` probe answers "no recap" for every migrated lead
         * — which would lock all of them out of the Sold wizard, and would only
         * show up against real migrated data.
         */
        const household = await card5HouseholdModel.create({
          agencyId: seed.agencyId,
          branchId: seed.branchId,
          name: 'Migrated Household',
        });
        const lead = await card5LeadModel.create({
          agencyId: seed.agencyId,
          branchId: seed.branchId,
          firstName: 'Morgan',
          lastName: 'Migrated',
          status: 'Quoted',
          producerId: card5ProducerId,
          householdId: household._id,
          legacySmartSuiteId: 'legacy-lead-pac56-17',
        });
        const recapModel = app.get<Model<QuoteRecap>>(
          getModelToken(QuoteRecap.name),
        );
        await recapModel.create({
          agencyId: seed.agencyId,
          branchId: seed.branchId,
          // No `leadId` — exactly what the migration writes.
          legacyLeadId: 'legacy-lead-pac56-17',
          premium: 100,
          itemCount: 1,
        });

        const res = await context(lead._id.toString());
        expect((res.body as { hasQuoteRecap: boolean }).hasQuoteRecap).toBe(
          true,
        );
      });

      it('still books a sale on an already-sold lead — the gate is UI-only', async () => {
        /*
         * Deliberate, and the reason the gate is not enforced server-side:
         * `AdvanceLeadStep` is idempotent so a `submissionToken` replay can
         * self-heal a create whose follow-up died. Rejecting a sold lead here
         * would trade that guarantee for a UI rule.
         */
        const lead = await seedLead();
        await card5LeadModel.updateOne(
          { _id: lead._id },
          { $set: { status: 'Sold' } },
        );

        await post({
          leadId: lead._id.toString(),
          soldDate: '2026-02-15',
          policies: [policyWith(lead._id.toString())],
        });
      });
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
            policyWith(lead._id.toString(), {
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
            policyWith(lead._id.toString(), {
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
          policyWith(lead._id.toString(), {
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
              // Required since PAC-56 #21, alongside the details.
              attachment: upload(lead._id.toString()),
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

    it('unions the discount selections into the deal audit triggers', async () => {
      const lead = await seedLead();
      // Every selected discount now needs its proof (PAC-56 #21), so the same
      // stub key stands in for all of them here.
      const proof = upload(lead._id.toString());
      const res = await post({
        leadId: lead._id.toString(),
        soldDate: '2026-02-15',
        policies: [
          policyWith(lead._id.toString(), {
            policyType: 'Auto',
            discounts: {
              ...EMPTY_DISCOUNTS,
              drivewise: true,
              defensiveDriver: {
                selected: true,
                // The same driver twice — one certificate, not two.
                drivers: [
                  { name: 'Dana Driver', attachment: proof },
                  { name: 'Sam Second', attachment: proof },
                  { name: 'Dana Driver', attachment: proof },
                ],
              },
            },
          }),
          policyWith(lead._id.toString(), {
            policyType: 'Home',
            discounts: { ...EMPTY_DISCOUNTS, acvDwellingProtection: true },
          }),
        ],
      });

      const dealId = new Types.ObjectId((res.body as { id: string }).id);
      const deal = await card5DealModel.findById(dealId);
      const triggers = deal!.auditTriggers;

      // Recorded as provenance — but it generates no audit item (PAC-65); that
      // is asserted in the generation suite, where the item models are in
      // scope. Kept here because the trigger continuing to be written is
      // exactly what would invite the generator line back.
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

    it('accepts every selected discount with no document (PAC-65)', async () => {
      /*
       * The exact inverse of PAC-56 #21, which 400'd all of these. David
       * reversed it on 08-13: ticking a box generates the audit item whether or
       * not a document came with it — "even if the details are provided, you're
       * still gonna audit it because we have to make sure." The upload only
       * decides whether the auditor verifies a file or calls the client.
       */
      const lead = await seedLead();
      const withDiscount = (
        discounts: Record<string, unknown>,
        policyType: string,
      ) => ({
        leadId: lead._id.toString(),
        soldDate: '2026-02-15',
        policies: [
          policyWith(lead._id.toString(), {
            policyType,
            discounts: { ...EMPTY_DISCOUNTS, ...discounts },
          }),
        ],
      });

      for (const [discounts, policyType] of [
        [{ studentDiscount: { selected: true } }, 'Auto'],
        [{ fireSubscription: { selected: true } }, 'Home'],
        [{ roofReceipt: { selected: true } }, 'Home'],
      ] as const) {
        await post(withDiscount(discounts, policyType));
      }
    });

    it('ignores a stale client still sending `inspection` (PAC-65)', async () => {
      // The key left the schema entirely. `z.object` strips unknown keys, so a
      // bundle from before the deploy degrades quietly instead of 400-ing.
      const lead = await seedLead();
      await post({
        leadId: lead._id.toString(),
        soldDate: '2026-02-15',
        policies: [
          policyWith(lead._id.toString(), {
            policyType: 'Home',
            discounts: {
              ...EMPTY_DISCOUNTS,
              inspection: { selected: true },
            },
          }),
        ],
      });
    });

    it('accepts a named driver with no certificate (PAC-65)', async () => {
      const lead = await seedLead();
      const attachment = upload(lead._id.toString());

      // One driver evidenced, one not — fine now. Both still get an audit item;
      // only one of them arrives with the document already attached.
      await post({
        leadId: lead._id.toString(),
        soldDate: '2026-02-15',
        policies: [
          policyWith(lead._id.toString(), {
            discounts: {
              ...EMPTY_DISCOUNTS,
              defensiveDriver: {
                selected: true,
                drivers: [
                  { name: 'Dana Driver', attachment },
                  { name: 'Sam Second' },
                ],
              },
            },
          }),
        ],
      });
    });

    it('still demands a named driver (PAC-65 kept this rule)', async () => {
      // Certificates became optional; naming the drivers did not. The generator
      // emits one item per name, so an unnamed selection produces a single item
      // nobody can act on.
      const lead = await seedLead();
      await post(
        {
          leadId: lead._id.toString(),
          soldDate: '2026-02-15',
          policies: [
            policyWith(lead._id.toString(), {
              discounts: {
                ...EMPTY_DISCOUNTS,
                defensiveDriver: { selected: true, drivers: [] },
              },
            }),
          ],
        },
        400,
      );
    });

    it('takes escrow details with no statement (PAC-65)', async () => {
      // The statement upload was removed outright. David: "the audit is going
      // to be based on the information" — these keyed-in fields are what the
      // `Home Mortgagee` item asks the service team to verify.
      const lead = await seedLead();
      await post({
        leadId: lead._id.toString(),
        soldDate: '2026-02-15',
        policies: [
          policyWith(lead._id.toString(), {
            policyType: 'Home',
            discounts: { ...EMPTY_DISCOUNTS, escrow: true },
            escrow: {
              loanNumber: 'LN-1',
              companyName: 'First National',
              address: {
                street: '1 Lender Way',
                city: 'Tulsa',
                state: 'Oklahoma',
                zip: '74101',
              },
            },
          }),
        ],
      });
    });

    it('still demands the escrow details themselves (PAC-65 kept this)', async () => {
      const lead = await seedLead();
      await post(
        {
          leadId: lead._id.toString(),
          soldDate: '2026-02-15',
          policies: [
            policyWith(lead._id.toString(), {
              policyType: 'Home',
              discounts: { ...EMPTY_DISCOUNTS, escrow: true },
            }),
          ],
        },
        400,
      );
    });

    it('rejects prior insurance claimed and denied at once (PAC-65 #18)', async () => {
      /*
       * The second cross-card invariant, alongside `none && cancelled`. David:
       * "if they select prior insurance, that top button should not be a
       * selection." The UI disables the toggle; this is the server saying so.
       *
       * ⚠ **Rejected, not stripped** — picking a winner would discard one of
       * two answers the producer gave, and neither is safe to drop: clearing
       * `none` invents prior coverage, clearing the discount loses the
       * declarations page and the item that chases it.
       */
      const lead = await seedLead();
      await post(
        {
          leadId: lead._id.toString(),
          soldDate: '2026-02-15',
          policies: [
            policyWith(lead._id.toString(), {
              discounts: { ...EMPTY_DISCOUNTS, priorInsuranceDiscount: true },
              priorInsurance: { none: true },
            }),
          ],
        },
        400,
      );
    });

    it('demands the declarations page when prior insurance is claimed (PAC-65 #18)', async () => {
      // ⚠ The one required upload on this form. Every Card 5 proof became
      // optional in the same ticket; this did not, because failing to supply it
      // in time gets the policy cancelled or repriced.
      const lead = await seedLead();
      await post(
        {
          leadId: lead._id.toString(),
          soldDate: '2026-02-15',
          policies: [
            policyWith(lead._id.toString(), {
              discounts: { ...EMPTY_DISCOUNTS, priorInsuranceDiscount: true },
              priorInsurance: {
                none: false,
                carrier: 'Geico',
                agentName: 'Jamie Prior',
              },
            }),
          ],
        },
        400,
      );
    });

    it('accepts a universal discount on a line that is neither branch (PAC-65)', async () => {
      // Umbrella is neither auto nor property, so before PAC-65 its discounts
      // card had nothing on it. `priorInsuranceDiscount` is in
      // `UNIVERSAL_DISCOUNT_KEYS`, so the cross-branch rule leaves it alone.
      const lead = await seedLead();
      const attachment = upload(lead._id.toString());
      await post({
        leadId: lead._id.toString(),
        soldDate: '2026-02-15',
        policies: [
          policyWith(lead._id.toString(), {
            policyType: 'Umbrella',
            discounts: { ...EMPTY_DISCOUNTS, priorInsuranceDiscount: true },
            priorInsurance: {
              none: false,
              carrier: 'Geico',
              agentName: 'Jamie Prior',
              attachment,
            },
          }),
        ],
      });
    });

    it('rejects a declarations page belonging to another agency (PAC-65)', async () => {
      /*
       * ⚠ The regression guard for the `collectAttachments` security boundary.
       *
       * `priorInsurance` has no `selected` key, so `isProofBacked`'s structural
       * sweep cannot see it — only an explicit line in `collectAttachments`
       * catches it, and `collectAttachments` is the *only* place
       * `assertKeyOwnership` runs on a sold upload. Miss it and this key is
       * never checked against the agency at all.
       */
      const lead = await seedLead();
      await post(
        {
          leadId: lead._id.toString(),
          soldDate: '2026-02-15',
          policies: [
            policyWith(lead._id.toString(), {
              discounts: { ...EMPTY_DISCOUNTS, priorInsuranceDiscount: true },
              priorInsurance: {
                none: false,
                carrier: 'Geico',
                agentName: 'Jamie Prior',
                attachment: {
                  key: 'agencies/000000000000000000000099/sold-deals/x/2026/dec.pdf',
                  filename: 'dec.pdf',
                  contentType: 'application/pdf',
                  size: 2048,
                },
              },
            }),
          ],
        },
        400,
      );
    });

    it('demands the prior agent and who cancelled it (PAC-65 #10/#11)', async () => {
      const lead = await seedLead();
      const attachment = upload(lead._id.toString());
      const withPrior = (priorInsurance: Record<string, unknown>, cancellation: Record<string, unknown>) => ({
        leadId: lead._id.toString(),
        soldDate: '2026-02-15',
        policies: [
          policyWith(lead._id.toString(), {
            discounts: { ...EMPTY_DISCOUNTS, priorInsuranceDiscount: true },
            priorInsurance: { none: false, carrier: 'Geico', attachment, ...priorInsurance },
            cancellation,
          }),
        ],
      });

      // No prior agent — the person the service team calls to chase all of this.
      await post(withPrior({}, { cancelled: false }), 400);
      // Cancelled, but nobody said by whom.
      await post(
        withPrior(
          { agentName: 'Jamie Prior' },
          { cancelled: true, effectiveDate: '2026-02-10' },
        ),
        400,
      );
      // "SFA staff" with no name is the answer that helps nobody.
      await post(
        withPrior(
          { agentName: 'Jamie Prior' },
          {
            cancelled: true,
            effectiveDate: '2026-02-10',
            cancelledBy: 'SFA staff',
          },
        ),
        400,
      );
      // ⚠ A staff id from another agency — unchecked, this field would be a
      // cross-agency write primitive, the trap `existingPolicyId` documents.
      await post(
        withPrior(
          { agentName: 'Jamie Prior' },
          {
            cancelled: true,
            effectiveDate: '2026-02-10',
            cancelledBy: 'SFA staff',
            cancelledByUserId: '000000000000000000000099',
          },
        ),
        400,
      );
    });

    it('rejects a property discount on an auto policy', async () => {
      // Cross-branch, using `roofReceipt` now that `inspection` is gone: a Home
      // discount on an Auto line would otherwise generate a property audit item
      // for a deal with no property line.
      const lead = await seedLead();
      const attachment = upload(lead._id.toString());
      await post(
        {
          leadId: lead._id.toString(),
          soldDate: '2026-02-15',
          policies: [
            policyWith(lead._id.toString(), {
              policyType: 'Auto',
              discounts: {
                ...EMPTY_DISCOUNTS,
                roofReceipt: { selected: true, attachment },
              },
            }),
          ],
        },
        400,
      );
    });

    it('accepts a selected discount once its proof is attached', async () => {
      const lead = await seedLead();
      const attachment = upload(lead._id.toString());

      await post({
        leadId: lead._id.toString(),
        soldDate: '2026-02-15',
        policies: [
          policyWith(lead._id.toString(), {
            policyType: 'Auto',
            discounts: {
              ...EMPTY_DISCOUNTS,
              studentDiscount: { selected: true, attachment },
            },
          }),
        ],
      });
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
          policyWith(lead._id.toString(), {
            discounts: {
              ...EMPTY_DISCOUNTS,
              // The client lies about the size; HeadObject is the evidence.
              studentDiscount: {
                selected: true,
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
            policyWith(lead._id.toString(), {
              discounts: {
                ...EMPTY_DISCOUNTS,
                studentDiscount: {
                  selected: true,
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
            policyWith(lead._id.toString(), {
              discounts: {
                ...EMPTY_DISCOUNTS,
                studentDiscount: {
                  selected: true,
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

    /**
     * The production vocabulary the generator resolves titles against.
     *
     * ⚠ Must track `CORE_AUDIT_TEMPLATES`. A title the generator asks for and
     * this list lacks is silently dropped (logged as "unresolved"), so a stale
     * fixture makes a real item look like it was never generated.
     *
     * `Prior Insurance` is deliberately **not** baseline here (PAC-65 #15): it
     * left `Common` *and* lost `alwaysInclude`, because `isBaselineTemplate`
     * matches either. `Drivewise` is kept in the catalog only to prove nothing
     * generates from it any more.
     */
    const TEMPLATES = [
      { name: 'Correct Sold Date', category: 'Common', alwaysInclude: true },
      { name: 'Prior Insurance', category: 'Prior Insurance' },
      { name: 'Drivers Verified', category: 'Auto' },
      { name: 'Defensive Driver', category: 'Auto' },
      { name: 'Good Student', category: 'Auto' },
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

    /** The new business application is required per policy since #23. */
    const genNba = (leadId: string) => {
      const key = `agencies/${seed.agencyId}/sold-deals/${leadId}/nba/2026/application.pdf`;
      genUploaded.set(key, { size: 2048, contentType: 'application/pdf' });
      return {
        key,
        filename: 'application.pdf',
        contentType: 'application/pdf',
        size: 2048,
      };
    };

    const autoPolicy = (
      leadId: string,
      overrides: Record<string, unknown> = {},
    ) => ({
      policyType: 'Auto',
      effectiveDate: '2026-02-01',
      carrier: 'Allstate',
      policyNumber: nextNum(),
      premium: 500,
      itemCount: 1,
      newBusinessApplication: genNba(leadId),
      priorInsurance: { none: true },
      cancellation: { cancelled: false },
      ...overrides,
    });

    /*
     * Every selected discount needs a proof since PAC-56 #21, and these tests
     * exist to exercise discount-driven generation — so this block needs its
     * own storage stub. Same approach as the Card 5 block, whose spy is
     * restored before this one runs.
     */
    const genUploaded = new Map<
      string,
      { size: number; contentType: string }
    >();
    let genStatSpy: jest.SpyInstance;

    const genProof = (leadId: string) => {
      const key = `agencies/${seed.agencyId}/sold-deals/${leadId}/2026/gen-proof.pdf`;
      genUploaded.set(key, { size: 2048, contentType: 'application/pdf' });
      return {
        key,
        filename: 'gen-proof.pdf',
        contentType: 'application/pdf',
        size: 2048,
      };
    };

    beforeAll(async () => {
      genStatSpy = jest
        .spyOn(app.get(StorageService), 'statObject')
        .mockImplementation((key: string) =>
          Promise.resolve(genUploaded.get(key) ?? null),
        );

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

    afterAll(() => {
      genStatSpy.mockRestore();
    });

    it('generates the baseline plus policy-type items for a simple sale', async () => {
      const { lead } = await seedLead();
      const deal = await sell(lead._id.toString(), [
        autoPolicy(lead._id.toString()),
      ]);

      expect(deal.auditItemCount).toBeGreaterThan(0);

      const items = await genItemModel.find({
        dealId: new Types.ObjectId(deal.id),
      });
      const names = items.map((i) => i.itemName);
      expect(names).toEqual(
        expect.arrayContaining(['Correct Sold Date', 'Drivers Verified']),
      );
      // No discounts were taken, so nothing discount-driven should appear.
      expect(names).not.toContain('Drivewise');
      // ⚠ `Prior Insurance` used to be here — it was baseline until PAC-65 #15
      // made it conditional on the discounts-card checkbox. A client with no
      // prior coverage no longer carries an item telling the service team to
      // obtain a declarations page that does not exist.
      expect(names).not.toContain('Prior Insurance');
    });

    it('creates the parent roll-up audit record', async () => {
      const { lead } = await seedLead();
      const deal = await sell(lead._id.toString(), [
        autoPolicy(lead._id.toString()),
      ]);

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
      const deal = await sell(lead._id.toString(), [
        autoPolicy(lead._id.toString()),
      ]);

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
      await sell(lead._id.toString(), [autoPolicy(lead._id.toString())]);

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

    it('carries the proof onto the generated audit item (PAC-56 #21b)', async () => {
      /*
       * The upload is optional as of PAC-65, but when there *is* one it has to
       * reach the item: otherwise the only person who needs it — the service
       * team on the audit board — never sees a document already in storage.
       *
       * ⚠ Uses `studentDiscount` → `Good Student`, not Drivewise. Drivewise
       * generates no item at all now, so the original fixture would find
       * nothing and pass for the wrong reason.
       */
      const { lead } = await seedLead();
      const attachment = genProof(lead._id.toString());
      const deal = await sell(lead._id.toString(), [
        autoPolicy(lead._id.toString(), {
          discounts: {
            escrow: false,
            fireSubscription: { selected: false },
            roofReceipt: { selected: false },
            acvPersonalProperty: false,
            acvDwellingProtection: false,
            drivewise: false,
            defensiveDriver: { selected: false, drivers: [] },
            studentDiscount: { selected: true, attachment },
            priorInsuranceDiscount: false,
          },
        }),
      ]);

      const item = await genItemModel.findOne({
        dealId: new Types.ObjectId(deal.id),
        title: 'Good Student',
      });

      expect(item).toBeTruthy();
      expect(item!.attachments).toHaveLength(1);
      expect(item!.attachments[0].key).toBe(attachment.key);
      expect(item!.attachments[0].filename).toBe('gen-proof.pdf');
      // ⚠ Still outstanding. A pre-attached document is evidence *for* the
      // auditor, not a resolution — flipping the status because a file exists
      // would delete the item from the hand-off board before anyone verified
      // it. This is the first thing someone will try to "fix".
      expect(item!.status).toBe('in_progress');
      expect(item!.isFailed).toBe(true);
      expect(item!.isResolved).toBe(false);
    });

    it('generates no Drivewise item, trigger or not (PAC-65)', async () => {
      /*
       * The only Card 5 option that produces nothing. It is a phone app that
       * monitors driving — there is no document that could prove enrolment, and
       * David asked that knowing it is on the policy be enough; the service
       * department works it from the renewal.
       *
       * ⚠ The trigger is still written to the deal as provenance, which is
       * exactly why this is asserted: the field's continued existence is what
       * would invite `if (triggers.drivewise) add('Drivewise')` back.
       */
      const { lead } = await seedLead();
      const deal = await sell(lead._id.toString(), [
        autoPolicy(lead._id.toString(), {
          discounts: {
            escrow: false,
            fireSubscription: { selected: false },
            roofReceipt: { selected: false },
            acvPersonalProperty: false,
            acvDwellingProtection: false,
            drivewise: true,
            defensiveDriver: { selected: false, drivers: [] },
            studentDiscount: { selected: false },
            priorInsuranceDiscount: false,
          },
        }),
      ]);

      const items = await genItemModel.countDocuments({
        dealId: new Types.ObjectId(deal.id),
        title: 'Drivewise',
      });
      expect(items).toBe(0);
    });

    it('generates Prior Insurance only when the discount was ticked (PAC-65 #15)', async () => {
      /*
       * It used to be baseline — on every deal, including clients who have
       * never held a policy, telling the service team to obtain a declarations
       * page that does not exist.
       *
       * ⚠ It took **two** changes to leave the baseline: `isBaselineTemplate`
       * matches `alwaysInclude === true` *or* a category of exactly `Common`.
       * Setting only the flag would look right and generate the item anyway.
       */
      const { lead: without } = await seedLead();
      const noPrior = await sell(without._id.toString(), [
        autoPolicy(without._id.toString()),
      ]);
      expect(
        await genItemModel.countDocuments({
          dealId: new Types.ObjectId(noPrior.id),
          title: 'Prior Insurance',
        }),
      ).toBe(0);

      const { lead: with_ } = await seedLead();
      const declarations = genProof(with_._id.toString());
      const withPrior = await sell(with_._id.toString(), [
        autoPolicy(with_._id.toString(), {
          discounts: {
            escrow: false,
            fireSubscription: { selected: false },
            roofReceipt: { selected: false },
            acvPersonalProperty: false,
            acvDwellingProtection: false,
            drivewise: false,
            defensiveDriver: { selected: false, drivers: [] },
            studentDiscount: { selected: false },
            priorInsuranceDiscount: true,
          },
          priorInsurance: {
            none: false,
            carrier: 'Geico',
            agentName: 'Jamie Prior',
            attachment: declarations,
          },
        }),
      ]);

      const item = await genItemModel.findOne({
        dealId: new Types.ObjectId(withPrior.id),
        title: 'Prior Insurance',
      });
      expect(item).toBeTruthy();
      // The declarations page rides onto it, so the auditor verifies in place.
      expect(item!.attachments[0]?.key).toBe(declarations.key);
    });

    it('stamps a soft 7-day due date, and enforces nothing (PAC-65)', async () => {
      const { lead } = await seedLead();
      const deal = await sell(lead._id.toString(), [
        autoPolicy(lead._id.toString()),
      ]);

      const item = await genItemModel.findOne({
        dealId: new Types.ObjectId(deal.id),
      });
      expect(item!.dueAt).toBeTruthy();
      const days = Math.round(
        (item!.dueAt!.getTime() - item!.firstCreatedAt!.getTime()) /
          (24 * 60 * 60 * 1000),
      );
      expect(days).toBe(7);

      /*
       * ⚠ The anti-enforcement guard. Backdate the deadline and confirm the
       * item is *unchanged*: nothing auto-fails, escalates, expires or flips
       * status at day 7. It is a written target the team filters on, and a
       * status that changes itself on a date is the wrong reading of it.
       */
      await genItemModel.updateOne(
        { _id: item!._id },
        { $set: { dueAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
      );
      await request(app.getHttpServer())
        .get(`${BOARD}?page=1&pageSize=50`)
        .set(authHeader(producerToken))
        .expect(200);

      const after = await genItemModel.findById(item!._id);
      expect(after!.status).toBe('in_progress');
      expect(after!.isFailed).toBe(true);
      expect(after!.isResolved).toBe(false);
    });

    it('surfaces evidence on the board without leaking the storage key (PAC-65 #16)', async () => {
      const { lead } = await seedLead();
      const attachment = genProof(lead._id.toString());
      await sell(lead._id.toString(), [
        autoPolicy(lead._id.toString(), {
          discounts: {
            escrow: false,
            fireSubscription: { selected: false },
            roofReceipt: { selected: false },
            acvPersonalProperty: false,
            acvDwellingProtection: false,
            drivewise: false,
            defensiveDriver: { selected: false, drivers: [] },
            studentDiscount: { selected: true, attachment },
            priorInsuranceDiscount: false,
          },
        }),
      ]);

      const res = await request(app.getHttpServer())
        .get(`${BOARD}?page=1&pageSize=50`)
        .set(authHeader(producerToken))
        .expect(200);

      const body = res.body as {
        items: Array<{
          missing: string;
          dueAt: string | null;
          attachments: Array<Record<string, unknown>>;
        }>;
      };
      const row = body.items.find((r) => r.missing === 'Good Student');
      expect(row).toBeTruthy();
      expect(row!.dueAt).toBeTruthy();
      expect(row!.attachments).toHaveLength(1);
      expect(row!.attachments[0].filename).toBe('gen-proof.pdf');
      expect(row!.attachments[0].index).toBe(0);
      // ⚠ The key's prefix is what `assertKeyOwnership` treats as a security
      // property. It must not leave the server; `index` is what the download
      // route takes and all the client needs.
      expect(row!.attachments[0]).not.toHaveProperty('key');
    });

    it('creates one certificate item per named defensive driver', async () => {
      const { lead } = await seedLead();
      const deal = await sell(lead._id.toString(), [
        autoPolicy(lead._id.toString(), {
          discounts: {
            escrow: false,
            fireSubscription: { selected: false },
            roofReceipt: { selected: false },
            acvPersonalProperty: false,
            acvDwellingProtection: false,
            drivewise: false,
            defensiveDriver: {
              selected: true,
              // A certificate each, since PAC-56 #21.
              drivers: [
                {
                  name: 'Dana Driver',
                  attachment: genProof(lead._id.toString()),
                },
                {
                  name: 'Sam Second',
                  attachment: genProof(lead._id.toString()),
                },
              ],
            },
            studentDiscount: { selected: false },
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
        autoPolicy(lead._id.toString(), {
          policyType: 'Home',
          discounts: {
            escrow: true,
            fireSubscription: { selected: false },
            roofReceipt: { selected: false },
            acvPersonalProperty: false,
            acvDwellingProtection: false,
            drivewise: false,
            defensiveDriver: { selected: false, drivers: [] },
            studentDiscount: { selected: false },
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
            attachment: genProof(lead._id.toString()),
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
      const policies = [autoPolicy(lead._id.toString())];

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
      const deal = await sell(lead._id.toString(), [
        autoPolicy(lead._id.toString()),
      ]);
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
      const dealOne = await sell(first.lead._id.toString(), [
        autoPolicy(first.lead._id.toString()),
      ]);
      expect(dealOne.crmAssigned).toBe(true);

      const second = await seedLead();
      await sell(second.lead._id.toString(), [
        autoPolicy(second.lead._id.toString()),
      ]);

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
      await sell(first.lead._id.toString(), [
        autoPolicy(first.lead._id.toString()),
      ]);
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

    /**
     * Object storage isn't running under test, so `statObject` reports only the
     * keys this block has "uploaded" — which since PAC-56 #23 is every policy's
     * new business application. Same approach as the Card 5 suite.
     */
    const soldUploaded = new Map<
      string,
      { size: number; contentType: string }
    >();
    let soldStatSpy: jest.SpyInstance;

    /** A key under the `/nba/` prefix, which `assertKeyOwnership` enforces. */
    const soldNba = (leadId: string) => {
      const key = `agencies/${seed.agencyId}/sold-deals/${leadId}/nba/2026/application.pdf`;
      soldUploaded.set(key, { size: 2048, contentType: 'application/pdf' });
      return {
        key,
        filename: 'application.pdf',
        contentType: 'application/pdf',
        size: 2048,
      };
    };

    /**
     * Stamps the required new business application onto every row that has not
     * declared one.
     *
     * Done here rather than in `soldPolicy` because the key is lead-scoped and
     * only `payload` knows the lead — and doing it in one place kept twenty-odd
     * call sites unchanged.
     */
    const withApplications = (
      leadId: string,
      policies: unknown,
    ): Record<string, unknown>[] =>
      (policies as Record<string, unknown>[]).map((row) => ({
        newBusinessApplication: soldNba(leadId),
        ...row,
      }));

    const payload = (
      leadId: string,
      overrides: Record<string, unknown> = {},
    ) => {
      const body = {
        leadId,
        soldDate: '2026-02-15',
        policies: [soldPolicy()],
        ...overrides,
      };
      return {
        ...body,
        policies: withApplications(leadId, body.policies),
      };
    };

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
      soldStatSpy = jest
        .spyOn(app.get(StorageService), 'statObject')
        .mockImplementation((key: string) =>
          Promise.resolve(soldUploaded.get(key) ?? null),
        );

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

    afterAll(() => {
      soldStatSpy.mockRestore();
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
              // `cancelledBy` is required alongside a cancellation (PAC-65 #11).
              cancellation: {
                cancelled: true,
                effectiveDate: '2026-01-31',
                cancelledBy: 'Customer',
              },
            }),
            soldPolicy({
              policyType: 'Home',
              // The prior agent is required now (PAC-65 #10).
              priorInsurance: {
                none: false,
                carrier: 'State Farm',
                agentName: 'H. Agent',
              },
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
        // No prior insurance, yet a cancellation (PAC-56 #24). Rejected rather
        // than stripped: `PriorInsuranceStep` filters to declared policies, so
        // stripping would drop a date the producer typed with no row to show
        // for it.
        {
          policies: [
            soldPolicy({
              priorInsurance: { none: true },
              cancellation: { cancelled: true, effectiveDate: '2026-01-01' },
            }),
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

    describe('deal roll-up recompute on PATCH /policies/:id (PAC-56 #25)', () => {
      const patchPolicy = (policyId: string, body: object, expected = 200) =>
        request(app.getHttpServer())
          .patch(`/api/v1/policies/${policyId}`)
          .set(authHeader(producerToken))
          .send(body)
          .expect(expected);

      it('moves the deal totals when a premium is corrected', async () => {
        const { lead } = await seedSoldLead(producerId);
        const created = await createAs(
          producerToken,
          payload(lead._id.toString(), {
            policies: [
              soldPolicy({ premium: 1000, itemCount: 2 }),
              soldPolicy({ policyType: 'Home', premium: 500, itemCount: 1 }),
            ],
          }),
        );
        expect(created.premium).toBe(1500);

        const policies = await soldPolicyModel
          .find({ dealId: dealRef(created.id) })
          .sort({ premium: -1 });
        await patchPolicy(policies[0]._id.toString(), { premium: 1250.5 });

        const deal = await soldDealModel.findById(created.id);
        expect(deal!.premium).toBe(1750.5);
        expect(deal!.itemCount).toBe(3);
        expect(deal!.policyCount).toBe(2);
      });

      it('never moves soldDateYmd — the Sold scorecard buckets on it', async () => {
        const { lead } = await seedSoldLead(producerId);
        const created = await createAs(
          producerToken,
          payload(lead._id.toString(), {
            policies: [soldPolicy({ premium: 400, itemCount: 1 })],
          }),
        );
        const before = await soldDealModel.findById(created.id);

        const policy = await soldPolicyModel.findOne({
          dealId: dealRef(created.id),
        });
        await patchPolicy(policy!._id.toString(), { premium: 900 });

        const after = await soldDealModel.findById(created.id);
        expect(after!.premium).toBe(900);
        // A Thursday correction must not re-date a Monday sale.
        expect(after!.soldDateYmd).toBe(before!.soldDateYmd);
        expect(after!.soldDate?.toISOString()).toBe(
          before!.soldDate?.toISOString(),
        );
      });

      it('leaves a migrated deal alone', async () => {
        /*
         * The data-integrity guard. A migrated deal's premium is SmartSuite's
         * rollup over rows we may hold only part of, so recomputing would
         * silently overwrite a historical figure with the imported subset —
         * from a page whose button says "quick edit".
         */
        const migrated = await soldDealModel.create({
          agencyId: seed.agencyId,
          branchId: seed.branchId,
          producerId,
          premium: 9999,
          itemCount: 42,
          policyCount: 7,
          // What the migration writes; the app writes 'snapshot'.
          premiumSource: 'rollup',
          legacySmartSuiteId: 'legacy-deal-pac56-25',
        });
        const policy = await soldPolicyModel.create({
          agencyId: seed.agencyId,
          branchId: seed.branchId,
          policyNumber: nextNumber(),
          policyType: 'Auto',
          premium: 100,
          items: 1,
          dealId: migrated._id,
        });

        await patchPolicy(policy._id.toString(), { premium: 250 });

        const after = await soldDealModel.findById(migrated._id);
        expect(after!.premium).toBe(9999);
        expect(after!.itemCount).toBe(42);
        expect(after!.policyCount).toBe(7);
      });

      it('leaves a deal-less policy alone rather than erroring', async () => {
        const orphan = await soldPolicyModel.create({
          agencyId: seed.agencyId,
          branchId: seed.branchId,
          policyNumber: nextNumber(),
          policyType: 'Auto',
          premium: 100,
          items: 1,
        });
        // No `dealId`, so nothing to roll up. Under `own` scope a policy with
        // no deal is unattributable and 404s — which is the correct answer, and
        // is what this pins.
        await patchPolicy(orphan._id.toString(), { premium: 250 }, 404);
      });
    });
  });

  /**
   * Policy Transfer — the Sold pipeline, minus the lead, booked as company
   * transfer.
   *
   * Two things are load-bearing enough to be worth stating: the from-policy is
   * *retired* rather than edited (both rows survive, linked), and the premium
   * must land on the Transfers scorecard **without** moving Sold. The
   * absent-`businessType` case below is the guard for the one mistake that
   * would silently zero every historic sale.
   */
  describe('Policy transfers (company transfer)', () => {
    const TICKETS = '/api/v1/crm/service-tickets';

    let xferDealModel: Model<Deal>;
    let xferPolicyModel: Model<Policy>;
    let xferHouseholdModel: Model<Household>;
    let statSpy: jest.SpyInstance;

    const uploaded = new Map<string, { size: number; contentType: string }>();
    let counter = 0;
    const nextNumber = () =>
      `XFER-${(counter += 1).toString().padStart(6, '0')}`;

    /** A key under the transfer's own `/nba/` prefix, which the server enforces. */
    const nba = (householdId: string) => {
      const key = `agencies/${seed.agencyId}/policy-transfers/${householdId}/nba/app.pdf`;
      uploaded.set(key, { size: 2048, contentType: 'application/pdf' });
      return {
        key,
        filename: 'app.pdf',
        contentType: 'application/pdf',
        size: 2048,
      };
    };

    /** A household with one active policy — the thing a transfer moves within. */
    const makeHousehold = async (premium = 1400) => {
      const household = await xferHouseholdModel.create({
        agencyId: seed.agencyId,
        branchId: seed.branchId,
        name: `Transfer HH ${counter}`,
        totalActivePolicies: 1,
      });
      const policy = await xferPolicyModel.create({
        agencyId: seed.agencyId,
        branchId: seed.branchId,
        householdId: household._id,
        policyNumber: nextNumber(),
        policyType: 'Auto',
        premium,
        items: 1,
        active: true,
        policyStatus: 'Active',
      });
      return { household, policy };
    };

    const makeTicket = async (
      householdId: string,
      category = 'Policy Change',
    ) => {
      const res = await request(app.getHttpServer())
        .post(TICKETS)
        .set(authHeader(csrToken))
        .send({ clientName: 'Transfer Client', category, householdId })
        .expect(201);
      return res.body as { id: string };
    };

    const transferBody = (
      householdId: string,
      fromPolicyId: string,
      overrides: Record<string, unknown> = {},
    ) => ({
      transferDate: '2026-03-10',
      policies: [
        {
          fromPolicyId,
          policyType: 'Auto',
          effectiveDate: '2026-03-15',
          carrier: 'Allstate',
          policyNumber: nextNumber(),
          premium: 900,
          itemCount: 1,
          newBusinessApplication: nba(householdId),
        },
      ],
      ...overrides,
    });

    const record = (ticketId: string, body: unknown, expected = 201) =>
      request(app.getHttpServer())
        .post(`${TICKETS}/${ticketId}/policy-transfer`)
        .set(authHeader(csrToken))
        .send(body)
        .expect(expected);

    beforeAll(() => {
      xferDealModel = app.get<Model<Deal>>(getModelToken(Deal.name));
      xferPolicyModel = app.get<Model<Policy>>(getModelToken(Policy.name));
      xferHouseholdModel = app.get<Model<Household>>(
        getModelToken(Household.name),
      );
      // Storage isn't running under test; report only what this block declared.
      const storage = app.get(StorageService);
      statSpy = jest
        .spyOn(storage, 'statObject')
        .mockImplementation((key: string) =>
          Promise.resolve(uploaded.get(key) ?? null),
        );
    });

    afterAll(() => statSpy?.mockRestore());

    it.each(['Renewal Review', 'Policy Change', 'Payment', 'Company Transfer'])(
      'records a transfer from a %s ticket',
      async (category) => {
        const { household, policy } = await makeHousehold();
        const ticket = await makeTicket(String(household._id), category);

        const res = await record(
          ticket.id,
          transferBody(String(household._id), String(policy._id)),
        );

        expect(res.body.policyTransfer).not.toBeNull();
        expect(res.body.policyTransfer.pairs).toHaveLength(1);
        expect(res.body.policyTransfer.pairs[0].fromPolicyId).toBe(
          String(policy._id),
        );
        expect(res.body.allowsPolicyTransfer).toBe(true);
      },
    );

    it('is refused from a category that does not allow it', async () => {
      const { household, policy } = await makeHousehold();
      const ticket = await makeTicket(String(household._id), 'Billing');

      await record(
        ticket.id,
        transferBody(String(household._id), String(policy._id)),
        400,
      );
      expect(
        await xferDealModel.countDocuments({
          ticketId: new Types.ObjectId(ticket.id),
        }),
      ).toBe(0);
    });

    it('retires the old policy and links both ways', async () => {
      const { household, policy } = await makeHousehold();
      const ticket = await makeTicket(String(household._id));

      const res = await record(
        ticket.id,
        transferBody(String(household._id), String(policy._id)),
      );

      const from = await xferPolicyModel.findById(policy._id);
      expect(from!.active).toBe(false);
      expect(from!.policyStatus).toBe('Cancelled');

      const toId = res.body.policyTransfer.pairs[0].toPolicyId;
      expect(String(from!.transferredToPolicyId)).toBe(toId);

      const to = await xferPolicyModel.findById(toId);
      expect(to!.active).toBe(true);
      expect(String(to!.transferredFromPolicyId)).toBe(String(policy._id));
    });

    it('books a company-transfer deal with no lead', async () => {
      const { household, policy } = await makeHousehold();
      const ticket = await makeTicket(String(household._id));

      const res = await record(
        ticket.id,
        transferBody(String(household._id), String(policy._id)),
      );

      const deal = await xferDealModel.findById(
        res.body.policyTransfer.dealId as string,
      );
      expect(deal!.businessType).toBe('company_transfer');
      expect(deal!.leadId ?? null).toBeNull();
      expect(String(deal!.ticketId)).toBe(ticket.id);
    });

    it('recomputes the household active-policy count', async () => {
      const { household, policy } = await makeHousehold();
      const ticket = await makeTicket(String(household._id));

      await record(
        ticket.id,
        transferBody(String(household._id), String(policy._id)),
      );

      // One retired, one activated — still one, but recounted rather than
      // assumed, which is what makes a re-run correct too.
      const after = await xferHouseholdModel.findById(household._id);
      expect(after!.totalActivePolicies).toBe(1);
    });

    it('allows only one transfer per ticket', async () => {
      const { household, policy } = await makeHousehold();
      const ticket = await makeTicket(String(household._id));

      await record(
        ticket.id,
        transferBody(String(household._id), String(policy._id)),
      );
      await record(
        ticket.id,
        transferBody(String(household._id), String(policy._id)),
        409,
      );
    });

    it('refuses a from-policy on another household, and writes nothing', async () => {
      const { household } = await makeHousehold();
      const other = await makeHousehold();
      const ticket = await makeTicket(String(household._id));

      await record(
        ticket.id,
        transferBody(String(household._id), String(other.policy._id)),
        400,
      );

      const untouched = await xferPolicyModel.findById(other.policy._id);
      expect(untouched!.active).toBe(true);
      expect(
        await xferDealModel.countDocuments({
          ticketId: new Types.ObjectId(ticket.id),
        }),
      ).toBe(0);
    });

    it('logs the transfer on the ticket timeline', async () => {
      const { household, policy } = await makeHousehold();
      const ticket = await makeTicket(String(household._id));

      const res = await record(
        ticket.id,
        transferBody(String(household._id), String(policy._id)),
      );

      expect(
        (res.body.timeline as { type: string; content: string }[]).some(
          (e) => e.type === 'system' && e.content.includes('Policy transfer'),
        ),
      ).toBe(true);
    });

    /* ─── The reporting split ─────────────────────────────────────────────── */

    describe('scorecard split', () => {
      const PERFORMANCE = '/api/v1/performance';

      const performance = async (token: string) => {
        const res = await request(app.getHttpServer())
          .get(`${PERFORMANCE}?range=custom&from=2026-03-01&to=2026-03-31`)
          .set(authHeader(token))
          .expect(200);
        return res.body as {
          sold: { premium: number };
          transfers: { premium: number };
        };
      };

      it('counts the transfer under transfers, never under sold', async () => {
        const before = await performance(ownerToken);

        const { household, policy } = await makeHousehold();
        const ticket = await makeTicket(String(household._id));
        await record(
          ticket.id,
          transferBody(String(household._id), String(policy._id)),
        );

        const after = await performance(ownerToken);
        expect(after.transfers.premium).toBeCloseTo(
          before.transfers.premium + 900,
          2,
        );
        expect(after.sold.premium).toBeCloseTo(before.sold.premium, 2);
      });

      /**
       * The regression guard for the one mistake that breaks existing
       * reporting.
       *
       * Every deal written before `businessType` existed has **no such field**
       * — a Mongoose default applies on write, never to stored documents. A
       * read filtering on `businessType: 'new_business'` would therefore match
       * none of them and report $0 sold. Absent must count as new business,
       * which is what `NEW_BUSINESS_MATCH`'s `$ne` does.
       */
      it('still counts a deal that has no businessType field at all', async () => {
        const before = await performance(ownerToken);

        // Inserted through the driver so no Mongoose default is applied — this
        // is exactly the shape of every pre-existing row.
        await xferDealModel.collection.insertOne({
          agencyId: seed.agencyId,
          branchId: seed.branchId,
          premium: 777,
          itemCount: 1,
          policyCount: 1,
          soldDateYmd: 20260310,
          soldDate: new Date('2026-03-10T00:00:00.000Z'),
          isTestRecord: false,
        });

        const after = await performance(ownerToken);
        expect(after.sold.premium).toBeCloseTo(before.sold.premium + 777, 2);
        expect(after.transfers.premium).toBeCloseTo(
          before.transfers.premium,
          2,
        );
      });
    });

    it('keeps transfers off the producer leaderboard', async () => {
      const month = '2026-03';
      const read = async () => {
        const res = await request(app.getHttpServer())
          .get(`/api/v1/leaderboard?month=${month}`)
          .set(authHeader(ownerToken))
          .expect(200);
        return res.body as { officeTotalPremium: number };
      };

      const before = await read();

      const { household, policy } = await makeHousehold();
      const ticket = await makeTicket(String(household._id));
      await record(
        ticket.id,
        transferBody(String(household._id), String(policy._id)),
      );

      expect((await read()).officeTotalPremium).toBeCloseTo(
        before.officeTotalPremium,
        2,
      );
    });
  });
});
