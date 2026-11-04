import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  FEDERAL_HOLIDAY_KEYS,
  type PolicyPeopleResponse,
  type HrPoliciesResponse,
  type HrPolicyView,
} from '@sfa/shared';
import { WorkingDaysService } from '../src/common/working-days/working-days.service';
import { HolidayPolicy } from '../src/hr/schemas/holiday-policy.schema';
import { WorkWeekPolicy } from '../src/hr/schemas/work-week-policy.schema';
import { parseIsoDate } from '../src/performance/performance.range';
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

/**
 * HR policies (PAC-161 v3): Holiday and Work week policies with their
 * enrolment, and who may touch them. The holiday dates are unit-tested in
 * `shared/domain/us-holidays.spec.ts`; what only a running app can answer is
 * the gating, the validation, the "one policy of a type per person" move,
 * the soft archive, and that the working-day service reads what was saved.
 */
describe('HR policies (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestSeedContext;
  let managerToken: string;
  let producerToken: string;
  let producerUserId: string;
  let workingDays: WorkingDaysService;

  const api = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  const login = async (email: string) => {
    const response = await api()
      .post('/api/v1/auth/login')
      .send({ email, password: TEST_PASSWORD })
      .expect(201);
    return (response.body as { accessToken: string }).accessToken;
  };

  const holidayBody = (name: string, memberIds: string[]) => ({
    type: 'holiday',
    name,
    holiday: {
      holidays: [...FEDERAL_HOLIDAY_KEYS, 'day_after_thanksgiving'],
      customHolidays: [
        {
          id: 'winter',
          name: 'Winter closure',
          start: '2026-12-28',
          end: '2026-12-31',
          repeatsYearly: true,
        },
      ],
    },
    memberIds,
  });

  beforeAll(async () => {
    app = await createTestApp();
    await dropTestDatabase(app);
    ctx = await seedTestData(app);
    managerToken = await login(ctx.managerEmail);
    producerToken = await login(ctx.producerEmail);
    const users = app.get<Model<User>>(getModelToken(User.name));
    const producer = await users
      .findOne({ email: ctx.producerEmail })
      .select('_id')
      .lean();
    producerUserId = producer!._id.toString();
    workingDays = app.get(WorkingDaysService);
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  describe('gating', () => {
    it.each([
      ['GET /hr/policies', 'get', '/api/v1/hr/policies'],
      ['GET /hr/policies/people', 'get', '/api/v1/hr/policies/people'],
      ['POST /hr/policies', 'post', '/api/v1/hr/policies'],
    ] as const)('refuses %s to a producer', async (_label, verb, url) => {
      await api()[verb](url).set(auth(producerToken)).send({}).expect(403);
    });

    it('lets the Branch Manager list an empty agency', async () => {
      const res = await api()
        .get('/api/v1/hr/policies')
        .set(auth(managerToken))
        .expect(200);
      expect(res.body as HrPoliciesResponse).toEqual({
        policies: [],
        counts: { holiday: 0, work_week: 0, time_off: 0 },
      });
    });
  });

  describe('holiday policies', () => {
    let firstId: string;

    it('creates one with its holidays and people', async () => {
      const res = await api()
        .post('/api/v1/hr/policies')
        .set(auth(managerToken))
        .send(holidayBody('Office holidays', [producerUserId, ctx.csrUserId]))
        .expect(201);
      const body = res.body as HrPolicyView;
      firstId = body.id;
      expect(body).toMatchObject({
        type: 'holiday',
        name: 'Office holidays',
        memberCount: 2,
      });
      if (body.type !== 'holiday') throw new Error('type');
      expect(body.holiday.holidays).toHaveLength(12);
      expect(body.holiday.customHolidays[0]).toMatchObject({
        name: 'Winter closure',
        repeatsYearly: true,
      });
      expect(body.members.map((m) => m.id).sort()).toEqual(
        [producerUserId, ctx.csrUserId].sort(),
      );
      expect(typeof body.members[0].branchName).toBe('string');
    });

    it('refuses a second policy of the same type with the same name', async () => {
      await api()
        .post('/api/v1/hr/policies')
        .set(auth(managerToken))
        .send(holidayBody('office HOLIDAYS', []))
        .expect(409);
    });

    it('refuses a bad custom holiday, an unknown holiday and a stranger', async () => {
      const bad = holidayBody('Bad', []);
      bad.holiday.customHolidays[0].end = '2026-12-01';
      await api()
        .post('/api/v1/hr/policies')
        .set(auth(managerToken))
        .send(bad)
        .expect(400);
      await api()
        .post('/api/v1/hr/policies')
        .set(auth(managerToken))
        .send({
          ...holidayBody('Bad', []),
          holiday: { holidays: ['groundhog_day'], customHolidays: [] },
        })
        .expect(400);
      await api()
        .post('/api/v1/hr/policies')
        .set(auth(managerToken))
        .send(holidayBody('Bad', [ctx.otherAgencyUserId]))
        .expect(400);
    });

    it('moves a person enrolled in a second Holiday policy', async () => {
      const res = await api()
        .post('/api/v1/hr/policies')
        .set(auth(managerToken))
        .send({
          type: 'holiday',
          name: 'Federal only',
          holiday: { holidays: FEDERAL_HOLIDAY_KEYS, customHolidays: [] },
          memberIds: [producerUserId],
        })
        .expect(201);
      const second = res.body as HrPolicyView;

      const first = await api()
        .get(`/api/v1/hr/policies/${firstId}`)
        .set(auth(managerToken))
        .expect(200);
      expect((first.body as HrPolicyView).members.map((m) => m.id)).toEqual([
        ctx.csrUserId,
      ]);

      const people = await api()
        .get('/api/v1/hr/policies/people')
        .set(auth(managerToken))
        .expect(200);
      const producer = (people.body as PolicyPeopleResponse).people.find(
        (p) => p.id === producerUserId,
      );
      expect(producer?.policies.holiday).toEqual({
        id: second.id,
        name: 'Federal only',
      });
      // Never someone from another agency.
      expect(
        (people.body as PolicyPeopleResponse).people.map((p) => p.id),
      ).not.toContain(ctx.otherAgencyUserId);
    });

    it('edits the holidays and refuses rules of the wrong type', async () => {
      await api()
        .patch(`/api/v1/hr/policies/${firstId}`)
        .set(auth(managerToken))
        .send({
          workWeek: { days: [{ weekday: 1, start: '09:00', end: '17:00' }] },
        })
        .expect(400);
      const res = await api()
        .patch(`/api/v1/hr/policies/${firstId}`)
        .set(auth(managerToken))
        .send({
          name: 'Office holidays 2',
          holiday: { holidays: ['thanksgiving'], customHolidays: [] },
        })
        .expect(200);
      expect(res.body as HrPolicyView).toMatchObject({
        name: 'Office holidays 2',
        holiday: { holidays: ['thanksgiving'], customHolidays: [] },
      });
    });
  });

  describe('work week policies', () => {
    it('refuses a day that ends before it starts, or no day at all', async () => {
      const send = (days: unknown[]) =>
        api().post('/api/v1/hr/policies').set(auth(managerToken)).send({
          type: 'work_week',
          name: 'Bad week',
          workWeek: { days },
          memberIds: [],
        });
      await send([]).expect(400);
      await send([{ weekday: 1, start: '17:00', end: '09:00' }]).expect(400);
    });

    it('creates a four-day week and filters the list by type', async () => {
      await api()
        .post('/api/v1/hr/policies')
        .set(auth(managerToken))
        .send({
          type: 'work_week',
          name: 'Four tens',
          workWeek: {
            days: [4, 1, 2, 3].map((weekday) => ({
              weekday,
              start: '07:00',
              end: '17:00',
            })),
          },
          memberIds: [producerUserId],
        })
        .expect(201);

      const res = await api()
        .get('/api/v1/hr/policies?type=work_week')
        .set(auth(managerToken))
        .expect(200);
      const body = res.body as HrPoliciesResponse;
      expect(body.counts).toEqual({ holiday: 2, work_week: 1, time_off: 0 });
      expect(body.policies).toHaveLength(1);
      expect(body.policies[0]).toMatchObject({
        type: 'work_week',
        name: 'Four tens',
        memberCount: 1,
        // Stored sorted by weekday.
        workWeek: {
          days: [
            { weekday: 1 },
            { weekday: 2 },
            { weekday: 3 },
            { weekday: 4 },
          ],
        },
      });
    });

    it('stores each type in its own collection, with only its own rules', async () => {
      const holidays = app.get<Model<HolidayPolicy>>(
        getModelToken(HolidayPolicy.name),
      );
      const weeks = app.get<Model<WorkWeekPolicy>>(
        getModelToken(WorkWeekPolicy.name),
      );
      const week = await weeks
        .findOne({ agencyId: ctx.agencyId, name: 'Four tens' })
        .lean<Record<string, unknown>>();
      expect(week).toBeTruthy();
      expect(week).not.toHaveProperty('holidays');
      expect(week).not.toHaveProperty('type');
      expect(
        await holidays.countDocuments({
          agencyId: ctx.agencyId,
          name: 'Four tens',
        }),
      ).toBe(0);
      const holiday = await holidays
        .findOne({ agencyId: ctx.agencyId, name: 'Federal only' })
        .lean<Record<string, unknown>>();
      expect(holiday).not.toHaveProperty('days');
      expect(holiday?.holidays).toHaveLength(11);
    });
  });

  describe("working days read the person's policies", () => {
    it("counts the producer's Thanksgiving week on a Mon–Thu week with federal holidays", async () => {
      const person = await workingDays.forPerson(ctx.agencyId, producerUserId, {
        from: '2026-11-23',
        to: '2026-11-29',
      });
      // Mon–Thu, Thanksgiving (Thu 26) closed; Fri 27 is not in the week.
      expect(
        workingDays.workingDaysBetween(
          person.snapshot,
          parseIsoDate('2026-11-23'),
          parseIsoDate('2026-11-29'),
        ),
      ).toBe(3);
      expect(person.schedule[1]).toEqual({ start: '07:00', end: '17:00' });
    });

    it('falls back to Mon–Fri and no holidays for someone in no policy', async () => {
      const person = await workingDays.forPerson(
        ctx.agencyId,
        ctx.readOnlyUserId,
        {
          from: '2026-11-23',
          to: '2026-11-29',
        },
      );
      expect(person.holidayPolicyId).toBeNull();
      expect(person.workWeekPolicyId).toBeNull();
      expect(
        workingDays.workingDaysBetween(
          person.snapshot,
          parseIsoDate('2026-11-23'),
          parseIsoDate('2026-11-29'),
        ),
      ).toBe(5);
    });
  });

  describe('archive', () => {
    it('archives softly: gone from the list, a second archive 404s, people freed', async () => {
      const list = await api()
        .get('/api/v1/hr/policies?type=work_week')
        .set(auth(managerToken))
        .expect(200);
      const id = (list.body as HrPoliciesResponse).policies[0].id;

      await api()
        .post(`/api/v1/hr/policies/${id}/archive`)
        .set(auth(managerToken))
        .expect(204);
      await api()
        .post(`/api/v1/hr/policies/${id}/archive`)
        .set(auth(managerToken))
        .expect(404);
      await api()
        .get(`/api/v1/hr/policies/${id}`)
        .set(auth(managerToken))
        .expect(404);

      const after = await api()
        .get('/api/v1/hr/policies')
        .set(auth(managerToken))
        .expect(200);
      expect((after.body as HrPoliciesResponse).counts.work_week).toBe(0);

      const person = await workingDays.forPerson(ctx.agencyId, producerUserId, {
        from: '2026-11-23',
        to: '2026-11-23',
      });
      expect(person.workWeekPolicyId).toBeNull();
    });
  });
});
