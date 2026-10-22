import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import type {
  AgencyCalendarView,
  HolidaySuggestionsResponse,
  HrPolicyView,
  LeavePoliciesResponse,
  LeavePolicyView,
} from '@sfa/shared';
import { AgencyCalendar } from '../src/hr/schemas/agency-calendar.schema';
import { AgencyCalendarDay } from '../src/hr/schemas/agency-calendar-day.schema';
import { Agency } from '../src/platform/schemas/agency.schema';
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
 * The HR foundation's HTTP surface (PAC-161): the agency calendar, holiday
 * suggestions and proposals, leave policies, the assembled HR Policy view,
 * and the two onboarding flags — and who may do what. The arithmetic is
 * unit-tested in `common/working-days/`; what only a running app can answer
 * is the gating, the 409s, the soft remove, and that the pieces agree.
 */
describe('HR settings (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestSeedContext;
  let ownerToken: string;
  let managerToken: string;
  let producerToken: string;
  let agencies: Model<Agency>;
  let calendars: Model<AgencyCalendar>;
  let calendarDays: Model<AgencyCalendarDay>;

  const api = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  const login = async (email: string) => {
    const response = await api()
      .post('/api/v1/auth/login')
      .send({ email, password: TEST_PASSWORD })
      .expect(201);
    return (response.body as { accessToken: string }).accessToken;
  };

  beforeAll(async () => {
    app = await createTestApp();
    await dropTestDatabase(app);
    ctx = await seedTestData(app);
    ownerToken = await login(ctx.ownerEmail);
    managerToken = await login(ctx.managerEmail);
    producerToken = await login(ctx.producerEmail);
    agencies = app.get<Model<Agency>>(getModelToken(Agency.name));
    calendars = app.get<Model<AgencyCalendar>>(
      getModelToken(AgencyCalendar.name),
    );
    calendarDays = app.get<Model<AgencyCalendarDay>>(
      getModelToken(AgencyCalendarDay.name),
    );
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  describe('gating', () => {
    it('lets every employee read the calendar', async () => {
      const res = await api()
        .get('/api/v1/hr/calendar')
        .set(auth(producerToken))
        .expect(200);
      const body = res.body as AgencyCalendarView;
      // No document yet: the Mon–Fri default, no country, no rows.
      expect(body.workweek).toEqual([1, 2, 3, 4, 5]);
      expect(body.days).toEqual([]);
      expect(body.pendingProposal).toBeNull();
      expect(Object.keys(body.workingDaysByMonth)).toHaveLength(12);
    });

    it.each([
      ['PATCH /hr/calendar', 'patch', '/api/v1/hr/calendar', { workweek: [1] }],
      [
        'POST /hr/calendar/days',
        'post',
        '/api/v1/hr/calendar/days',
        { source: 'import', days: [] },
      ],
      [
        'GET /hr/calendar/holiday-suggestions',
        'get',
        '/api/v1/hr/calendar/holiday-suggestions?country=US&year=2026',
        undefined,
      ],
      ['GET /hr/leave-policies', 'get', '/api/v1/hr/leave-policies', undefined],
      [
        'POST /hr/leave-policies',
        'post',
        '/api/v1/hr/leave-policies',
        { name: 'x' },
      ],
      ['GET /hr/policy', 'get', '/api/v1/hr/policy', undefined],
    ])('refuses a producer on %s', async (_label, method, path, body) => {
      const req = api()
        [method as 'get' | 'post' | 'patch'](path)
        .set(auth(producerToken));
      await (body ? req.send(body) : req).expect(403);
    });

    it('admits the Branch Manager everywhere, as the Office Manager', async () => {
      await api()
        .get('/api/v1/hr/leave-policies')
        .set(auth(managerToken))
        .expect(200);
      await api().get('/api/v1/hr/policy').set(auth(managerToken)).expect(200);
    });

    it('403s everyone, owner included, while the module is off', async () => {
      await agencies.updateOne(
        { _id: new Types.ObjectId(ctx.agencyId) },
        { $set: { 'modules.hr.enabled': false } },
      );
      try {
        await api()
          .get('/api/v1/hr/calendar')
          .set(auth(ownerToken))
          .expect(403);
        await api()
          .get('/api/v1/hr/leave-policies')
          .set(auth(managerToken))
          .expect(403);
      } finally {
        await agencies.updateOne(
          { _id: new Types.ObjectId(ctx.agencyId) },
          { $set: { 'modules.hr.enabled': true } },
        );
      }
    });
  });

  describe('calendar settings', () => {
    it('refuses an empty body, an unknown country and an unknown region', async () => {
      await api()
        .patch('/api/v1/hr/calendar')
        .set(auth(managerToken))
        .send({})
        .expect(400);
      await api()
        .patch('/api/v1/hr/calendar')
        .set(auth(managerToken))
        .send({ country: 'QQ' })
        .expect(400);
      await api()
        .patch('/api/v1/hr/calendar')
        .set(auth(managerToken))
        .send({ country: 'US', region: 'ZZ' })
        .expect(400);
    });

    it('stores the workweek, country and region, and clears the region on a country change', async () => {
      const first = await api()
        .patch('/api/v1/hr/calendar')
        .set(auth(managerToken))
        .send({ workweek: [2, 3, 4, 5, 1], country: 'us', region: 'ok' })
        .expect(200);
      expect(first.body as Partial<AgencyCalendarView>).toMatchObject({
        workweek: [1, 2, 3, 4, 5],
        country: 'US',
        region: 'OK',
      });

      const moved = await api()
        .patch('/api/v1/hr/calendar')
        .set(auth(managerToken))
        .send({ country: 'CA' })
        .expect(200);
      expect(moved.body as Partial<AgencyCalendarView>).toMatchObject({
        country: 'CA',
        region: null,
      });

      await api()
        .patch('/api/v1/hr/calendar')
        .set(auth(managerToken))
        .send({ country: 'US', region: 'OK' })
        .expect(200);
      expect(await calendars.countDocuments({ agencyId: ctx.agencyId })).toBe(
        1,
      );
    });

    it('lists countries, and the regions of one', async () => {
      const res = await api()
        .get('/api/v1/hr/calendar/holiday-regions?country=US')
        .set(auth(managerToken))
        .expect(200);
      const body = res.body as {
        countries: { code: string }[];
        regions: { code: string; name: string }[];
      };
      expect(body.countries.some((c) => c.code === 'US')).toBe(true);
      expect(body.regions.find((r) => r.code === 'OK')?.name).toBe('Oklahoma');
    });
  });

  describe('holiday suggestions and days', () => {
    let closureId: string;

    it('suggests US Oklahoma 2026 with public pre-checked and the rest not', async () => {
      const res = await api()
        .get(
          '/api/v1/hr/calendar/holiday-suggestions?country=US&region=OK&year=2026',
        )
        .set(auth(managerToken))
        .expect(200);
      const body = res.body as HolidaySuggestionsResponse;
      const thanksgiving = body.suggestions.find(
        (s) => s.date === '2026-11-26',
      );
      expect(thanksgiving).toMatchObject({
        type: 'public',
        preChecked: true,
        alreadyInCalendar: false,
      });
      const valentines = body.suggestions.find((s) => s.date === '2026-02-14');
      expect(valentines).toMatchObject({
        type: 'observance',
        preChecked: false,
      });
    });

    it('400s an unknown region', async () => {
      await api()
        .get(
          '/api/v1/hr/calendar/holiday-suggestions?country=US&region=ZZ&year=2026',
        )
        .set(auth(managerToken))
        .expect(400);
    });

    it('imports holidays, then marks them as already on the calendar', async () => {
      const res = await api()
        .post('/api/v1/hr/calendar/days')
        .set(auth(managerToken))
        .send({
          source: 'import',
          days: [
            { date: '2026-11-26', kind: 'holiday', label: 'Thanksgiving Day' },
            {
              date: '2026-11-27',
              kind: 'holiday',
              label: 'Day after Thanksgiving',
            },
          ],
        })
        .expect(201);
      const body = res.body as {
        days: {
          date: string;
          source: string;
          reason: string | null;
          createdBy: { name: string } | null;
        }[];
      };
      expect(body.days.map((d) => d.date)).toEqual([
        '2026-11-26',
        '2026-11-27',
      ]);
      expect(body.days[0].source).toBe('import');
      expect(body.days[0].reason).toBeNull();
      expect(body.days[0].createdBy?.name).toBe('Test Manager');

      const again = await api()
        .get(
          '/api/v1/hr/calendar/holiday-suggestions?country=US&region=OK&year=2026',
        )
        .set(auth(managerToken))
        .expect(200);
      const suggestions = (again.body as HolidaySuggestionsResponse)
        .suggestions;
      expect(
        suggestions.find((s) => s.date === '2026-11-26')?.alreadyInCalendar,
      ).toBe(true);
    });

    it('requires a reason on a manual row and refuses a duplicate date in one batch', async () => {
      await api()
        .post('/api/v1/hr/calendar/days')
        .set(auth(managerToken))
        .send({
          source: 'manual',
          days: [{ date: '2026-11-03', kind: 'closure', label: 'Flood' }],
        })
        .expect(400);
      await api()
        .post('/api/v1/hr/calendar/days')
        .set(auth(managerToken))
        .send({
          source: 'import',
          days: [
            { date: '2026-12-25', kind: 'holiday', label: 'Christmas' },
            { date: '2026-12-25', kind: 'holiday', label: 'Christmas again' },
          ],
        })
        .expect(400);
    });

    it('409s a date already on the calendar and writes nothing from that batch', async () => {
      const res = await api()
        .post('/api/v1/hr/calendar/days')
        .set(auth(managerToken))
        .send({
          source: 'import',
          days: [
            { date: '2026-11-26', kind: 'holiday', label: 'Thanksgiving Day' },
            { date: '2026-12-25', kind: 'holiday', label: 'Christmas' },
          ],
        })
        .expect(409);
      expect((res.body as { message: string }).message).toContain('2026-11-26');
      expect(
        await calendarDays.countDocuments({
          agencyId: ctx.agencyId,
          date: '2026-12-25',
          removedAt: null,
        }),
      ).toBe(0);
    });

    it('adds a manual closure and counts it against the month', async () => {
      const res = await api()
        .post('/api/v1/hr/calendar/days')
        .set(auth(managerToken))
        .send({
          source: 'manual',
          days: [
            {
              date: '2026-11-03',
              kind: 'closure',
              label: 'Flood',
              reason: 'Office flooded overnight',
            },
          ],
        })
        .expect(201);
      closureId = (res.body as { days: { id: string }[] }).days[0].id;

      const view = await api()
        .get('/api/v1/hr/calendar?year=2026')
        .set(auth(producerToken))
        .expect(200);
      const body = view.body as AgencyCalendarView;
      // 21 weekdays in November 2026, minus two holidays and the closure.
      expect(body.workingDaysByMonth['2026-11']).toBe(18);
      expect(body.days.map((d) => d.date)).toEqual([
        '2026-11-03',
        '2026-11-26',
        '2026-11-27',
      ]);
      expect(body.year).toBe(2026);
    });

    it('soft-removes a day with a reason, frees the date, and 404s a second removal', async () => {
      await api()
        .delete(`/api/v1/hr/calendar/days/${closureId}`)
        .set(auth(managerToken))
        .send({})
        .expect(400);
      await api()
        .delete(`/api/v1/hr/calendar/days/${closureId}`)
        .set(auth(managerToken))
        .send({ reason: 'Dried out by Tuesday' })
        .expect(200);
      await api()
        .delete(`/api/v1/hr/calendar/days/${closureId}`)
        .set(auth(managerToken))
        .send({ reason: 'again' })
        .expect(404);

      const row = await calendarDays.findById(closureId).lean();
      expect(row?.removedAt).toBeInstanceOf(Date);
      expect(row?.removeReason).toBe('Dried out by Tuesday');
      expect(row?.removedBy?.toString()).toBe(ctx.managerUserId);

      // The date is free again.
      await api()
        .post('/api/v1/hr/calendar/days')
        .set(auth(managerToken))
        .send({
          source: 'manual',
          days: [
            {
              date: '2026-11-03',
              kind: 'special_working_day',
              label: 'Make-up day',
              reason: 'Open after all',
            },
          ],
        })
        .expect(201);
      const view = await api()
        .get('/api/v1/hr/calendar?year=2026')
        .set(auth(producerToken))
        .expect(200);
      expect(
        (view.body as AgencyCalendarView).workingDaysByMonth['2026-11'],
      ).toBe(19);
    });
  });

  describe('holiday proposals', () => {
    it('404s a year with no proposal', async () => {
      await api()
        .post('/api/v1/hr/calendar/proposals/2031/confirm')
        .set(auth(managerToken))
        .send({ dates: [] })
        .expect(404);
    });

    it('writes only the chosen dates, skips one already present, and is idempotent', async () => {
      await calendars.updateOne(
        { agencyId: ctx.agencyId },
        {
          $push: {
            proposals: {
              year: 2027,
              status: 'pending',
              proposedAt: new Date(),
              items: [
                {
                  date: '2027-01-01',
                  name: "New Year's Day",
                  type: 'public',
                  substitute: false,
                },
                {
                  date: '2027-07-05',
                  name: 'Independence Day (substitute day)',
                  type: 'public',
                  substitute: true,
                },
                {
                  date: '2027-11-25',
                  name: 'Thanksgiving Day',
                  type: 'public',
                  substitute: false,
                },
              ],
              decidedAt: null,
              decidedBy: null,
            },
          },
        },
      );
      // One of them was imported by hand already.
      await calendarDays.create({
        agencyId: ctx.agencyId,
        date: '2027-11-25',
        kind: 'holiday',
        label: 'Thanksgiving',
        source: 'import',
        reason: null,
      });

      const pending = await api()
        .get('/api/v1/hr/calendar?year=2027')
        .set(auth(managerToken))
        .expect(200);
      expect((pending.body as AgencyCalendarView).pendingProposal?.year).toBe(
        2027,
      );

      await api()
        .post('/api/v1/hr/calendar/proposals/2027/confirm')
        .set(auth(managerToken))
        .send({ dates: ['2027-01-01', '2027-02-02'] })
        .expect(400);

      const confirmed = await api()
        .post('/api/v1/hr/calendar/proposals/2027/confirm')
        .set(auth(managerToken))
        .send({ dates: ['2027-01-01', '2027-11-25'] })
        .expect(200);
      expect((confirmed.body as { status: string }).status).toBe('confirmed');

      const rows = await calendarDays
        .find({
          agencyId: ctx.agencyId,
          removedAt: null,
          date: { $regex: '^2027' },
        })
        .sort({ date: 1 })
        .lean();
      expect(rows.map((r) => [r.date, r.source])).toEqual([
        ['2027-01-01', 'proposal'],
        ['2027-11-25', 'import'],
      ]);

      // A second confirm changes nothing.
      await api()
        .post('/api/v1/hr/calendar/proposals/2027/confirm')
        .set(auth(managerToken))
        .send({ dates: ['2027-07-05'] })
        .expect(200);
      expect(
        await calendarDays.countDocuments({
          agencyId: ctx.agencyId,
          date: '2027-07-05',
          removedAt: null,
        }),
      ).toBe(0);
      const after = await api()
        .get('/api/v1/hr/calendar?year=2027')
        .set(auth(managerToken))
        .expect(200);
      expect((after.body as AgencyCalendarView).pendingProposal).toBeNull();
    });
  });

  describe('leave policies', () => {
    let policyId: string;

    it('starts empty, and the HR Policy view says so', async () => {
      const list = await api()
        .get('/api/v1/hr/leave-policies')
        .set(auth(managerToken))
        .expect(200);
      expect((list.body as LeavePoliciesResponse).policies).toEqual([]);
      const view = await api()
        .get('/api/v1/hr/policy')
        .set(auth(managerToken))
        .expect(200);
      expect((view.body as HrPolicyView).leaveAndAttendance).toEqual({
        status: 'none',
        activePolicyCount: 0,
      });
    });

    it('creates a policy from the defaults plus a patch', async () => {
      const res = await api()
        .post('/api/v1/hr/leave-policies')
        .set(auth(managerToken))
        .send({
          name: 'Company policy',
          rules: { pto: { annualAllocationHours: 120 } },
        })
        .expect(201);
      const body = res.body as LeavePolicyView;
      policyId = body.id;
      expect(body).toMatchObject({
        name: 'Company policy',
        status: 'active',
        version: 1,
        employeeCount: 0,
      });
      expect(body.rules.pto.annualAllocationHours).toBe(120);
      expect(body.rules.requests.partialDayIncrementMinutes).toBe(15);
      expect(body.rules.routing['timeoff.submitted']).toEqual([
        'branch_reviewers',
      ]);

      const view = await api()
        .get('/api/v1/hr/policy')
        .set(auth(managerToken))
        .expect(200);
      expect((view.body as HrPolicyView).leaveAndAttendance).toEqual({
        status: 'configured',
        activePolicyCount: 1,
      });
    });

    it('409s a duplicate name, case-insensitively', async () => {
      await api()
        .post('/api/v1/hr/leave-policies')
        .set(auth(managerToken))
        .send({ name: 'company POLICY' })
        .expect(409);
    });

    it('patches a section, replaces an array whole, and bumps the version', async () => {
      const res = await api()
        .patch(`/api/v1/hr/leave-policies/${policyId}`)
        .set(auth(managerToken))
        .send({
          rules: {
            points: { ladders: { tardy: [2, 4] } },
            attendance: { tardyGraceMinutes: 10 },
          },
        })
        .expect(200);
      const body = res.body as LeavePolicyView;
      expect(body.version).toBe(2);
      expect(body.rules.points.ladders).toEqual({
        tardy: [2, 4],
        absence: [2, 3, 4],
      });
      expect(body.rules.attendance.tardyGraceMinutes).toBe(10);
      expect(body.rules.pto.annualAllocationHours).toBe(120);
    });

    it('400s an inconsistent merged result, naming the problems', async () => {
      const res = await api()
        .patch(`/api/v1/hr/leave-policies/${policyId}`)
        .set(auth(managerToken))
        .send({
          rules: {
            pto: { resetBasis: 'fiscal_year' },
            points: {
              thresholds: [
                { points: 5, recipients: [], guidance: '' },
                { points: 5, recipients: [], guidance: '' },
              ],
            },
          },
        })
        .expect(400);
      const message = (res.body as { message: string }).message;
      expect(message).toContain('fiscal-year start');
      expect(message).toContain('ascending');
      // Nothing was written.
      const current = await api()
        .get(`/api/v1/hr/leave-policies/${policyId}`)
        .set(auth(managerToken))
        .expect(200);
      expect((current.body as LeavePolicyView).version).toBe(2);
    });

    it('400s a malformed patch', async () => {
      await api()
        .patch(`/api/v1/hr/leave-policies/${policyId}`)
        .set(auth(managerToken))
        .send({ rules: { requests: { coverageNote: 'sometimes' } } })
        .expect(400);
      await api()
        .patch(`/api/v1/hr/leave-policies/${policyId}`)
        .set(auth(managerToken))
        .send({})
        .expect(400);
    });

    it('archives the last policy — the agency then has none — and refuses edits to it', async () => {
      const second = await api()
        .post('/api/v1/hr/leave-policies')
        .set(auth(ownerToken))
        .send({ name: 'Producers' })
        .expect(201);
      const secondId = (second.body as LeavePolicyView).id;

      const archived = await api()
        .post(`/api/v1/hr/leave-policies/${policyId}/archive`)
        .set(auth(managerToken))
        .expect(200);
      expect((archived.body as LeavePolicyView).status).toBe('archived');
      await api()
        .patch(`/api/v1/hr/leave-policies/${policyId}`)
        .set(auth(managerToken))
        .send({ name: 'Renamed' })
        .expect(409);
      // The name is free again for an active policy.
      await api()
        .post('/api/v1/hr/leave-policies')
        .set(auth(managerToken))
        .send({ name: 'Company policy' })
        .expect(201);

      const list = await api()
        .get('/api/v1/hr/leave-policies')
        .set(auth(managerToken))
        .expect(200);
      const policies = (list.body as LeavePoliciesResponse).policies;
      expect(policies.map((p) => [p.name, p.status])).toEqual([
        ['Company policy', 'active'],
        ['Producers', 'active'],
        ['Company policy', 'archived'],
      ]);

      // Archive everything: zero policies is a valid state.
      for (const p of policies.filter((p) => p.status === 'active')) {
        await api()
          .post(`/api/v1/hr/leave-policies/${p.id}/archive`)
          .set(auth(managerToken))
          .expect(200);
      }
      void secondId;
      const view = await api()
        .get('/api/v1/hr/policy')
        .set(auth(managerToken))
        .expect(200);
      expect((view.body as HrPolicyView).leaveAndAttendance).toEqual({
        status: 'none',
        activePolicyCount: 0,
      });
    });

    it('404s a policy from another agency', async () => {
      await api()
        .get(`/api/v1/hr/leave-policies/${new Types.ObjectId().toHexString()}`)
        .set(auth(managerToken))
        .expect(404);
    });
  });

  describe('agency setup flags (PAC-161)', () => {
    it('echoes the two HR phases after completion', async () => {
      await agencies.updateOne(
        { _id: new Types.ObjectId(ctx.agencyId) },
        { $set: { setup: { status: 'pending' } } },
      );
      const res = await api()
        .post('/api/v1/agency/setup/complete')
        .set(auth(ownerToken))
        .send({ calendarSkipped: true, hrPolicySkipped: true })
        .expect(200);
      expect(res.body).toMatchObject({
        status: 'complete',
        brandingSkipped: false,
        calendarSkipped: true,
        hrPolicySkipped: true,
      });
      const view = await api()
        .get('/api/v1/hr/policy')
        .set(auth(managerToken))
        .expect(200);
      expect((view.body as HrPolicyView).leaveAndAttendance.status).toBe(
        'skipped',
      );
    });
  });
});
