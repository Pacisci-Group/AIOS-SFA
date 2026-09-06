import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { ModuleKey } from '@sfa/shared';
import { AppModule } from '../src/app.module';
import { AuditTemplate } from '../src/audit-templates/schemas/audit-template.schema';
import { Branch } from '../src/branches/schemas/branch.schema';
import { InngestService } from '../src/inngest/inngest.service';
import { RoleAssignmentsService } from '../src/permissions/role-assignments.service';
import { RolePermission } from '../src/permissions/schemas/role-permission.schema';
import { UserRole } from '../src/permissions/schemas/user-role.schema';
import { Agency } from '../src/platform/schemas/agency.schema';
import { AgencyRole } from '../src/roles/schemas/agency-role.schema';
import { User } from '../src/users/schemas/user.schema';
import { dropTestDatabase, closeTestApp } from './helpers/test-app';
import {
  seedTestData,
  TEST_PASSWORD,
  TestSeedContext,
} from './helpers/seed-test-data';

/**
 * Agency onboarding, end to end (PAC-69).
 *
 * Its own app rather than a block in `api.e2e-spec.ts` because two of the cases
 * need to make things fail on purpose — a stranded Inngest send, and a mid-
 * sequence throw — and doing that to the shared app would leak into every suite
 * that follows.
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

interface OnboardResponseBody {
  agency: { id: string; name: string; slug: string };
  branch: { id: string; name: string };
  owner: {
    userId: string;
    email: string;
    inviteUrl: string;
    expiresAt: string;
    emailStatus: string;
    inviteToken?: string;
  };
}

describe('Agency onboarding (e2e)', () => {
  let app: INestApplication<App>;
  let inngest: CaptureInngestService;
  let ctx: TestSeedContext;
  let adminToken: string;

  let agencies: Model<Agency>;
  let branches: Model<Branch>;
  let roles: Model<AgencyRole>;
  let rolePermissions: Model<RolePermission>;
  let userRoles: Model<UserRole>;
  let auditTemplates: Model<AuditTemplate>;
  let users: Model<User>;

  let seq = 0;
  const freshSlug = () => `onboard-${Date.now()}-${++seq}`;

  const body = (slug: string, overrides: Record<string, unknown> = {}) => ({
    agency: { name: `Agency ${slug}`, slug },
    branch: {
      name: 'Main',
      address: {
        street: '1 Main St',
        city: 'Austin',
        state: 'TX',
        zip: '78701',
      },
    },
    modules: [ModuleKey.Dashboard, ModuleKey.Leads],
    owner: {
      firstName: 'Ada',
      lastName: 'Owner',
      email: `${slug}@example.com`,
    },
    ...overrides,
  });

  const onboard = (payload: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/api/v1/platform/agencies')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(payload);

  beforeAll(async () => {
    inngest = new CaptureInngestService();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
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

    agencies = app.get<Model<Agency>>(getModelToken(Agency.name));
    branches = app.get<Model<Branch>>(getModelToken(Branch.name));
    roles = app.get<Model<AgencyRole>>(getModelToken(AgencyRole.name));
    rolePermissions = app.get<Model<RolePermission>>(
      getModelToken(RolePermission.name),
    );
    userRoles = app.get<Model<UserRole>>(getModelToken(UserRole.name));
    auditTemplates = app.get<Model<AuditTemplate>>(
      getModelToken(AuditTemplate.name),
    );
    users = app.get<Model<User>>(getModelToken(User.name));

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ctx.superAdminEmail, password: TEST_PASSWORD })
      .expect(201);
    adminToken = (login.body as { accessToken: string }).accessToken;
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

  describe('the happy path produces a complete tenant', () => {
    let slug: string;
    let result: OnboardResponseBody;
    /**
     * Snapshotted here rather than read from `inngest.sent` in the test —
     * `beforeEach` clears the capture, and it runs *after* this `beforeAll`.
     */
    let emitted: Array<{ name: string; data: Record<string, unknown> }>;

    beforeAll(async () => {
      slug = freshSlug();
      inngest.sent.length = 0;
      const res = await onboard(body(slug)).expect(201);
      result = res.body as OnboardResponseBody;
      emitted = [...inngest.sent];
    });

    it('creates the agency with exactly the chosen modules, pending setup', async () => {
      const agency = await agencies.findById(result.agency.id).lean();
      expect(agency?.slug).toBe(slug);
      expect(agency?.status).toBe('active');
      expect(agency?.modules[ModuleKey.Dashboard].enabled).toBe(true);
      expect(agency?.modules[ModuleKey.Leads].enabled).toBe(true);
      // Not chosen, so present and off — never absent, which would read as
      // "unknown" to anything iterating the entitlements.
      expect(agency?.modules[ModuleKey.CrmService].enabled).toBe(false);
      expect(agency?.setup?.status).toBe('pending');
    });

    it('seeds every default role, with their permissions', async () => {
      /*
       * ⚠ An `ObjectId`, never the string. `AgencyRole.agencyId` resolves to a
       * **Mixed** schema path, so Mongoose does not cast a string query value
       * and it silently matches nothing. Every production caller already passes
       * an ObjectId; a test that passed a string would report an empty tenant
       * that is in fact fully populated.
       */
      const agencyRoles = await roles
        .find({ agencyId: new Types.ObjectId(result.agency.id) })
        .lean();
      expect(agencyRoles).toHaveLength(6);
      expect(agencyRoles.map((r) => r.slug).sort()).toEqual([
        'agency_owner',
        'branch_manager',
        'crm',
        'csr',
        'data_team',
        'producer',
      ]);

      const grants = await rolePermissions.countDocuments({
        agencyId: new Types.ObjectId(result.agency.id),
      });
      expect(grants).toBeGreaterThan(0);
    });

    it('creates the default branch, with its address', async () => {
      const branch = await branches.findById(result.branch.id).lean();
      expect(branch?.name).toBe('Main');
      expect(branch?.slug).toBe('main');
      expect(branch?.isDefault).toBe(true);
      expect(branch?.address?.city).toBe('Austin');
    });

    it('seeds the audit templates the sold pipeline resolves against', async () => {
      // Stored with a **string** agencyId — `AuditTemplate` extends
      // `TenantRecord`. Without these, a sold deal generates no hand-off at all,
      // silently, because generation is best-effort.
      const count = await auditTemplates.countDocuments({
        agencyId: result.agency.id,
      });
      expect(count).toBeGreaterThan(0);
    });

    it('creates the owner as a pending invite holding the Agency Owner role', async () => {
      const owner = await users.findById(result.owner.userId).lean();
      expect(owner?.email).toBe(`${slug}@example.com`);
      expect(owner?.isActive).toBe(false);
      expect(owner?.deactivatedAt).toBeNull();
      expect(owner?.inviteToken).toBeTruthy();
      expect(owner?.branchId?.toString()).toBe(result.branch.id);

      const ownerRole = await roles
        .findOne({
          agencyId: new Types.ObjectId(result.agency.id),
          slug: 'agency_owner',
        })
        .lean();
      const held = await userRoles.findOne({
        userId: new Types.ObjectId(result.owner.userId),
        roleId: ownerRole?._id,
      });
      expect(held).not.toBeNull();
    });

    it('emits the invite email as an owner invite', () => {
      const invite = emitted.find(
        (e) => e.name === 'email/invite.requested.v1',
      );
      expect(invite).toBeDefined();
      expect(invite?.data.to).toBe(`${slug}@example.com`);
      // `owner`, not the default employee copy — nobody at this agency invited
      // them, so "Super Admin invited you" would name a stranger.
      expect(invite?.data.kind).toBe('owner');
      expect(result.owner.emailStatus).toBe('queued');
    });

    it('gives the owner a working invite that lands them in a real tenant', async () => {
      const preview = await request(app.getHttpServer())
        .get(`/api/v1/auth/invite/${result.owner.inviteToken!}`)
        .expect(200);

      const previewBody = preview.body as {
        email: string;
        agencyName: string;
        roleNames: string[];
        firstName: string | null;
        agencySetupPending: boolean;
      };
      expect(previewBody.email).toBe(`${slug}@example.com`);
      expect(previewBody.roleNames).toContain('Agency Owner');
      // Prefills the wizard's first step, and sizes its step counter.
      expect(previewBody.firstName).toBe('Ada');
      expect(previewBody.agencySetupPending).toBe(true);

      const accepted = await request(app.getHttpServer())
        .post('/api/v1/auth/accept-invite')
        .send({
          token: result.owner.inviteToken,
          password: 'OwnerPass123!',
          firstName: 'Adaline',
          lastName: 'Owner',
        })
        .expect(201);

      const session = accepted.body as {
        accessToken: string;
        user: { firstName: string; agencySetupPending: boolean };
      };
      // The name correction typed in the wizard is written through.
      expect(session.user.firstName).toBe('Adaline');
      expect(session.user.agencySetupPending).toBe(true);

      // And the agency they land in only exposes what was switched on.
      const me = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${session.accessToken}`)
        .expect(200);
      const permissions = (me.body as { permissions: string[] }).permissions;
      expect(permissions).toContain('leads:read');
      expect(permissions).not.toContain('crm_service:read');

      // Finishing setup clears the flag, so the app stops redirecting them.
      await request(app.getHttpServer())
        .post('/api/v1/agency/setup/complete')
        .set('Authorization', `Bearer ${session.accessToken}`)
        .send({ skipped: true })
        .expect(200);

      const after = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${session.accessToken}`)
        .expect(200);
      expect(
        (after.body as { agencySetupPending: boolean }).agencySetupPending,
      ).toBe(false);

      const setup = await request(app.getHttpServer())
        .get('/api/v1/agency/setup')
        .set('Authorization', `Bearer ${session.accessToken}`)
        .expect(200);
      const setupBody = setup.body as {
        status: string;
        brandingSkipped: boolean;
      };
      expect(setupBody.status).toBe('complete');
      expect(setupBody.brandingSkipped).toBe(true);
    });
  });

  describe('a failure partway through leaves no orphan', () => {
    it('rolls every write back, and the same request then succeeds', async () => {
      const slug = freshSlug();
      const email = `${slug}@example.com`;

      /*
       * Totals before, compared after — not "is it zero?".
       *
       * The seeded fixture and the happy-path test above both own rows in every
       * one of these collections, so an absolute count proves nothing. What has
       * to be true is that a failed onboarding leaves the database exactly as it
       * found it.
       */
      const before = {
        agencies: await agencies.countDocuments(),
        branches: await branches.countDocuments(),
        roles: await roles.countDocuments(),
        rolePermissions: await rolePermissions.countDocuments(),
        userRoles: await userRoles.countDocuments(),
        auditTemplates: await auditTemplates.countDocuments(),
        users: await users.countDocuments(),
      };

      // Fail *after* the agency, roles, branch and templates exist — assigning
      // the owner's role is the last write before the point of no return, so
      // this exercises the whole undo stack rather than its first entry. It also
      // fails *inside* `createPendingUser`, after that method has already
      // written the user row — the case an undo registered on its return value
      // would never see.
      const spy = jest
        .spyOn(RoleAssignmentsService.prototype, 'setUserRoles')
        .mockRejectedValueOnce(new Error('boom'));

      await onboard(body(slug)).expect(500);
      spy.mockRestore();

      expect(await agencies.countDocuments({ slug })).toBe(0);
      expect(await users.countDocuments({ email })).toBe(0);

      const after = {
        agencies: await agencies.countDocuments(),
        branches: await branches.countDocuments(),
        roles: await roles.countDocuments(),
        rolePermissions: await rolePermissions.countDocuments(),
        userRoles: await userRoles.countDocuments(),
        auditTemplates: await auditTemplates.countDocuments(),
        users: await users.countDocuments(),
      };
      expect(after).toEqual(before);

      // And the operator's obvious next move — submit it again — works.
      const retry = await onboard(body(slug)).expect(201);
      const retried = retry.body as OnboardResponseBody;
      expect(retried.agency.slug).toBe(slug);
      expect(await users.countDocuments({ email })).toBe(1);
    });

    it('does NOT roll back when only the invite email fails', async () => {
      const slug = freshSlug();
      inngest.failWith = new Error('inngest unreachable');

      // A 201, not a 500: the tenant is correct and complete, and the event may
      // already be recorded and due for replay — rolling back here would mail a
      // live link to a deleted account.
      const res = await onboard(body(slug)).expect(201);
      const result = res.body as OnboardResponseBody;
      expect(result.owner.emailStatus).toBe('failed');

      expect(await agencies.countDocuments({ slug })).toBe(1);
      expect(await users.countDocuments({ email: `${slug}@example.com` })).toBe(
        1,
      );

      /*
       * The recovery path: a platform operator cannot use the tenant-side resend
       * (it needs `agency:users:write`, which no platform account holds).
       *
       * Immediately, with no wait. The resend cooldown is 60s and is measured
       * from `inviteLastSentAt` — which a *failed* dispatch clears, precisely so
       * the person recovering from it is not told "an invite was just sent to
       * this address" when none was.
       */
      inngest.failWith = null;
      const resent = await request(app.getHttpServer())
        .post(
          `/api/v1/platform/agencies/${result.agency.id}/owner-invite/resend`,
        )
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect((resent.body as { emailStatus: string }).emailStatus).toBe(
        'queued',
      );
      expect(
        inngest.sent.some((e) => e.name === 'email/invite.requested.v1'),
      ).toBe(true);
    });
  });

  describe('permissions', () => {
    it('refuses an agency owner', async () => {
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: ctx.ownerEmail, password: TEST_PASSWORD })
        .expect(201);
      const ownerToken = (login.body as { accessToken: string }).accessToken;

      await request(app.getHttpServer())
        .post('/api/v1/platform/agencies')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(body(freshSlug()))
        .expect(403);

      await request(app.getHttpServer())
        .get('/api/v1/platform/agencies/availability')
        .query({ slug: 'anything' })
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(403);
    });

    it('refuses a producer on the agency-setup endpoints', async () => {
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: ctx.producerEmail, password: TEST_PASSWORD })
        .expect(201);
      const producerToken = (login.body as { accessToken: string }).accessToken;

      await request(app.getHttpServer())
        .get('/api/v1/agency/setup')
        .set('Authorization', `Bearer ${producerToken}`)
        .expect(403);

      await request(app.getHttpServer())
        .post('/api/v1/agency/setup/complete')
        .set('Authorization', `Bearer ${producerToken}`)
        .send({})
        .expect(403);
    });
  });

  describe('an agency created before this feature reads as complete', () => {
    it('reports an agency with no setup sub-document as complete', async () => {
      /*
       * Stripped explicitly, because that is the shape a *stored* legacy
       * document has — `create()` applies the schema default, so the fixture
       * agency is written with `setup.status: 'complete'` and would not
       * exercise the case at all. Every migrated and demo tenant predates the
       * field and has nothing there, and `.lean()` does not fill it in, so a
       * reader that trusted the default would report them `undefined` and push
       * their owners into a wizard they have no business seeing.
       */
      await agencies.updateOne({ _id: ctx.agencyId }, { $unset: { setup: 1 } });
      const agency = await agencies.findById(ctx.agencyId).lean();
      expect(agency?.setup).toBeUndefined();

      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: ctx.ownerEmail, password: TEST_PASSWORD })
        .expect(201);
      const session = login.body as {
        accessToken: string;
        user: { agencySetupPending: boolean };
      };
      expect(session.user.agencySetupPending).toBe(false);

      const setup = await request(app.getHttpServer())
        .get('/api/v1/agency/setup')
        .set('Authorization', `Bearer ${session.accessToken}`)
        .expect(200);
      expect((setup.body as { status: string }).status).toBe('complete');
    });
  });
});
