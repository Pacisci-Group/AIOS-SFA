import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import {
  AgencyPermission,
  DEFAULT_AGENCY_TIME_ZONE,
  defaultTimeOffPolicyRules,
  FEDERAL_HOLIDAY_KEYS,
  type AgencyEventView,
  type HrCalendarEntry,
  type HrCalendarFilters,
  type HrCalendarResponse,
  type HrPolicyView,
  type TimeOffRequestView,
} from '@sfa/shared';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Branch } from '../src/branches/schemas/branch.schema';
import { EmployeeProfile } from '../src/hr/schemas/employee-profile.schema';
import { LeaveLedger } from '../src/hr/schemas/leave-ledger.schema';
import { agencyTodayIso } from '../src/performance/performance.range';
import { RoleAssignmentsService } from '../src/permissions/role-assignments.service';
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

const DAY_MS = 86_400_000;
const addDays = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
const weekday = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();

type Leave = Extract<HrCalendarEntry, { kind: 'leave' }>;
type EventEntry = Extract<HrCalendarEntry, { kind: 'event' }>;

/**
 * The HR calendar read (PAC-169): what each kind of caller receives.
 *
 * The date maths (yearly occurrences, the holiday merge, conflicts) and the
 * scope rule are unit-tested. What only a running app can answer is here,
 * and it is mostly about what must **not** come back: a colleague's leave
 * to someone without the team calendar, another branch's to a branch-scoped
 * holder, the reason for leave to anyone who could not open the request, a
 * hidden birthday, a year of birth, an event for other people, another
 * agency's anything.
 *
 * One window, three weeks out, holds every fixture:
 *
 * | Who | Branch | Leave |
 * |---|---|---|
 * | producer | main | Mon–Tue approved, Thu pending |
 * | manager | main | Wed approved |
 * | outsider | other | Mon approved, Fri pending |
 */
describe('HR calendar (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestSeedContext;
  let users: Model<User>;
  let profiles: Model<EmployeeProfile>;
  let requests: Model<TimeOffRequest>;

  let ownerToken: string;
  let managerToken: string;
  let producerToken: string;
  let outsiderToken: string;
  /** Agency scope, `hr:read` + the team calendar, **not** a reviewer. */
  let watcherToken: string;
  let ownerId: string;
  let producerId: string;
  let outsiderId: string;
  let otherBranchId: string;
  let today: string;
  let monday: string;
  let ptoId: string;

  let producerApproved: TimeOffRequestView;
  let producerPending: TimeOffRequestView;
  let managerApproved: TimeOffRequestView;
  let outsiderApproved: TimeOffRequestView;
  let outsiderPending: TimeOffRequestView;

  const api = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  const login = async (email: string, password = TEST_PASSWORD) => {
    const response = await api()
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(201);
    return (response.body as { accessToken: string }).accessToken;
  };

  const calendar = async (
    token: string,
    query: Record<string, string | string[]> = {},
  ) => {
    const res = await api()
      .get('/api/v1/hr/calendar')
      .query({ from: monday, to: addDays(monday, 6), ...query })
      .set(auth(token))
      .expect(200);
    return res.body as HrCalendarResponse;
  };

  const leaveOf = (response: HrCalendarResponse) =>
    response.entries.filter((entry): entry is Leave => entry.kind === 'leave');
  const eventsOf = (response: HrCalendarResponse) =>
    response.entries.filter(
      (entry): entry is EventEntry => entry.kind === 'event',
    );
  const ids = (entries: Leave[]) => entries.map((entry) => entry.id).sort();
  const leaveId = (view: TimeOffRequestView) => `leave:${view.id}`;

  const send = async (token: string, firstDay: string, lastDay = firstDay) => {
    const res = await api()
      .post('/api/v1/time-off/requests')
      .set(auth(token))
      .send({ policyId: ptoId, firstDay, lastDay, dayMode: 'full', send: true })
      .expect(201);
    return res.body as TimeOffRequestView;
  };

  const approve = async (token: string, id: string) => {
    const res = await api()
      .post(`/api/v1/time-off/requests/${id}/approve`)
      .set(auth(token))
      .send({})
      .expect(200);
    return res.body as TimeOffRequestView;
  };

  const createEvent = async (over: Record<string, unknown>) => {
    const res = await api()
      .post('/api/v1/hr/events')
      .set(auth(managerToken))
      .send({
        name: 'Event',
        firstDay: monday,
        effect: 'none',
        audience: { kind: 'agency' },
        ...over,
      })
      .expect(201);
    return (res.body as { event: AgencyEventView }).event;
  };

  const setProfile = (userId: string, facts: Record<string, unknown>) =>
    profiles.updateOne(
      { agencyId: ctx.agencyId, userId: new Types.ObjectId(userId) },
      {
        $set: { status: 'active', ...facts },
        $setOnInsert: { terminationDate: null },
      },
      { upsert: true },
    );

  beforeAll(async () => {
    app = await createTestApp();
    await dropTestDatabase(app);
    ctx = await seedTestData(app);
    users = app.get<Model<User>>(getModelToken(User.name));
    profiles = app.get<Model<EmployeeProfile>>(
      getModelToken(EmployeeProfile.name),
    );
    requests = app.get<Model<TimeOffRequest>>(
      getModelToken(TimeOffRequest.name),
    );
    await app
      .get<Model<LeaveLedger>>(getModelToken(LeaveLedger.name))
      .syncIndexes();
    await requests.syncIndexes();

    ownerToken = await login(ctx.ownerEmail);
    managerToken = await login(ctx.managerEmail);
    producerToken = await login(ctx.producerEmail);

    const agencyId = new Types.ObjectId(ctx.agencyId);
    const producer = (await users
      .findOne({ email: ctx.producerEmail })
      .select('_id passwordHash')
      .lean())!;
    producerId = producer._id.toString();
    ownerId = (await users
      .findOne({ email: ctx.ownerEmail })
      .select('_id')
      .lean())!._id.toString();
    const assignments = app.get(RoleAssignmentsService);
    const actor = { userId: ownerId, isPlatformAdmin: true };

    const otherBranch = (await app
      .get<Model<Branch>>(getModelToken(Branch.name))
      .findOne({ agencyId, name: 'Other Branch' })
      .lean())!;
    otherBranchId = otherBranch._id.toString();

    const person = async (
      email: string,
      firstName: string,
      branchId: Types.ObjectId,
      roleId: string,
    ) => {
      const user = await users.create({
        agencyId,
        branchId,
        email,
        passwordHash: producer.passwordHash,
        firstName,
        lastName: 'Calendar',
        isActive: true,
      });
      await assignments.setUserRoles(actor, agencyId, user._id, [
        new Types.ObjectId(roleId),
      ]);
      return user._id.toString();
    };
    outsiderId = await person(
      'calendar-outsider@sfa.local',
      'Olive',
      otherBranch._id,
      ctx.producerRoleId,
    );
    outsiderToken = await login('calendar-outsider@sfa.local');

    // An agency-scope role holding the team calendar and no review.
    await assignments.setRolePermissions(
      agencyId,
      new Types.ObjectId(ctx.editableRoleId),
      ['hr:read', AgencyPermission.HrTeamCalendar],
    );
    await person(
      'calendar-watcher@sfa.local',
      'Wendy',
      new Types.ObjectId(ctx.branchId),
      ctx.editableRoleId,
    );
    watcherToken = await login('calendar-watcher@sfa.local');

    const agency = await app
      .get<Model<Agency>>(getModelToken(Agency.name))
      .findById(ctx.agencyId)
      .select('timezone')
      .lean<{ timezone?: string } | null>();
    today = agencyTodayIso(agency?.timezone ?? DEFAULT_AGENCY_TIME_ZONE);
    monday = addDays(today, 15);
    while (weekday(monday) !== 1) monday = addDays(monday, 1);
    const farReset = addDays(today, 200).slice(5).replace('02-29', '02-28');

    const policy = await api()
      .post('/api/v1/hr/policies')
      .set(auth(managerToken))
      .send({
        type: 'time_off',
        name: 'Calendar PTO',
        timeOff: {
          ...defaultTimeOffPolicyRules('pto'),
          hoursPerYear: 120,
          resetMonthDay: farReset,
        },
        memberIds: [producerId, outsiderId, ctx.managerUserId],
      })
      .expect(201);
    ptoId = (policy.body as HrPolicyView).id;

    producerApproved = await approve(
      managerToken,
      (await send(producerToken, monday, addDays(monday, 1))).id,
    );
    producerPending = await send(producerToken, addDays(monday, 3));
    managerApproved = await approve(
      ownerToken,
      (await send(managerToken, addDays(monday, 2))).id,
    );
    outsiderApproved = await approve(
      ownerToken,
      (await send(outsiderToken, monday)).id,
    );
    outsiderPending = await send(outsiderToken, addDays(monday, 4));

    // Birthdays and anniversaries inside the window, by month and day.
    const md = (offset: number) => addDays(monday, offset).slice(5);
    await setProfile(producerId, {
      hireDate: `2019-${md(1)}`,
      dateOfBirth: `1990-${md(2)}`,
      showBirthday: true,
    });
    await setProfile(ctx.managerUserId, {
      hireDate: `2015-${md(3)}`,
      dateOfBirth: `1985-${md(3)}`,
      showBirthday: false,
    });
    await setProfile(outsiderId, {
      // Hired this year: no anniversary yet.
      hireDate: `${monday.slice(0, 4)}-${md(4)}`,
      dateOfBirth: `1992-${md(4)}`,
      showBirthday: true,
    });
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  describe('time off: whose is shown', () => {
    it('shows an employee their own leave and nobody else’s', async () => {
      const response = await calendar(producerToken);
      expect(response.viewer).toEqual({
        seesTeam: false,
        seesPending: false,
        managesEvents: false,
      });
      const leave = leaveOf(response);
      expect(ids(leave)).toEqual(
        [leaveId(producerApproved), leaveId(producerPending)].sort(),
      );
      expect(leave.every((entry) => entry.mine)).toBe(true);
      // Their own requests open, with what they are.
      const approved = leave.find(
        (entry) => entry.id === leaveId(producerApproved),
      )!;
      expect(approved).toMatchObject({
        firstDay: monday,
        lastDay: addDays(monday, 1),
        status: 'approved',
        person: { id: producerId },
        detail: {
          requestId: producerApproved.id,
          reference: producerApproved.reference,
          policyName: 'Calendar PTO',
          totalHours: 16,
          conflicts: [],
        },
      });
      expect(
        leave.find((entry) => entry.id === leaveId(producerPending))?.status,
      ).toBe('pending');
    });

    it('does not let a filter widen that', async () => {
      const response = await calendar(producerToken, {
        employeeId: [ctx.managerUserId, outsiderId],
        branchId: otherBranchId,
      });
      expect(leaveOf(response)).toEqual([]);
    });

    it('shows a Branch Manager their branch — approved and pending — and never another branch', async () => {
      const response = await calendar(managerToken);
      expect(response.viewer).toEqual({
        seesTeam: true,
        seesPending: true,
        managesEvents: true,
      });
      const leave = leaveOf(response);
      expect(ids(leave)).toEqual(
        [
          leaveId(producerApproved),
          leaveId(producerPending),
          leaveId(managerApproved),
        ].sort(),
      );
      // A reviewer in scope opens the producer's requests.
      expect(
        leave.find((entry) => entry.id === leaveId(producerPending))?.detail,
      ).toMatchObject({
        requestId: producerPending.id,
      });

      // Asking for the other branch, or its person, returns nothing — not theirs.
      expect(
        leaveOf(await calendar(managerToken, { branchId: otherBranchId })),
      ).toEqual([]);
      expect(
        leaveOf(await calendar(managerToken, { employeeId: outsiderId })),
      ).toEqual([]);
      const raw = JSON.stringify(await calendar(managerToken));
      expect(raw).not.toContain(outsiderApproved.id);
      expect(raw).not.toContain(outsiderPending.id);
    });

    it('shows the owner the whole agency, and narrows by branch and by person', async () => {
      const all = leaveOf(await calendar(ownerToken));
      expect(ids(all)).toEqual(
        [
          leaveId(producerApproved),
          leaveId(producerPending),
          leaveId(managerApproved),
          leaveId(outsiderApproved),
          leaveId(outsiderPending),
        ].sort(),
      );
      expect(
        ids(leaveOf(await calendar(ownerToken, { branchId: otherBranchId }))),
      ).toEqual([leaveId(outsiderApproved), leaveId(outsiderPending)].sort());
      expect(
        ids(
          leaveOf(
            await calendar(ownerToken, {
              employeeId: [producerId, outsiderId],
            }),
          ),
        ),
      ).toEqual(
        [
          leaveId(producerApproved),
          leaveId(producerPending),
          leaveId(outsiderApproved),
          leaveId(outsiderPending),
        ].sort(),
      );
      // Comma-separated is the same as repeated.
      expect(
        leaveOf(
          await calendar(ownerToken, {
            employeeId: `${producerId},${outsiderId}`,
          }),
        ),
      ).toHaveLength(4);
    });

    it('shows a holder who is not a reviewer that people are out, and nothing about why', async () => {
      const response = await calendar(watcherToken);
      expect(response.viewer).toEqual({
        seesTeam: true,
        seesPending: false,
        managesEvents: false,
      });
      const leave = leaveOf(response);
      // Approved only — an undecided request is the reviewer's business.
      expect(ids(leave)).toEqual(
        [
          leaveId(producerApproved),
          leaveId(managerApproved),
          leaveId(outsiderApproved),
        ].sort(),
      );
      expect(leave.every((entry) => entry.detail === null)).toBe(true);
      expect(leave.every((entry) => entry.status === 'approved')).toBe(true);
      const raw = JSON.stringify(response);
      expect(raw).not.toContain('Calendar PTO');
      expect(raw).not.toContain('TOR-');
      // What they are shown, they cannot open: the request read still refuses.
      await api()
        .get(`/api/v1/time-off/requests/${producerApproved.id}`)
        .set(auth(watcherToken))
        .expect(404);
    });

    it('leaves out drafts, discarded drafts, declined, cancelled and imported rows', async () => {
      const agencyId = ctx.agencyId;
      const base = {
        agencyId,
        branchId: ctx.branchId,
        employeeId: new Types.ObjectId(producerId),
        initiatorId: new Types.ObjectId(producerId),
        policyId: new Types.ObjectId(ptoId),
        firstDay: addDays(monday, 4),
        lastDay: addDays(monday, 4),
        dayMode: 'full',
        days: [
          {
            date: addDays(monday, 4),
            hours: 8,
            scheduledHours: 8,
            reason: 'scheduled',
          },
        ],
        totalHours: 8,
      };
      const made = await requests.insertMany([
        { ...base, source: 'self', status: 'draft' },
        { ...base, source: 'self', status: 'declined' },
        { ...base, source: 'self', status: 'cancelled' },
        { ...base, source: 'self', status: 'approved', deletedAt: new Date() },
        // An imported row carries no status at all.
        { ...base, source: 'legacy', days: [] },
      ]);
      const hidden = made.map((row) => `leave:${row._id.toString()}`);
      for (const token of [producerToken, managerToken, ownerToken]) {
        const shown = leaveOf(await calendar(token)).map((entry) => entry.id);
        for (const id of hidden) expect(shown).not.toContain(id);
      }
      await requests.deleteMany({ _id: { $in: made.map((row) => row._id) } });
    });

    it('returns nothing of this agency to another agency', async () => {
      const otherToken = await login(ctx.otherAgencyUserEmail);
      const res = await api()
        .get('/api/v1/hr/calendar')
        .query({ from: monday, to: addDays(monday, 6) })
        .set(auth(otherToken));
      // Either their agency has no HR module, or it has and the read is theirs alone.
      if (res.status === 200) {
        const raw = JSON.stringify(res.body);
        for (const id of [producerId, outsiderId, ctx.managerUserId]) {
          expect(raw).not.toContain(id);
        }
      } else {
        expect(res.status).toBe(403);
      }
    });
  });

  describe('birthdays and anniversaries', () => {
    it('shows everyone the day of an opted-in birthday — never the year, never a hidden one', async () => {
      for (const token of [producerToken, watcherToken, ownerToken]) {
        const response = await calendar(token);
        const birthdays = response.entries.filter(
          (entry) => entry.kind === 'birthday',
        );
        expect(
          birthdays.map((entry) => [entry.person.id, entry.firstDay]).sort(),
        ).toEqual(
          [
            [producerId, addDays(monday, 2)],
            [outsiderId, addDays(monday, 4)],
          ].sort(),
        );
        const raw = JSON.stringify(response);
        // No year of birth, and nothing named after it, anywhere in the response.
        for (const year of ['1990-', '1985-', '1992-'])
          expect(raw).not.toContain(year);
        expect(raw).not.toMatch(/dateOfBirth|"age"/);
      }
    });

    it('shows a work anniversary from the first year on, with the years', async () => {
      const response = await calendar(producerToken);
      const anniversaries = response.entries.filter(
        (entry) => entry.kind === 'anniversary',
      );
      const year = Number(monday.slice(0, 4));
      expect(
        anniversaries
          .map((entry) => [entry.person.id, entry.firstDay, entry.years])
          .sort(),
      ).toEqual(
        [
          [
            producerId,
            addDays(monday, 1),
            Number(addDays(monday, 1).slice(0, 4)) - 2019,
          ],
          [
            ctx.managerUserId,
            addDays(monday, 3),
            Number(addDays(monday, 3).slice(0, 4)) - 2015,
          ],
        ].sort(),
      );
      // Hired this year: nothing to mark yet.
      expect(anniversaries.map((entry) => entry.person.id)).not.toContain(
        outsiderId,
      );
      expect(year).toBeGreaterThan(2019);
    });

    it('narrows them with the same filters', async () => {
      const response = await calendar(ownerToken, { branchId: otherBranchId });
      const people = response.entries
        .filter(
          (entry) => entry.kind === 'birthday' || entry.kind === 'anniversary',
        )
        .map((entry) => entry.person.id);
      expect([...new Set(people)]).toEqual([outsiderId]);
    });
  });

  describe('events and holidays', () => {
    let everyone: AgencyEventView;
    let otherBranchOnly: AgencyEventView;
    let managerOnly: AgencyEventView;

    beforeAll(async () => {
      everyone = await createEvent({
        name: 'Christmas party',
        firstDay: addDays(monday, 4),
        startTime: '18:00',
        endTime: '21:00',
      });
      otherBranchOnly = await createEvent({
        name: 'Other branch stocktake',
        firstDay: monday,
        effect: 'blackout',
        audience: { kind: 'branches', branchIds: [otherBranchId] },
      });
      managerOnly = await createEvent({
        name: 'Managers offsite',
        firstDay: addDays(monday, 2),
        effect: 'day_off',
        audience: { kind: 'people', userIds: [ctx.managerUserId] },
      });
      await api()
        .post('/api/v1/hr/policies')
        .set(auth(managerToken))
        .send({
          type: 'holiday',
          name: 'Calendar holidays',
          holiday: {
            holidays: FEDERAL_HOLIDAY_KEYS,
            customHolidays: [
              {
                id: 'founders',
                name: 'Founders days',
                start: addDays(monday, 5),
                end: addDays(monday, 6),
                repeatsYearly: false,
              },
            ],
          },
          memberIds: [producerId],
        })
        .expect(201);
    });

    it('shows an event to its audience, and every event to the admin who manages them', async () => {
      // The producer: main branch, not named — the agency-wide one only.
      const asProducer = eventsOf(await calendar(producerToken));
      expect(asProducer.map((entry) => entry.eventId)).toEqual([everyone.id]);
      expect(asProducer[0]).toMatchObject({
        name: 'Christmas party',
        startTime: '18:00',
        endTime: '21:00',
        effect: 'none',
        audienceLabel: 'Everyone',
        appliesToMe: true,
      });
      // The outsider: their branch's blackout too.
      expect(
        eventsOf(await calendar(outsiderToken))
          .map((entry) => entry.eventId)
          .sort(),
      ).toEqual([everyone.id, otherBranchOnly.id].sort());
      // A team-calendar holder is not an admin: only what is for them.
      expect(
        eventsOf(await calendar(watcherToken)).map((entry) => entry.eventId),
      ).toEqual([everyone.id]);

      // The Branch Manager manages events: all three, marked for whom.
      const asManager = eventsOf(await calendar(managerToken));
      expect(
        asManager.map((entry) => [entry.eventId, entry.appliesToMe]).sort(),
      ).toEqual(
        [
          [everyone.id, true],
          [otherBranchOnly.id, false],
          [managerOnly.id, true],
        ].sort(),
      );
      // The audience is a label; who exactly is the edit form's.
      const raw = JSON.stringify(asManager);
      expect(raw).not.toContain('userIds');
      expect(raw).not.toContain('branchIds');
      expect(
        asManager.find((entry) => entry.eventId === otherBranchOnly.id)
          ?.audienceLabel,
      ).toBe('Other Branch');
    });

    it('flags the leave an event runs into, to those who can open the request', async () => {
      // The manager's approved Wednesday now sits on their own day off.
      const mine = leaveOf(await calendar(managerToken)).find(
        (entry) => entry.id === leaveId(managerApproved),
      )!;
      expect(mine.detail?.conflicts).toEqual([
        {
          eventId: managerOnly.id,
          name: 'Managers offsite',
          effect: 'day_off',
          dates: [addDays(monday, 2)],
        },
      ]);
      // The outsider's approved Monday is under their branch's blackout.
      const theirs = leaveOf(await calendar(ownerToken)).find(
        (entry) => entry.id === leaveId(outsiderApproved),
      )!;
      expect(
        theirs.detail?.conflicts.map((conflict) => conflict.effect),
      ).toEqual(['blackout']);
      // The producer's Monday is not: that event is not for their branch.
      const producers = leaveOf(await calendar(ownerToken)).find(
        (entry) => entry.id === leaveId(producerApproved),
      )!;
      expect(producers.detail?.conflicts).toEqual([]);
    });

    it('shows the holidays of the people in view, a custom range as one entry', async () => {
      const mineAsProducer = (await calendar(producerToken)).entries.filter(
        (entry) => entry.kind === 'holiday',
      );
      const founders = mineAsProducer.find(
        (entry) => entry.name === 'Founders days',
      );
      expect(founders).toMatchObject({
        firstDay: addDays(monday, 5),
        lastDay: addDays(monday, 6),
        mine: true,
        policies: [{ id: expect.any(String), name: 'Calendar holidays' }],
      });
      // The policy's people ride along once, for the holiday sheet.
      const asProducerResponse = await calendar(producerToken);
      expect(asProducerResponse.holidayPolicies).toEqual([
        {
          id: founders!.policies[0].id,
          name: 'Calendar holidays',
          members: [{ id: producerId, name: expect.any(String) }],
        },
      ]);
      // Someone in no Holiday policy, who sees only themself, has no holidays.
      expect(
        (await calendar(outsiderToken)).entries.filter(
          (entry) => entry.kind === 'holiday',
        ),
      ).toEqual([]);
      // The manager sees the producer's, marked as not their own.
      const asManager = (await calendar(managerToken)).entries.filter(
        (entry) => entry.kind === 'holiday',
      );
      expect(
        asManager.find((entry) => entry.name === 'Founders days'),
      ).toMatchObject({
        mine: false,
      });
    });
  });

  describe('the request', () => {
    it('refuses a range that is malformed, backwards or over 92 days', async () => {
      const get = (query: Record<string, string>) =>
        api().get('/api/v1/hr/calendar').query(query).set(auth(producerToken));
      await get({ from: monday, to: addDays(monday, 91) }).expect(200);
      await get({ from: monday, to: addDays(monday, 92) }).expect(400);
      await get({ from: monday, to: addDays(monday, -1) }).expect(400);
      await get({ from: '2026-02-30', to: '2026-03-02' }).expect(400);
      await get({ from: monday }).expect(400);
      await get({
        from: monday,
        to: addDays(monday, 6),
        employeeId: 'nobody',
      }).expect(400);
    });

    it('needs hr:read', async () => {
      await api()
        .get('/api/v1/hr/calendar')
        .query({ from: monday, to: addDays(monday, 6) })
        .expect(401);
    });

    it('offers filters only to someone who sees a team, cut to their scope', async () => {
      const filters = async (token: string) =>
        (
          await api()
            .get('/api/v1/hr/calendar/filters')
            .set(auth(token))
            .expect(200)
        ).body as HrCalendarFilters;

      expect(await filters(producerToken)).toEqual({
        branches: [],
        people: [],
      });

      const asManager = await filters(managerToken);
      expect(asManager.branches.map((branch) => branch.id)).toEqual([
        ctx.branchId,
      ]);
      const managed = asManager.people.map((person) => person.id);
      expect(managed).toEqual(
        expect.arrayContaining([producerId, ctx.managerUserId]),
      );
      expect(managed).not.toContain(outsiderId);

      const asOwner = await filters(ownerToken);
      expect(asOwner.branches.map((branch) => branch.id)).toEqual(
        expect.arrayContaining([ctx.branchId, otherBranchId]),
      );
      expect(
        asOwner.people.find((person) => person.id === outsiderId),
      ).toMatchObject({
        branchId: otherBranchId,
      });
      // The owner has no branch of their own: they are placed in the default one.
      expect(
        asOwner.people.find((person) => person.id === ownerId)?.branchId,
      ).toBeTruthy();
    });
  });
});
