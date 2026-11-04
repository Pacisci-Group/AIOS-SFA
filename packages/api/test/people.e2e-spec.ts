import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import {
  DEFAULT_AGENCY_TIME_ZONE,
  defaultTimeOffPolicyRules,
  type HrPolicyView,
  type PersonProfileView,
} from '@sfa/shared';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { HireDatesService } from '../src/common/time-off/hire-dates.service';
import { EmployeeProfile } from '../src/hr/schemas/employee-profile.schema';
import { LeaveLedger } from '../src/hr/schemas/leave-ledger.schema';
import { agencyTodayIso } from '../src/performance/performance.range';
import { Agency } from '../src/platform/schemas/agency.schema';
import { User } from '../src/users/schemas/user.schema';
import {
  closeTestApp,
  createTestApp,
  dropTestDatabase,
} from './helpers/test-app';
import {
  seedTestData,
  TEST_PASSWORD,
  TestSeedContext,
} from './helpers/seed-test-data';

interface ListRow {
  _id: string;
  status: string;
  avatarUrl: string | null;
}

/**
 * People (PAC-162): the profile every user has, the status that includes
 * onboarding, who may read what, the HR writes, single-person enrolment,
 * and the seams that keep the profile in step with the account (invite,
 * revoke, remove, reactivate). The calendar-day rules are unit-tested in
 * `common/hr`; what only a running app can answer is the gating, the
 * derived status, the ledger rows and the hire-date seam.
 */
describe('People (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestSeedContext;
  let ownerToken: string;
  let managerToken: string;
  let producerToken: string;
  let producerUserId: string;
  let users: Model<User>;
  let profiles: Model<EmployeeProfile>;
  let ledger: Model<LeaveLedger>;
  let hireDates: HireDatesService;
  let today: string;

  /** The invited-then-accepted person every write below is about. */
  let newbieId: string;
  let newbieToken: string;
  const newbieEmail = 'people-newbie@sfa.local';

  const api = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  const login = async (email: string, password = TEST_PASSWORD) => {
    const response = await api()
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(201);
    return (response.body as { accessToken: string }).accessToken;
  };

  const profileOf = (userId: string) =>
    profiles.findOne({ userId: new Types.ObjectId(userId) }).lean();

  const rowsIn = (policyId: string, userId: string) =>
    ledger
      .find({
        policyId: new Types.ObjectId(policyId),
        userId: new Types.ObjectId(userId),
      })
      .sort({ createdAt: 1 })
      .lean();

  const listRow = async (userId: string, status?: string) => {
    const res = await api()
      .get('/api/v1/users')
      .query(status ? { status, pageSize: 100 } : { pageSize: 100 })
      .set(auth(ownerToken))
      .expect(200);
    return (res.body as { items: ListRow[] }).items.find(
      (row) => row._id === userId,
    );
  };

  const ptoBody = (name: string, memberIds: string[]) => ({
    type: 'time_off',
    name,
    timeOff: { ...defaultTimeOffPolicyRules('pto'), hoursPerYear: 80 },
    memberIds,
  });

  beforeAll(async () => {
    app = await createTestApp();
    await dropTestDatabase(app);
    ctx = await seedTestData(app);
    ownerToken = await login(ctx.ownerEmail);
    managerToken = await login(ctx.managerEmail);
    producerToken = await login(ctx.producerEmail);
    users = app.get<Model<User>>(getModelToken(User.name));
    profiles = app.get<Model<EmployeeProfile>>(
      getModelToken(EmployeeProfile.name),
    );
    ledger = app.get<Model<LeaveLedger>>(getModelToken(LeaveLedger.name));
    hireDates = app.get(HireDatesService);
    const producer = await users
      .findOne({ email: ctx.producerEmail })
      .select('_id')
      .lean();
    producerUserId = producer!._id.toString();
    const agencies = app.get<Model<Agency>>(getModelToken(Agency.name));
    const agency = await agencies
      .findById(ctx.agencyId)
      .select('timezone')
      .lean<{ timezone?: string } | null>();
    today = agencyTodayIso(agency?.timezone ?? DEFAULT_AGENCY_TIME_ZONE);
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  describe('the profile follows the account', () => {
    it('creates a pending profile with the invite and reads Invited until it is accepted', async () => {
      const invite = await api()
        .post('/api/v1/users/invite')
        .set(auth(ownerToken))
        .send({
          email: newbieEmail,
          roleIds: [ctx.producerRoleId],
          branchId: ctx.branchId,
          firstName: 'Nia',
          lastName: 'Newbie',
        })
        .expect(201);
      const body = invite.body as { userId: string; inviteToken: string };
      newbieId = body.userId;

      expect(await profileOf(newbieId)).toMatchObject({
        agencyId: ctx.agencyId,
        status: 'pending',
        hireDate: null,
        showBirthday: true,
      });
      expect(await listRow(newbieId)).toMatchObject({
        status: 'invited',
        avatarUrl: null,
      });

      const accepted = await api()
        .post('/api/v1/auth/accept-invite')
        .send({ token: body.inviteToken, password: 'InvitePass123!' })
        .expect(201);
      newbieToken = (accepted.body as { accessToken: string }).accessToken;
      expect(await listRow(newbieId)).toMatchObject({
        status: 'pending_onboarding',
      });
    });

    it('deletes the profile with a revoked invite', async () => {
      const invite = await api()
        .post('/api/v1/users/invite')
        .set(auth(ownerToken))
        .send({
          email: 'people-revoked@sfa.local',
          roleIds: [ctx.producerRoleId],
        })
        .expect(201);
      const userId = (invite.body as { userId: string }).userId;
      expect(await profileOf(userId)).not.toBeNull();
      await api()
        .delete(`/api/v1/users/${userId}/invite`)
        .set(auth(ownerToken))
        .expect(204);
      expect(await profileOf(userId)).toBeNull();
    });

    it('filters the list by the onboarding status', async () => {
      expect(await listRow(newbieId, 'pending_onboarding')).toBeDefined();
      expect(await listRow(newbieId, 'active')).toBeUndefined();
      expect(await listRow(newbieId, 'invited')).toBeUndefined();
    });
  });

  describe('reading a profile', () => {
    it('gives an owner the whole profile, with the default week', async () => {
      const res = await api()
        .get(`/api/v1/users/${newbieId}/profile`)
        .set(auth(ownerToken))
        .expect(200);
      const body = res.body as PersonProfileView;
      expect(body.user).toMatchObject({
        id: newbieId,
        email: newbieEmail,
        name: 'Nia Newbie',
        phone: null,
        avatarUrl: null,
        status: 'pending_onboarding',
        isActive: true,
      });
      expect(body.user.branch).toMatchObject({ id: ctx.branchId });
      expect(body.user.roles.map((role) => role.id)).toEqual([
        ctx.producerRoleId,
      ]);
      expect(body.employment).toMatchObject({
        status: 'pending',
        hireDate: null,
        terminationDate: null,
        dateOfBirth: null,
        showBirthday: true,
        onboardingCompletedAt: null,
        onboardingCompletedBy: null,
      });
      expect(body.timeOff).toEqual({ policies: [] });
      expect(body.schedule).toMatchObject({
        workWeek: null,
        hoursPerWeek: 40,
        holiday: null,
      });
      expect(body.schedule?.days).toHaveLength(5);
    });

    it("refuses a producer a colleague's profile and photo, and allows their own", async () => {
      await api()
        .get(`/api/v1/users/${newbieId}/profile`)
        .set(auth(producerToken))
        .expect(403);
      await api()
        .get(`/api/v1/users/${newbieId}/avatar`)
        .set(auth(producerToken))
        .expect(403);

      const res = await api()
        .get(`/api/v1/users/${producerUserId}/profile`)
        .set(auth(producerToken))
        .expect(200);
      const body = res.body as PersonProfileView;
      expect(body.user.id).toBe(producerUserId);
      // A producer holds `hr:read` by template, so their own balances and
      // week are theirs to see, and so is their own date of birth.
      expect(body.timeOff).toBeDefined();
      expect(body.schedule).toBeDefined();
      expect('dateOfBirth' in body.employment).toBe(true);
    });

    it('shows the time off sections exactly when the viewer holds hr:read on themself', async () => {
      const readOnlyToken = await login(ctx.readOnlyEmail);
      const me = await api()
        .get('/api/v1/auth/me')
        .set(auth(readOnlyToken))
        .expect(200);
      const { id, permissions } = me.body as {
        id: string;
        permissions: string[];
      };
      const res = await api()
        .get(`/api/v1/users/${id}/profile`)
        .set(auth(readOnlyToken))
        .expect(200);
      const body = res.body as PersonProfileView;
      expect('timeOff' in body).toBe(permissions.includes('hr:read'));
      expect('schedule' in body).toBe(permissions.includes('hr:read'));
    });

    it('404s a photo that is not set, an unknown id, and a platform admin', async () => {
      await api()
        .get(`/api/v1/users/${newbieId}/avatar`)
        .set(auth(ownerToken))
        .expect(404);
      await api()
        .get(`/api/v1/users/${new Types.ObjectId().toString()}/profile`)
        .set(auth(ownerToken))
        .expect(404);
      const admin = await users
        .findOne({ email: ctx.superAdminEmail })
        .select('_id')
        .lean();
      await api()
        .get(`/api/v1/users/${admin!._id.toString()}/profile`)
        .set(auth(ownerToken))
        .expect(404);
    });
  });

  describe('HR writes', () => {
    it('refuses a producer the facts and the onboarding routes', async () => {
      await api()
        .patch(`/api/v1/hr/people/${newbieId}`)
        .set(auth(producerToken))
        .send({ phone: '555' })
        .expect(403);
      await api()
        .post(`/api/v1/hr/people/${newbieId}/onboarding/complete`)
        .set(auth(producerToken))
        .send({ hireDate: today })
        .expect(403);
    });

    it('edits the facts, bounded on the agency calendar', async () => {
      const res = await api()
        .patch(`/api/v1/hr/people/${newbieId}`)
        .set(auth(managerToken))
        .send({
          phone: '(312) 555-0100',
          dateOfBirth: '1991-07-14',
          showBirthday: false,
          hireDate: '2026-01-05',
          lastName: 'Newbie-Smith',
        })
        .expect(200);
      const body = res.body as PersonProfileView;
      expect(body.user).toMatchObject({
        phone: '(312) 555-0100',
        name: 'Nia Newbie-Smith',
      });
      expect(body.employment).toMatchObject({
        status: 'pending',
        hireDate: '2026-01-05',
        dateOfBirth: '1991-07-14',
        showBirthday: false,
      });

      const tomorrow = new Date(`${today}T12:00:00Z`);
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      await api()
        .patch(`/api/v1/hr/people/${newbieId}`)
        .set(auth(managerToken))
        .send({ hireDate: tomorrow.toISOString().slice(0, 10) })
        .expect(400);
      await api()
        .patch(`/api/v1/hr/people/${newbieId}`)
        .set(auth(managerToken))
        .send({ dateOfBirth: '1899-12-31' })
        .expect(400);
      await api()
        .patch(`/api/v1/hr/people/${newbieId}`)
        .set(auth(managerToken))
        .send({})
        .expect(400);
    });

    it('completes onboarding: facts, Active, a starting balance, the week, and the hire date seam', async () => {
      const pto = await api()
        .post('/api/v1/hr/policies')
        .set(auth(managerToken))
        .send(ptoBody('People PTO', [producerUserId]))
        .expect(201);
      const ptoId = (pto.body as HrPolicyView).id;
      const week = await api()
        .post('/api/v1/hr/policies')
        .set(auth(managerToken))
        .send({
          type: 'work_week',
          name: 'People four-day week',
          workWeek: {
            days: [1, 2, 3, 4].map((weekday) => ({
              weekday,
              start: '08:00',
              end: '18:00',
            })),
          },
          memberIds: [],
        })
        .expect(201);
      const weekId = (week.body as HrPolicyView).id;

      const res = await api()
        .post(`/api/v1/hr/people/${newbieId}/onboarding/complete`)
        .set(auth(managerToken))
        .send({
          hireDate: '2026-02-02',
          policies: [
            { policyId: ptoId, startingBalanceHours: 20 },
            { policyId: weekId },
          ],
        })
        .expect(201);
      const body = res.body as PersonProfileView;
      expect(body.user.status).toBe('active');
      expect(body.employment).toMatchObject({
        status: 'active',
        hireDate: '2026-02-02',
        terminationDate: null,
        // Untouched by a body that did not send them.
        dateOfBirth: '1991-07-14',
        showBirthday: false,
      });
      expect(body.employment.onboardingCompletedAt).toBeTruthy();
      expect(body.employment.onboardingCompletedBy?.name).toBeTruthy();
      expect(body.timeOff?.policies).toHaveLength(1);
      expect(body.timeOff?.policies[0]).toMatchObject({
        id: ptoId,
        name: 'People PTO',
        balanceHours: 20,
      });
      expect(body.timeOff?.policies[0].timeOff.hoursPerYear).toBe(80);
      expect(body.schedule).toMatchObject({
        workWeek: { id: weekId, name: 'People four-day week' },
        hoursPerWeek: 40,
      });
      expect(body.schedule?.days).toHaveLength(4);

      const rows = await rowsIn(ptoId, newbieId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ kind: 'allocation', hours: 20 });
      expect(rows[0].source).toMatchObject({ kind: 'enrollment' });

      expect(await listRow(newbieId, 'active')).toBeDefined();
      const dates = await hireDates.forUsers(ctx.agencyId, [
        new Types.ObjectId(newbieId),
        new Types.ObjectId(producerUserId),
      ]);
      expect(dates.get(newbieId)).toBe('2026-02-02');
      expect(dates.get(producerUserId)).toBeNull();

      await api()
        .post(`/api/v1/hr/people/${newbieId}/onboarding/complete`)
        .set(auth(managerToken))
        .send({ hireDate: '2026-02-02' })
        .expect(409);
      await api()
        .patch(`/api/v1/hr/people/${newbieId}`)
        .set(auth(managerToken))
        .send({ hireDate: null })
        .expect(400);
    });

    it('enrols and removes one person, moving them between policies of a kind', async () => {
      const listed = await api()
        .get('/api/v1/hr/policies?type=time_off')
        .set(auth(managerToken))
        .expect(200);
      const oldPto = (listed.body as { policies: { id: string }[] })
        .policies[0];
      const second = await api()
        .post('/api/v1/hr/policies')
        .set(auth(managerToken))
        .send(ptoBody('People PTO 2', []))
        .expect(201);
      const secondId = (second.body as HrPolicyView).id;

      const moved = await api()
        .post(`/api/v1/hr/policies/${secondId}/members`)
        .set(auth(managerToken))
        .send({ userId: newbieId, startingBalanceHours: 5 })
        .expect(201);
      expect(
        (moved.body as HrPolicyView).members.map((member) => member.id),
      ).toEqual([newbieId]);
      const oldRows = await rowsIn(oldPto.id, newbieId);
      expect(oldRows.map((row) => row.kind)).toEqual([
        'allocation',
        'removed_from_policy',
      ]);
      expect(await rowsIn(secondId, newbieId)).toHaveLength(1);

      // Already in: a no-op, but a balance for them is refused.
      await api()
        .post(`/api/v1/hr/policies/${secondId}/members`)
        .set(auth(managerToken))
        .send({ userId: newbieId })
        .expect(201);
      await api()
        .post(`/api/v1/hr/policies/${secondId}/members`)
        .set(auth(managerToken))
        .send({ userId: newbieId, startingBalanceHours: 1 })
        .expect(400);

      await api()
        .delete(`/api/v1/hr/policies/${secondId}/members/${newbieId}`)
        .set(auth(managerToken))
        .expect(204);
      await api()
        .delete(`/api/v1/hr/policies/${secondId}/members/${newbieId}`)
        .set(auth(managerToken))
        .expect(404);
      expect((await rowsIn(secondId, newbieId)).map((row) => row.kind)).toEqual(
        ['allocation', 'removed_from_policy'],
      );

      // Back to the first policy: the balance resumes, no new allocation,
      // and a balance for a returning person is a 400.
      await api()
        .post(`/api/v1/hr/policies/${oldPto.id}/members`)
        .set(auth(managerToken))
        .send({ userId: newbieId, startingBalanceHours: 9 })
        .expect(400);
      const back = await api()
        .post(`/api/v1/hr/policies/${oldPto.id}/members`)
        .set(auth(managerToken))
        .send({ userId: newbieId })
        .expect(201);
      const me = (back.body as HrPolicyView).members.find(
        (member) => member.id === newbieId,
      );
      expect(me?.balanceHours).toBe(20);
      expect(await rowsIn(oldPto.id, newbieId)).toHaveLength(2);

      await api()
        .post(`/api/v1/hr/policies/${secondId}/members`)
        .set(auth(producerToken))
        .send({ userId: newbieId })
        .expect(403);
    });
  });

  describe('removal and reactivation', () => {
    it('terminates the profile on removal and keeps the ledger', async () => {
      await api()
        .delete(`/api/v1/users/${newbieId}`)
        .set(auth(ownerToken))
        .send({})
        .expect(200);
      expect(await profileOf(newbieId)).toMatchObject({
        status: 'terminated',
        terminationDate: today,
        hireDate: '2026-02-02',
      });
      expect(await listRow(newbieId)).toMatchObject({ status: 'deactivated' });
      expect(
        await ledger.countDocuments({ userId: new Types.ObjectId(newbieId) }),
      ).toBeGreaterThan(0);

      await api()
        .post(`/api/v1/hr/people/${newbieId}/onboarding/complete`)
        .set(auth(managerToken))
        .send({ hireDate: '2026-02-02' })
        .expect(409);
    });

    it('reopens a reactivated person as pending, and a second onboarding clears the termination', async () => {
      await api()
        .post(`/api/v1/users/${newbieId}/reactivate`)
        .set(auth(ownerToken))
        .expect(201);
      expect(await profileOf(newbieId)).toMatchObject({
        status: 'pending',
        terminationDate: today,
      });
      expect(await listRow(newbieId)).toMatchObject({
        status: 'pending_onboarding',
      });

      const res = await api()
        .post(`/api/v1/hr/people/${newbieId}/onboarding/complete`)
        .set(auth(managerToken))
        .send({ hireDate: today, policies: [] })
        .expect(201);
      expect((res.body as PersonProfileView).employment).toMatchObject({
        status: 'active',
        hireDate: today,
        terminationDate: null,
      });

      // The person's own session still works after all that.
      await api()
        .get(`/api/v1/users/${newbieId}/profile`)
        .set(auth(newbieToken))
        .expect(200);
    });
  });
});
