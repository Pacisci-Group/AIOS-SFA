import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  defaultTimeOffPolicyRules,
  FEDERAL_HOLIDAY_KEYS,
  type PolicyPeopleResponse,
  type HrPoliciesResponse,
  type HrPolicyView,
  type TimeOffPolicyRules,
} from '@sfa/shared';
import { businessDateInstant } from '../src/common/dates/business-dates';
import { WorkingDaysService } from '../src/common/working-days/working-days.service';
import { HolidayPolicy } from '../src/hr/schemas/holiday-policy.schema';
import { LeaveLedger } from '../src/hr/schemas/leave-ledger.schema';
import { TimeOffPolicy } from '../src/hr/schemas/time-off-policy.schema';
import { WorkWeekPolicy } from '../src/hr/schemas/work-week-policy.schema';
import {
  agencyTodayIso,
  parseIsoDate,
} from '../src/performance/performance.range';
import { Agency } from '../src/platform/schemas/agency.schema';
import { TimeOffRequest } from '../src/time-off-requests/schemas/time-off-request.schema';
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

  describe('time off policies (PAC-174)', () => {
    let ptoId: string;
    let secondPtoId: string;
    let unlimitedId: string;
    let ledger: Model<LeaveLedger>;
    let timeZone: string;

    const timeOffBody = (
      name: string,
      rules: Partial<TimeOffPolicyRules>,
      memberIds: string[],
      startingBalanceHours?: Record<string, number>,
    ) => ({
      type: 'time_off',
      name,
      timeOff: {
        ...defaultTimeOffPolicyRules('pto'),
        hoursPerYear: 80,
        ...rules,
      },
      memberIds,
      ...(startingBalanceHours ? { startingBalanceHours } : {}),
    });

    const rowsFor = (policyId: string, userId?: string) =>
      ledger
        .find({
          policyId: new Types.ObjectId(policyId),
          ...(userId ? { userId: new Types.ObjectId(userId) } : {}),
        })
        .sort({ createdAt: 1 })
        .lean();

    beforeAll(async () => {
      ledger = app.get<Model<LeaveLedger>>(getModelToken(LeaveLedger.name));
      const agencies = app.get<Model<Agency>>(getModelToken(Agency.name));
      const agency = await agencies
        .findById(ctx.agencyId)
        .select('timezone')
        .lean<{ timezone?: string }>();
      timeZone = agency?.timezone ?? 'America/Chicago';
    });

    it('activates a yearly PTO policy with one allocation row per person', async () => {
      const res = await api()
        .post('/api/v1/hr/policies')
        .set(auth(managerToken))
        .send(
          timeOffBody('Paid time off', {}, [producerUserId, ctx.csrUserId], {
            [producerUserId]: 20,
          }),
        )
        .expect(201);
      const body = res.body as HrPolicyView;
      ptoId = body.id;
      expect(body).toMatchObject({
        type: 'time_off',
        name: 'Paid time off',
        memberCount: 2,
      });
      if (body.type !== 'time_off') throw new Error('type');
      expect(body.timeOff).toMatchObject({
        timeOffType: 'pto',
        compensation: 'paid',
        accrualType: 'fixed_amount',
        hoursPerYear: 80,
        accrualFrequency: 'yearly',
        resetDateKind: 'fixed',
        resetMonthDay: '01-01',
        accrualRate: null,
        accrualWaitingPeriodDays: null,
        autoApprove: {
          enabled: false,
          maxCalendarDays: null,
          minNoticeHours: null,
        },
      });
      const balance = (id: string) =>
        body.members.find((m) => m.id === id)?.balanceHours;
      expect(balance(producerUserId)).toBe(20);
      expect(balance(ctx.csrUserId)).toBe(80);

      const rows = await rowsFor(ptoId);
      expect(rows).toHaveLength(2);
      const today = agencyTodayIso(timeZone);
      for (const row of rows) {
        expect(row).toMatchObject({
          kind: 'allocation',
          source: { kind: 'activation' },
          periodKey: null,
        });
        expect(row.effectiveAt.toISOString()).toBe(
          businessDateInstant(today, timeZone).toISOString(),
        );
      }

      const list = await api()
        .get('/api/v1/hr/policies?type=time_off')
        .set(auth(managerToken))
        .expect(200);
      expect((list.body as HrPoliciesResponse).counts.time_off).toBe(1);
    });

    it('stores only its own fields, reserved ones null', async () => {
      const policies = app.get<Model<TimeOffPolicy>>(
        getModelToken(TimeOffPolicy.name),
      );
      const doc = await policies
        .findById(ptoId)
        .lean<Record<string, unknown>>();
      expect(doc).not.toHaveProperty('holidays');
      expect(doc).not.toHaveProperty('days');
      expect(doc).not.toHaveProperty('type');
      expect(doc).toMatchObject({
        accrualRate: null,
        accrualRateUnit: null,
        maxAccruedPerYearHours: null,
        accrualWaitingPeriodDays: null,
      });
    });

    it('activates an unlimited unpaid policy with no balance and no rows', async () => {
      const res = await api()
        .post('/api/v1/hr/policies')
        .set(auth(managerToken))
        .send(
          timeOffBody(
            'Unpaid time off',
            {
              timeOffType: 'unpaid',
              compensation: 'unpaid',
              accrualType: 'unlimited',
              payOutOnTermination: true,
              maxBalanceHours: 40,
            },
            [producerUserId],
          ),
        )
        .expect(201);
      const body = res.body as HrPolicyView;
      unlimitedId = body.id;
      if (body.type !== 'time_off') throw new Error('type');
      expect(body.timeOff).toMatchObject({
        accrualType: 'unlimited',
        hoursPerYear: null,
        accrualFrequency: null,
        maxBalanceHours: null,
        payOutOnTermination: false,
      });
      expect(body.members[0].balanceHours).toBeNull();
      expect(await rowsFor(unlimitedId)).toHaveLength(0);
    });

    it('refuses what the model cannot hold', async () => {
      const send = (body: unknown) =>
        api().post('/api/v1/hr/policies').set(auth(managerToken)).send(body);
      // Unpaid Time Off is always unpaid.
      await send(
        timeOffBody('Bad', { timeOffType: 'unpaid', compensation: 'paid' }, []),
      ).expect(400);
      // Reserved values are not offered yet.
      await send(
        timeOffBody('Bad', { accrualType: 'hours_worked' }, []),
      ).expect(400);
      await send(
        timeOffBody('Bad', { accrualFrequency: 'per_pay_period' }, []),
      ).expect(400);
      await send(timeOffBody('Bad', { accrualRate: 4 }, [])).expect(400);
      // A fixed amount needs its hours and a real reset date.
      await send(timeOffBody('Bad', { hoursPerYear: 0 }, [])).expect(400);
      await send(timeOffBody('Bad', { resetMonthDay: '02-30' }, [])).expect(
        400,
      );
      // A starting balance for someone not being enrolled.
      await send(timeOffBody('Bad', {}, [], { [producerUserId]: 10 })).expect(
        400,
      );
      // Auto-approval on with no rule.
      await send(
        timeOffBody(
          'Bad',
          {
            autoApprove: {
              enabled: true,
              maxCalendarDays: null,
              minNoticeHours: null,
            },
          },
          [],
        ),
      ).expect(400);
    });

    it('keeps the Sick usage cap on Sick only, and drops carryover on an anniversary lump sum', async () => {
      const sick = await api()
        .post('/api/v1/hr/policies')
        .set(auth(managerToken))
        .send(
          timeOffBody(
            'Sick leave',
            {
              timeOffType: 'sick',
              hoursPerYear: 40,
              annualUsageCapHours: 40,
              accrualFrequency: 'monthly',
            },
            [],
          ),
        )
        .expect(201);
      expect(
        (sick.body as HrPolicyView & { timeOff: TimeOffPolicyRules }).timeOff
          .annualUsageCapHours,
      ).toBe(40);

      const pto = await api()
        .post('/api/v1/hr/policies')
        .set(auth(managerToken))
        .send(
          timeOffBody(
            'Anniversary PTO',
            {
              annualUsageCapHours: 40,
              resetDateKind: 'hire_anniversary',
              resetMonthDay: '06-01',
              carryoverCapHours: 8,
            },
            [],
          ),
        )
        .expect(201);
      expect(
        (pto.body as HrPolicyView & { timeOff: TimeOffPolicyRules }).timeOff,
      ).toMatchObject({
        annualUsageCapHours: null,
        resetMonthDay: null,
        carryoverCapHours: null,
      });
    });

    it('moves a person enrolled in a second PTO policy, writing a removal row in the first', async () => {
      const res = await api()
        .post('/api/v1/hr/policies')
        .set(auth(managerToken))
        .send(
          timeOffBody('Managers PTO', { hoursPerYear: 120 }, [producerUserId]),
        )
        .expect(201);
      secondPtoId = (res.body as HrPolicyView).id;

      const first = await api()
        .get(`/api/v1/hr/policies/${ptoId}`)
        .set(auth(managerToken))
        .expect(200);
      expect((first.body as HrPolicyView).members.map((m) => m.id)).toEqual([
        ctx.csrUserId,
      ]);
      const removal = await rowsFor(ptoId, producerUserId);
      expect(removal.map((r) => r.kind)).toEqual([
        'allocation',
        'removed_from_policy',
      ]);

      const people = await api()
        .get('/api/v1/hr/policies/people')
        .set(auth(managerToken))
        .expect(200);
      const producer = (people.body as PolicyPeopleResponse).people.find(
        (p) => p.id === producerUserId,
      );
      expect(producer?.timeOffPolicies.pto).toEqual({
        id: secondPtoId,
        name: 'Managers PTO',
      });
      expect(producer?.timeOffPolicies.unpaid).toEqual({
        id: unlimitedId,
        name: 'Unpaid time off',
      });
    });

    it('never moves anyone out of, or into, a Custom policy', async () => {
      await api()
        .post('/api/v1/hr/policies')
        .set(auth(managerToken))
        .send(
          timeOffBody(
            'Jury duty',
            { timeOffType: 'custom', hoursPerYear: 24 },
            [producerUserId],
          ),
        )
        .expect(201);
      await api()
        .post('/api/v1/hr/policies')
        .set(auth(managerToken))
        .send(
          timeOffBody(
            'Volunteering',
            { timeOffType: 'custom', hoursPerYear: 16 },
            [producerUserId],
          ),
        )
        .expect(201);
      const people = await api()
        .get('/api/v1/hr/policies/people')
        .set(auth(managerToken))
        .expect(200);
      const producer = (people.body as PolicyPeopleResponse).people.find(
        (p) => p.id === producerUserId,
      );
      expect(producer?.timeOffPolicies.custom).toBeUndefined();
      expect(producer?.timeOffPolicies.pto?.id).toBe(secondPtoId);
      const list = await api()
        .get('/api/v1/hr/policies?type=time_off')
        .set(auth(managerToken))
        .expect(200);
      const custom = (list.body as HrPoliciesResponse).policies.filter(
        (p) => p.type === 'time_off' && p.timeOff.timeOffType === 'custom',
      );
      expect(custom.map((p) => p.memberCount)).toEqual([1, 1]);
    });

    it('locks paid/unpaid and Unlimited, and edits the rest', async () => {
      const patch = (body: unknown) =>
        api()
          .patch(`/api/v1/hr/policies/${ptoId}`)
          .set(auth(managerToken))
          .send(body);
      await patch({ timeOff: { compensation: 'unpaid' } }).expect(400);
      await patch({ timeOff: { accrualType: 'unlimited' } }).expect(400);
      await api()
        .patch(`/api/v1/hr/policies/${unlimitedId}`)
        .set(auth(managerToken))
        .send({ timeOff: { accrualType: 'fixed_amount', hoursPerYear: 40 } })
        .expect(400);
      // Sending the stored value is fine.
      await patch({ timeOff: { compensation: 'paid' } }).expect(200);
      // Rules of another type are refused.
      await patch({ holiday: { holidays: [], customHolidays: [] } }).expect(
        400,
      );

      const res = await patch({
        timeOff: {
          hoursPerYear: 96,
          carryoverCapHours: 0,
          maxBalanceHours: 120,
          waitingPeriodDays: 30,
          autoApprove: {
            enabled: true,
            maxCalendarDays: 3,
            minNoticeHours: 48,
          },
        },
      }).expect(200);
      expect(
        (res.body as HrPolicyView & { timeOff: TimeOffPolicyRules }).timeOff,
      ).toMatchObject({
        hoursPerYear: 96,
        carryoverCapHours: 0,
        maxBalanceHours: 120,
        waitingPeriodDays: 30,
        compensation: 'paid',
        autoApprove: { enabled: true, maxCalendarDays: 3, minNoticeHours: 48 },
      });
      // A merged result that breaks a rule is refused too.
      await patch({ timeOff: { carryoverCapHours: 200 } }).expect(400);
    });

    it('diffs the member list: a removal row, a resumed balance, a refused reset', async () => {
      const patch = (body: unknown) =>
        api()
          .patch(`/api/v1/hr/policies/${ptoId}`)
          .set(auth(managerToken))
          .send(body);

      // Remove the CSR.
      await patch({ memberIds: [] }).expect(200);
      expect((await rowsFor(ptoId, ctx.csrUserId)).map((r) => r.kind)).toEqual([
        'allocation',
        'removed_from_policy',
      ]);

      // Re-add them: no new allocation, the 80 h resume.
      const back = await patch({ memberIds: [ctx.csrUserId] }).expect(200);
      expect((back.body as HrPolicyView).members[0]).toMatchObject({
        id: ctx.csrUserId,
        balanceHours: 80,
      });
      expect((await rowsFor(ptoId, ctx.csrUserId)).map((r) => r.kind)).toEqual([
        'allocation',
        'removed_from_policy',
      ]);

      // A starting balance for someone resuming is refused.
      await patch({ memberIds: [] }).expect(200);
      await patch({
        memberIds: [ctx.csrUserId],
        startingBalanceHours: { [ctx.csrUserId]: 10 },
      }).expect(400);

      // Someone new gets the balance given; the producer moves back from "Managers PTO".
      const res = await patch({
        memberIds: [ctx.csrUserId, ctx.readOnlyUserId, producerUserId],
        startingBalanceHours: { [ctx.readOnlyUserId]: 12.5 },
      }).expect(200);
      const members = (res.body as HrPolicyView).members;
      expect(
        members.find((m) => m.id === ctx.readOnlyUserId)?.balanceHours,
      ).toBe(12.5);
      // The producer's 20 h here resume; the move wrote a removal in the other policy.
      expect(members.find((m) => m.id === producerUserId)?.balanceHours).toBe(
        20,
      );
      expect(
        (await rowsFor(secondPtoId, producerUserId)).map((r) => r.kind),
      ).toEqual(['allocation', 'removed_from_policy']);
      const second = await api()
        .get(`/api/v1/hr/policies/${secondPtoId}`)
        .set(auth(managerToken))
        .expect(200);
      expect((second.body as HrPolicyView).memberCount).toBe(0);
    });

    it('refuses to archive while a request is waiting, then archives softly keeping the ledger', async () => {
      const requests = app.get<Model<TimeOffRequest>>(
        getModelToken(TimeOffRequest.name),
      );
      const waiting = await requests.create({
        agencyId: ctx.agencyId,
        branchId: ctx.branchId,
        policyId: new Types.ObjectId(ptoId),
        producerId: new Types.ObjectId(producerUserId),
        status: 'Submitted',
        hoursRequested: 8,
      });
      await api()
        .post(`/api/v1/hr/policies/${ptoId}/archive`)
        .set(auth(managerToken))
        .expect(409);
      await requests.updateOne(
        { _id: waiting._id },
        { $set: { status: 'Approved' } },
      );
      const before = (await rowsFor(ptoId)).length;
      await api()
        .post(`/api/v1/hr/policies/${ptoId}/archive`)
        .set(auth(managerToken))
        .expect(204);
      await api()
        .get(`/api/v1/hr/policies/${ptoId}`)
        .set(auth(managerToken))
        .expect(404);
      expect((await rowsFor(ptoId)).length).toBe(before);
    });
  });
});
