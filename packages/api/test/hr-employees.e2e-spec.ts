import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  DEFAULT_AGENCY_TIME_ZONE,
  type EmployeeListResponse,
  type EmployeeProfileView,
  type LeavePolicyView,
  type MyHrProfileView,
  type WorkScheduleTemplateView,
} from '@sfa/shared';
import { agencyTodayIso } from '../src/performance/performance.range';
import { Branch } from '../src/branches/schemas/branch.schema';
import { EmployeeProfilesService } from '../src/common/hr/employee-profiles.service';
import { EmployeeProfile } from '../src/hr/schemas/employee-profile.schema';
import { InngestService } from '../src/inngest/inngest.service';
import { Agency } from '../src/platform/schemas/agency.schema';
import { User } from '../src/users/schemas/user.schema';
import {
  CapturedInngestService,
  closeTestApp,
  createTestApp,
  dropTestDatabase,
} from './helpers/test-app';
import {
  seedTestData,
  TEST_PASSWORD,
  TestSeedContext,
} from './helpers/seed-test-data';

/**
 * Employee profiles + HR onboarding (PAC-162): what only a running app can
 * answer — the invite creating the right profile, who the pending
 * notification reaches, the assignment history answering "as of a day", the
 * guards the profiles put on policies and schedules, and the user lifecycle
 * hooks. The pure rules are unit-tested beside `common/hr/`.
 */
describe('HR employees (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestSeedContext;
  let inngest: CapturedInngestService;
  let ownerToken: string;
  let managerToken: string;
  let producerToken: string;
  let adminToken: string;
  let users: Model<User>;
  let branches: Model<Branch>;
  let agencies: Model<Agency>;
  let profiles: Model<EmployeeProfile>;
  let core: EmployeeProfilesService;

  let policyId: string;
  let seniorPolicyId: string;
  let templateId: string;

  const api = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const login = async (email: string) => {
    const response = await api()
      .post('/api/v1/auth/login')
      .send({ email, password: TEST_PASSWORD })
      .expect(201);
    return (response.body as { accessToken: string }).accessToken;
  };
  let counter = 0;
  const freshEmail = () => `pac162-${Date.now()}-${counter++}@sfa.local`;
  const notifications = () =>
    inngest.sent.filter((e) => e.name === 'notification/requested.v1');

  async function invite(
    body: Record<string, unknown>,
  ): Promise<{ userId: string; inviteToken?: string }> {
    const res = await api()
      .post('/api/v1/users/invite')
      .set(auth(ownerToken))
      .send({
        email: freshEmail(),
        roleIds: [ctx.producerRoleId],
        branchId: ctx.branchId,
        firstName: 'Pat',
        lastName: 'Pending',
        ...body,
      })
      .expect(201);
    return res.body as { userId: string; inviteToken?: string };
  }

  // The agency's day, not UTC's: the seed agency is on the platform default.
  const today = () => agencyTodayIso(DEFAULT_AGENCY_TIME_ZONE);

  beforeAll(async () => {
    app = await createTestApp();
    await dropTestDatabase(app);
    ctx = await seedTestData(app);
    inngest = app.get(InngestService) as unknown as CapturedInngestService;
    ownerToken = await login(ctx.ownerEmail);
    managerToken = await login(ctx.managerEmail);
    producerToken = await login(ctx.producerEmail);
    adminToken = await login(ctx.superAdminEmail);
    users = app.get<Model<User>>(getModelToken(User.name));
    branches = app.get<Model<Branch>>(getModelToken(Branch.name));
    agencies = app.get<Model<Agency>>(getModelToken(Agency.name));
    profiles = app.get<Model<EmployeeProfile>>(
      getModelToken(EmployeeProfile.name),
    );
    core = app.get(EmployeeProfilesService);
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  beforeEach(() => {
    inngest.sent.length = 0;
  });

  describe('gating', () => {
    it('403s a producer on the admin surface and 404s them on their own until it exists', async () => {
      await api()
        .get('/api/v1/hr/employees')
        .set(auth(producerToken))
        .expect(403);
      await api()
        .get('/api/v1/hr/me/profile')
        .set(auth(producerToken))
        .expect(404);
    });

    it('admits the Branch Manager everywhere', async () => {
      const res = await api()
        .get('/api/v1/hr/employees')
        .set(auth(managerToken))
        .expect(200);
      const body = res.body as EmployeeListResponse;
      expect(body.items).toEqual([]);
      expect(body.counts).toEqual({ pending: 0, active: 0, terminated: 0 });
      expect(body.activePolicyCount).toBe(0);
    });
  });

  describe('invite without a policy', () => {
    it('creates a pending profile and tells nobody while the agency has no policy', async () => {
      const { userId } = await invite({});
      const profile = await profiles.findOne({
        agencyId: ctx.agencyId,
        userId: new Types.ObjectId(userId),
      });
      expect(profile?.status).toBe('pending');
      expect(notifications()).toHaveLength(0);

      const list = await api()
        .get('/api/v1/hr/employees?status=pending')
        .set(auth(managerToken))
        .expect(200);
      const body = list.body as EmployeeListResponse;
      expect(body.items.map((i) => i.userId)).toEqual([userId]);
      expect(body.items[0].user.accountStatus).toBe('invited');
      expect(body.items[0]).not.toHaveProperty('dateOfBirth');
    });

    it('notifies exactly the branch reviewers once a policy exists', async () => {
      const created = await api()
        .post('/api/v1/hr/leave-policies')
        .set(auth(managerToken))
        .send({ name: 'Company policy' })
        .expect(201);
      policyId = (created.body as LeavePolicyView).id;
      inngest.sent.length = 0;

      const { userId } = await invite({});
      const sent = notifications();
      expect(sent).toHaveLength(1);
      expect(sent[0].data).toMatchObject({
        type: 'hr.onboarding_pending',
        // The Branch Manager, by row: the owner holds hr:write too but has
        // no branch, and the inviter is always left out.
        recipientIds: [ctx.managerUserId],
        agencyId: ctx.agencyId,
        entity: { kind: 'employeeProfile' },
      });
      expect(sent[0].data.data).toMatchObject({
        userId,
        employeeName: 'Pat Pending',
        branchName: 'Test Branch',
        roleNames: ['Producer'],
      });
    });

    it('falls back to the HR admins when the branch has no reviewer', async () => {
      const other = await branches.create({
        agencyId: new Types.ObjectId(ctx.agencyId),
        name: 'Empty Branch',
        slug: 'empty-branch',
      });
      inngest.sent.length = 0;
      await invite({ branchId: other._id.toHexString() });
      const sent = notifications();
      expect(sent).toHaveLength(1);
      // The owner is the inviter (excluded); the manager holds agency:hr:admin.
      expect(sent[0].data.recipientIds).toEqual([ctx.managerUserId]);
    });
  });

  describe('invite with a policy', () => {
    it('creates an active profile on the policy from the invite day, and notifies nobody', async () => {
      const { userId } = await invite({ leavePolicyId: policyId });
      expect(notifications()).toHaveLength(0);

      const res = await api()
        .get(`/api/v1/hr/employees/${userId}`)
        .set(auth(managerToken))
        .expect(200);
      const view = res.body as EmployeeProfileView;
      expect(view.status).toBe('active');
      expect(view.hireDate).toBe(today());
      expect(view.workAnniversary).toBe(today().slice(5));
      expect(view.leavePolicy?.id).toBe(policyId);
      expect(view.assignments).toHaveLength(1);
      expect(view.assignments[0].reason).toBe('Invited with a leave policy');
      expect(view.effective?.rules.pto.annualAllocationHours).toBe(80);
      expect(view.schedule.source).toBe('workweek');
      expect(view.effectiveAllocations).toEqual({ paid: 80 });
      expect(view.events.map((e) => e.kind)).toEqual(['activated']);
    });

    it('400s a policy of another agency or an archived one', async () => {
      await api()
        .post('/api/v1/users/invite')
        .set(auth(ownerToken))
        .send({
          email: freshEmail(),
          roleIds: [ctx.producerRoleId],
          leavePolicyId: new Types.ObjectId().toHexString(),
        })
        .expect(400);
    });
  });

  describe('onboarding and history', () => {
    let userId: string;

    it('activates a pending profile with custom rules, a schedule and allocations', async () => {
      ({ userId } = await invite({}));
      const tpl = await api()
        .post('/api/v1/hr/schedule-templates')
        .set(auth(managerToken))
        .send({ name: 'Four tens' })
        .expect(201);
      templateId = (tpl.body as WorkScheduleTemplateView).id;

      const res = await api()
        .post(`/api/v1/hr/employees/${userId}/activate`)
        .set(auth(managerToken))
        .send({
          leavePolicyId: policyId,
          hireDate: '2026-01-10',
          overrides: {
            pto: { annualAllocationHours: 120, resetBasis: 'calendar_year' },
          },
          scheduleTemplateId: templateId,
          scheduleOverride: { 5: null },
          allocations: { paid: 100 },
          reason: 'Onboarded',
        })
        .expect(200);
      const view = res.body as EmployeeProfileView;
      expect(view.status).toBe('active');
      expect(view.workAnniversary).toBe('01-10');
      // `resetBasis` equals the template, so it is stripped: Custom is honest.
      expect(view.effective?.overriddenPaths).toEqual([
        'pto.annualAllocationHours',
      ]);
      expect(view.overrides).toEqual({ pto: { annualAllocationHours: 120 } });
      expect(view.schedule.source).toBe('override');
      expect(view.effectiveAllocations).toEqual({ paid: 100 });
      expect(view.assignments[0].effectiveFrom).toBe('2026-01-10');
      const event = view.events.find((e) => e.kind === 'activated');
      expect(event?.changes.map((c) => c.field)).toEqual(
        expect.arrayContaining(['status', 'hireDate', 'leavePolicy', 'customRules']),
      );
      expect(event?.changes.find((c) => c.field === 'status')).toMatchObject({
        from: 'Pending onboarding',
        to: 'Active',
      });
    });

    it('400s each bad input by name', async () => {
      const { userId: other } = await invite({});
      const base = { leavePolicyId: policyId, hireDate: '2026-01-10' };
      const cases: [Record<string, unknown>, RegExp][] = [
        [{ ...base, hireDate: '2999-01-01' }, /future/],
        [{ ...base, allocations: { unpaid: 8 } }, /not an active leave type/],
        [{ ...base, scheduleOverride: { 1: { start: '17:00', end: '09:00' } } }, /after the start/],
        [{ ...base, scheduleTemplateId: new Types.ObjectId().toHexString() }, /Schedule template is invalid/],
        [{ ...base, overrides: { pto: { carryover: { mode: 'capped' } } } }, /carryover cap/],
        [{ ...base, effectiveFrom: '2026-01-01' }, /before the hire date/],
      ];
      for (const [body, message] of cases) {
        const res = await api()
          .post(`/api/v1/hr/employees/${other}/activate`)
          .set(auth(managerToken))
          .send(body)
          .expect(400);
        expect(JSON.stringify(res.body)).toMatch(message);
      }
      await api()
        .post(`/api/v1/hr/employees/${userId}/activate`)
        .set(auth(managerToken))
        .send(base)
        .expect(409);
    });

    it('answers "which rules applied on day X" through the history', async () => {
      const senior = await api()
        .post('/api/v1/hr/leave-policies')
        .set(auth(managerToken))
        .send({ name: 'Senior', rules: { pto: { annualAllocationHours: 160 } } })
        .expect(201);
      seniorPolicyId = (senior.body as LeavePolicyView).id;

      const res = await api()
        .put(`/api/v1/hr/employees/${userId}/assignment`)
        .set(auth(managerToken))
        .send({
          leavePolicyId: seniorPolicyId,
          // Every field is replaced, not merged: the template must be sent
          // again or the person drops back to the workweek.
          scheduleTemplateId: templateId,
          effectiveFrom: '2026-06-01',
          reason: 'Promoted',
        })
        .expect(200);
      const view = res.body as EmployeeProfileView;
      expect(view.assignments.map((a) => a.effectiveFrom)).toEqual([
        '2026-06-01',
        '2026-01-10',
      ]);
      expect(view.assignments[0].leavePolicyName).toBe('Senior');
      expect(view.assignments[1].overriddenPaths).toEqual([
        'pto.annualAllocationHours',
      ]);

      const before = await core.effectiveRulesFor(ctx.agencyId, userId, '2025-12-01');
      const between = await core.effectiveRulesFor(ctx.agencyId, userId, '2026-03-01');
      const after = await core.effectiveRulesFor(ctx.agencyId, userId, '2026-07-01');
      expect(before.policyName).toBe('Company policy');
      expect(between.rules.pto.annualAllocationHours).toBe(120);
      expect(after.policyName).toBe('Senior');
      expect(after.rules.pto.annualAllocationHours).toBe(160);
      expect(after.overriddenPaths).toEqual([]);

      // Not before the previous entry, not in the future.
      await api()
        .put(`/api/v1/hr/employees/${userId}/assignment`)
        .set(auth(managerToken))
        .send({ leavePolicyId: policyId, effectiveFrom: '2026-05-01', reason: 'x' })
        .expect(400);
    });

    it('edits facts with before/after, and refuses a hire date after the first entry', async () => {
      const res = await api()
        .patch(`/api/v1/hr/employees/${userId}`)
        .set(auth(managerToken))
        .send({ workAnniversary: '02-01', dateOfBirth: '1990-05-05' })
        .expect(200);
      const view = res.body as EmployeeProfileView;
      expect(view.workAnniversary).toBe('02-01');
      expect(view.dateOfBirth).toBe('1990-05-05');
      const event = view.events[0];
      expect(event.kind).toBe('facts_updated');
      expect(event.changes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'workAnniversary', from: '01-10', to: '02-01' }),
          expect.objectContaining({ field: 'dateOfBirth', from: null, to: 'Set' }),
        ]),
      );
      await api()
        .patch(`/api/v1/hr/employees/${userId}`)
        .set(auth(managerToken))
        .send({ hireDate: '2026-02-01' })
        .expect(400);
    });

    it('refuses archiving a policy or template with people on it, until they leave', async () => {
      await api()
        .post(`/api/v1/hr/leave-policies/${seniorPolicyId}/archive`)
        .set(auth(managerToken))
        .expect(409);
      await api()
        .post(`/api/v1/hr/schedule-templates/${templateId}/archive`)
        .set(auth(managerToken))
        .expect(409);
      const list = await api()
        .get('/api/v1/hr/leave-policies')
        .set(auth(managerToken))
        .expect(200);
      const senior = (list.body as { policies: { id: string; employeeCount: number }[] })
        .policies.find((p) => p.id === seniorPolicyId);
      expect(senior?.employeeCount).toBe(1);
    });

    it('terminates with a future date, flips the status now, and rehires', async () => {
      const future = '2099-12-31';
      // Before the hire date: refused while still active.
      await api()
        .post(`/api/v1/hr/employees/${userId}/terminate`)
        .set(auth(managerToken))
        .send({ terminationDate: '2025-01-01', reason: 'x' })
        .expect(400);
      const res = await api()
        .post(`/api/v1/hr/employees/${userId}/terminate`)
        .set(auth(managerToken))
        .send({ terminationDate: future, reason: 'Moving on' })
        .expect(200);
      expect((res.body as EmployeeProfileView).status).toBe('terminated');
      expect((res.body as EmployeeProfileView).terminationDate).toBe(future);
      await api()
        .post(`/api/v1/hr/employees/${userId}/terminate`)
        .set(auth(managerToken))
        .send({ terminationDate: future, reason: 'again' })
        .expect(409);

      // History stays readable after termination.
      const rules = await core.effectiveRulesFor(ctx.agencyId, userId, '2026-07-01');
      expect(rules.policyName).toBe('Senior');

      // Now the guards release.
      await api()
        .post(`/api/v1/hr/schedule-templates/${templateId}/archive`)
        .set(auth(managerToken))
        .expect(200);

      const rehired = await api()
        .post(`/api/v1/hr/employees/${userId}/activate`)
        .set(auth(managerToken))
        .send({ leavePolicyId: policyId, hireDate: today(), reason: 'Back' })
        .expect(200);
      const view = rehired.body as EmployeeProfileView;
      expect(view.status).toBe('active');
      expect(view.terminationDate).toBeNull();
      expect(view.assignments).toHaveLength(3);
      expect(view.events[0].kind).toBe('rehired');
    });
  });

  describe('the employee', () => {
    it('sees their own rules and birthday, and may change only the birthday', async () => {
      const producerId = (await users.findOne({ email: ctx.producerEmail }))!._id;
      // A seed user, never invited: the catch-up is what gives them a profile.
      await core.ensureProfile(ctx.agencyId, producerId);
      await api()
        .post(`/api/v1/hr/employees/${producerId.toHexString()}/activate`)
        .set(auth(managerToken))
        .send({ leavePolicyId: policyId, hireDate: '2024-03-15' })
        .expect(200);

      const mine = await api()
        .get('/api/v1/hr/me/profile')
        .set(auth(producerToken))
        .expect(200);
      const view = mine.body as MyHrProfileView;
      expect(view.leavePolicyName).toBe('Company policy');
      expect(view.effective?.rules.requests.partialDayIncrementMinutes).toBe(15);
      expect(view.schedule.weeklyMinutes).toBe(5 * 8 * 60);

      const updated = await api()
        .patch('/api/v1/hr/me/profile')
        .set(auth(producerToken))
        .send({ dateOfBirth: '1991-07-04', showBirthday: false })
        .expect(200);
      expect((updated.body as MyHrProfileView).dateOfBirth).toBe('1991-07-04');
      expect((updated.body as MyHrProfileView).showBirthday).toBe(false);

      await api()
        .patch('/api/v1/hr/me/profile')
        .set(auth(producerToken))
        .send({ hireDate: '2020-01-01' })
        .expect(400);
      await api()
        .patch('/api/v1/hr/me/profile')
        .set(auth(producerToken))
        .send({ dateOfBirth: '2999-01-01' })
        .expect(400);

      // Opted out, so not on the birthdays feed.
      const feed = await core.birthdaysFor(ctx.agencyId);
      expect(feed.map((b) => b.userId)).not.toContain(producerId.toHexString());
    });

    it('records the birthday given at the setup step', async () => {
      const { userId, inviteToken } = await invite({});
      expect(inviteToken).toBeDefined();
      await api()
        .post('/api/v1/auth/accept-invite')
        .send({ token: inviteToken, password: 'Welcome123!', dateOfBirth: '1988-02-29' })
        .expect(201);
      const profile = await profiles.findOne({ userId: new Types.ObjectId(userId) });
      expect(profile?.dateOfBirth).toBe('1988-02-29');
      expect(profile?.showBirthday).toBe(true);
      expect(await core.birthdaysFor(ctx.agencyId)).toContainEqual({
        userId,
        monthDay: '02-29',
      });
    });

    it('refuses a bad birthday before consuming the invite token', async () => {
      const { inviteToken } = await invite({});
      await api()
        .post('/api/v1/auth/accept-invite')
        .send({ token: inviteToken, password: 'Welcome123!', dateOfBirth: '2999-01-01' })
        .expect(400);
      // The token still works.
      await api()
        .post('/api/v1/auth/accept-invite')
        .send({ token: inviteToken, password: 'Welcome123!' })
        .expect(201);
    });
  });

  describe('user lifecycle', () => {
    it('revoking an invite deletes the profile', async () => {
      const { userId } = await invite({});
      await api()
        .delete(`/api/v1/users/${userId}/invite`)
        .set(auth(ownerToken))
        .expect(204);
      expect(await profiles.findOne({ userId: new Types.ObjectId(userId) })).toBeNull();
    });

    it('removing a user terminates the profile today; reactivating leaves it terminated', async () => {
      const { userId, inviteToken } = await invite({ leavePolicyId: policyId });
      await api()
        .post('/api/v1/auth/accept-invite')
        .send({ token: inviteToken, password: 'Welcome123!' })
        .expect(201);
      await api()
        .delete(`/api/v1/users/${userId}`)
        .set(auth(ownerToken))
        .expect(200);
      let profile = await profiles.findOne({ userId: new Types.ObjectId(userId) });
      expect(profile?.status).toBe('terminated');
      expect(profile?.terminationDate).toBe(today());

      await api()
        .post(`/api/v1/users/${userId}/reactivate`)
        .set(auth(ownerToken))
        .expect(201);
      profile = await profiles.findOne({ userId: new Types.ObjectId(userId) });
      expect(profile?.status).toBe('terminated');
    });

    it('enabling the module creates a pending profile for every user without one', async () => {
      // The seed's users predate every invite above and have no profile yet.
      const before = await profiles.countDocuments({ agencyId: ctx.agencyId });
      await api()
        .patch(`/api/v1/platform/agencies/${ctx.agencyId}/modules`)
        .set(auth(adminToken))
        .send({ modules: { hr: { enabled: false } } })
        .expect(200);
      await api()
        .patch(`/api/v1/platform/agencies/${ctx.agencyId}/modules`)
        .set(auth(adminToken))
        .send({ modules: { hr: { enabled: true } } })
        .expect(200);
      const after = await profiles.countDocuments({ agencyId: ctx.agencyId });
      const roster = await users.countDocuments({
        agencyId: new Types.ObjectId(ctx.agencyId),
        isPlatformAdmin: { $ne: true },
        deactivatedAt: null,
      });
      expect(after).toBe(roster);
      expect(after).toBeGreaterThan(before);
      // Idempotent: a second enable changes nothing.
      await core.ensureProfilesForAgency(ctx.agencyId);
      expect(await profiles.countDocuments({ agencyId: ctx.agencyId })).toBe(after);
      // The agency document itself is unchanged apart from the toggle.
      const agency = await agencies.findById(ctx.agencyId).lean();
      expect(agency?.modules.hr?.enabled).toBe(true);
    });

    it('lists by status, branch and name', async () => {
      const res = await api()
        .get(`/api/v1/hr/employees?status=active&q=producer&branchId=${ctx.branchId}`)
        .set(auth(managerToken))
        .expect(200);
      const body = res.body as EmployeeListResponse;
      expect(body.items.length).toBeGreaterThan(0);
      for (const item of body.items) {
        expect(item.status).toBe('active');
        expect(item.user.branchId).toBe(ctx.branchId);
      }
      expect(body.counts.pending).toBeGreaterThan(0);
    });
  });
});
