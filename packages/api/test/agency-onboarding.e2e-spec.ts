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
import { Carrier } from '../src/carriers/schemas/carrier.schema';
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
  let carriers: Model<Carrier>;
  let allstateId: Types.ObjectId;
  let travelersId: Types.ObjectId;

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
    carriers = app.get<Model<Carrier>>(getModelToken(Carrier.name));

    /*
     * ⚠ `dropTestDatabase` runs *after* `app.init()`, so `autoIndex` has
     * already built the indexes and will not run again — the collection is left
     * with none. The uniqueness assertions below depend on the carrier-
     * appointment index existing, so rebuild it explicitly. Same reason
     * `mailer-import.e2e-spec.ts` calls `syncIndexes`.
     */
    await agencies.syncIndexes();

    const [allstate, travelers] = await carriers.create([
      { agencyId: null, name: 'Allstate', slug: 'allstate', active: true },
      { agencyId: null, name: 'Travelers', slug: 'travelers', active: true },
    ]);
    allstateId = allstate._id;
    travelersId = travelers._id;

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

  describe('carrier appointments (PAC-93)', () => {
    it('stores an appointment with a derived code key', async () => {
      const slug = freshSlug();
      const response = await onboard(
        body(slug, {
          agency: {
            name: `Agency ${slug}`,
            slug,
            // Lower case and padded on the way in: the stored code keeps what
            // the operator typed, the key is what matching uses.
            carrierAppointments: [
              {
                carrierId: travelersId.toString(),
                carrierAgencyCode: ' 123456 ',
              },
            ],
            npn: '8675309',
          },
        }),
      ).expect(201);

      const agencyId = (response.body as OnboardResponseBody).agency.id;
      const agency = await agencies.findById(agencyId).lean();
      expect(agency?.npn).toBe('8675309');
      expect(agency?.carrierAppointments).toHaveLength(1);
      expect(agency?.carrierAppointments[0]).toMatchObject({
        carrierAgencyCode: '123456',
        codeKey: '123456',
        // The first appointment is the primary by construction.
        isPrimary: true,
        active: true,
      });
    });

    it('refuses a second agency claiming the same carrier and code', async () => {
      const first = freshSlug();
      await onboard(
        body(first, {
          agency: {
            name: `Agency ${first}`,
            slug: first,
            carrierAppointments: [
              {
                carrierId: travelersId.toString(),
                carrierAgencyCode: '654321',
              },
            ],
          },
        }),
      ).expect(201);

      const second = freshSlug();
      const response = await onboard(
        body(second, {
          agency: {
            name: `Agency ${second}`,
            slug: second,
            // Case-insensitively the same code, which must not slip past.
            carrierAppointments: [
              {
                carrierId: travelersId.toString(),
                carrierAgencyCode: '654321',
              },
            ],
          },
        }),
      ).expect(409);

      // The message has to name the carrier and the code — an operator cannot
      // act on "duplicate key on carrierAppointments.codeKey".
      const message = (response.body as { message: string }).message;
      expect(message).toContain('Travelers');
      expect(message).toContain('654321');

      // Nothing was written: the check runs before the first insert.
      expect(await agencies.findOne({ slug: second }).lean()).toBeNull();
    });

    it('accepts the same code under a different carrier', async () => {
      // A code is only meaningful inside its carrier — two carriers can issue
      // the same string to different agencies, which is the whole reason the
      // model is a list of pairs.
      const shared = 'A0B9049';
      const first = freshSlug();
      await onboard(
        body(first, {
          agency: {
            name: `Agency ${first}`,
            slug: first,
            carrierAppointments: [
              { carrierId: allstateId.toString(), carrierAgencyCode: shared },
            ],
          },
        }),
      ).expect(201);

      const second = freshSlug();
      await onboard(
        body(second, {
          agency: {
            name: `Agency ${second}`,
            slug: second,
            carrierAppointments: [
              { carrierId: travelersId.toString(), carrierAgencyCode: shared },
            ],
          },
        }),
      ).expect(201);
    });

    it('onboards two agencies that have no appointments at all', async () => {
      /*
       * The regression test for the partial filter on the unique index. A
       * multikey index over an empty array emits one entry keyed `undefined`,
       * so under a bare `unique: true` the *second* agency here would die with
       * E11000 — and onboarding would break for everyone who skipped the step.
       */
      const first = freshSlug();
      await onboard(body(first)).expect(201);
      const second = freshSlug();
      await onboard(body(second)).expect(201);

      expect(await agencies.countDocuments({ slug: first })).toBe(1);
      expect(await agencies.countDocuments({ slug: second })).toBe(1);
    });

    it('stores nothing for a carrier picked without a code', async () => {
      // The operator knows who appointed the agency but not the code. The row
      // is accepted and dropped; the owner supplies the code in their own setup.
      const slug = freshSlug();
      const response = await onboard(
        body(slug, {
          agency: {
            name: `Agency ${slug}`,
            slug,
            carrierAppointments: [{ carrierId: allstateId.toString() }],
          },
        }),
      ).expect(201);

      const agencyId = (response.body as OnboardResponseBody).agency.id;
      expect(
        (await agencies.findById(agencyId).lean())?.carrierAppointments,
      ).toEqual([]);
    });

    it('refuses an agency-scoped carrier as an appointment target', async () => {
      // Appointments are unique across tenants, so a carrier only one agency
      // can see makes "the same carrier" undecidable.
      const custom = await carriers.create({
        agencyId: ctx.agencyId.toString(),
        name: 'Backyard Mutual',
        slug: 'backyard-mutual',
        active: true,
      });
      const slug = freshSlug();
      await onboard(
        body(slug, {
          agency: {
            name: `Agency ${slug}`,
            slug,
            carrierAppointments: [
              { carrierId: custom._id.toString(), carrierAgencyCode: 'X1' },
            ],
          },
        }),
      ).expect(400);
    });

    it('refuses two primaries', async () => {
      const slug = freshSlug();
      await onboard(
        body(slug, {
          agency: {
            name: `Agency ${slug}`,
            slug,
            carrierAppointments: [
              {
                carrierId: allstateId.toString(),
                carrierAgencyCode: 'P1',
                isPrimary: true,
              },
              {
                carrierId: travelersId.toString(),
                carrierAgencyCode: 'P2',
                isPrimary: true,
              },
            ],
          },
        }),
      ).expect(400);
    });

    it('reports a taken pair through the availability check', async () => {
      const slug = freshSlug();
      await onboard(
        body(slug, {
          agency: {
            name: `Agency ${slug}`,
            slug,
            carrierAppointments: [
              { carrierId: allstateId.toString(), carrierAgencyCode: 'AV1234' },
            ],
          },
        }),
      ).expect(201);

      const availability = (query: string) =>
        request(app.getHttpServer())
          .get(`/api/v1/platform/agencies/availability?${query}`)
          .set('Authorization', `Bearer ${adminToken}`);

      const taken = await availability(
        `carrierId=${allstateId.toString()}&carrierAgencyCode=av1234`,
      ).expect(200);
      expect(
        (taken.body as { carrierAppointmentAvailable: boolean })
          .carrierAppointmentAvailable,
      ).toBe(false);

      const free = await availability(
        `carrierId=${travelersId.toString()}&carrierAgencyCode=AV1234`,
      ).expect(200);
      expect(
        (free.body as { carrierAppointmentAvailable: boolean })
          .carrierAppointmentAvailable,
      ).toBe(true);
    });

    it('refuses half of the availability pair', async () => {
      // A code without its carrier is not a question that has an answer.
      await request(app.getHttpServer())
        .get('/api/v1/platform/agencies/availability?carrierAgencyCode=A0B9049')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);
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
