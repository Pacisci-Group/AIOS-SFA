import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import {
  DEFAULT_AGENCY_TIME_ZONE,
  defaultTimeOffPolicyRules,
  type AgencyEventAudienceOptions,
  type AgencyEventImpact,
  type AgencyEventView,
  type HrPolicyView,
  type TimeOffPreview,
  type TimeOffRequestView,
} from '@sfa/shared';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Branch } from '../src/branches/schemas/branch.schema';
import { AgencyEvent } from '../src/hr/schemas/agency-event.schema';
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

interface Refusal {
  code?: string;
  message?: string;
  blockers?: { code: string; message: string }[];
}

type Saved = { event: AgencyEventView; impact: AgencyEventImpact };

/**
 * Agency events (PAC-169): who may write them, what a saved event runs
 * into, and what the two effects do to a time off request.
 *
 * The rules of an event (`agencyEventError`) and whom it is for
 * (`eventAppliesTo`) are unit-tested in `@sfa/shared`. What only a running
 * app can answer is here: the gate, that an audience must be the agency's
 * own, that the impact list never names someone the caller could not see,
 * and that a blackout blocks, a day off costs nothing, and neither touches a
 * request that was already sent.
 *
 * Every date is computed from the agency's today; each test takes its own
 * week (`week(n)`), so one test's event never blocks another's request.
 */
describe('Agency events (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestSeedContext;
  let users: Model<User>;
  let events: Model<AgencyEvent>;
  let requests: Model<TimeOffRequest>;
  let ledger: Model<LeaveLedger>;

  let ownerToken: string;
  let managerToken: string;
  let producerToken: string;
  let outsiderToken: string;
  let producerId: string;
  let outsiderId: string;
  let otherBranchId: string;
  let today: string;
  let ptoId: string;

  const api = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  const login = async (email: string, password = TEST_PASSWORD) => {
    const response = await api()
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(201);
    return (response.body as { accessToken: string }).accessToken;
  };

  /** The Monday `n` weeks after next Monday — always at least a week away. */
  const week = (n: number) => {
    let day = addDays(today, 1);
    while (weekday(day) !== 1) day = addDays(day, 1);
    return addDays(day, n * 7);
  };

  const event = (over: Record<string, unknown> = {}) => ({
    name: 'Company meetup',
    firstDay: week(0),
    effect: 'none',
    audience: { kind: 'agency' },
    ...over,
  });

  const create = async (token: string, over: Record<string, unknown> = {}) => {
    const res = await api()
      .post('/api/v1/hr/events')
      .set(auth(token))
      .send(event(over))
      .expect(201);
    return res.body as Saved;
  };

  const remove = (token: string, id: string) =>
    api().delete(`/api/v1/hr/events/${id}`).set(auth(token));

  const impactOf = async (token: string, over: Record<string, unknown>) => {
    const res = await api()
      .post('/api/v1/hr/events/impact')
      .set(auth(token))
      .send(event(over))
      .expect(200);
    return res.body as AgencyEventImpact;
  };

  const requestBody = (firstDay: string, lastDay = firstDay) => ({
    policyId: ptoId,
    firstDay,
    lastDay,
    dayMode: 'full',
  });

  const send = async (token: string, firstDay: string, lastDay = firstDay) => {
    const res = await api()
      .post('/api/v1/time-off/requests')
      .set(auth(token))
      .send({ ...requestBody(firstDay, lastDay), send: true })
      .expect(201);
    return res.body as TimeOffRequestView;
  };

  const preview = async (
    token: string,
    firstDay: string,
    lastDay = firstDay,
  ) => {
    const res = await api()
      .post('/api/v1/time-off/requests/preview')
      .set(auth(token))
      .send(requestBody(firstDay, lastDay))
      .expect(200);
    return res.body as TimeOffPreview;
  };

  const approve = (token: string, id: string) =>
    api()
      .post(`/api/v1/time-off/requests/${id}/approve`)
      .set(auth(token))
      .send({});

  const usedHours = async (requestId: string) =>
    (
      await ledger
        .find({ 'source.id': new Types.ObjectId(requestId), kind: 'used' })
        .lean<{ hours: number }[]>()
    ).reduce((sum, row) => sum + Math.abs(row.hours), 0);

  beforeAll(async () => {
    app = await createTestApp();
    await dropTestDatabase(app);
    ctx = await seedTestData(app);
    users = app.get<Model<User>>(getModelToken(User.name));
    events = app.get<Model<AgencyEvent>>(getModelToken(AgencyEvent.name));
    requests = app.get<Model<TimeOffRequest>>(
      getModelToken(TimeOffRequest.name),
    );
    ledger = app.get<Model<LeaveLedger>>(getModelToken(LeaveLedger.name));
    await ledger.syncIndexes();
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
    const owner = (await users
      .findOne({ email: ctx.ownerEmail })
      .select('_id')
      .lean())!;

    // A producer in the agency's second branch: outside the Branch Manager's reach.
    const otherBranch = (await app
      .get<Model<Branch>>(getModelToken(Branch.name))
      .findOne({ agencyId, name: 'Other Branch' })
      .lean())!;
    otherBranchId = otherBranch._id.toString();
    const outsider = await users.create({
      agencyId,
      branchId: otherBranch._id,
      email: 'events-outsider@sfa.local',
      passwordHash: producer.passwordHash,
      firstName: 'Olive',
      lastName: 'Outsider',
      isActive: true,
    });
    outsiderId = outsider._id.toString();
    await app
      .get(RoleAssignmentsService)
      .setUserRoles(
        { userId: owner._id.toString(), isPlatformAdmin: true },
        agencyId,
        outsider._id,
        [new Types.ObjectId(ctx.producerRoleId)],
      );
    outsiderToken = await login('events-outsider@sfa.local');

    const agency = await app
      .get<Model<Agency>>(getModelToken(Agency.name))
      .findById(ctx.agencyId)
      .select('timezone')
      .lean<{ timezone?: string } | null>();
    today = agencyTodayIso(agency?.timezone ?? DEFAULT_AGENCY_TIME_ZONE);
    const farReset = addDays(today, 200).slice(5).replace('02-29', '02-28');

    const policy = await api()
      .post('/api/v1/hr/policies')
      .set(auth(managerToken))
      .send({
        type: 'time_off',
        name: 'Events PTO',
        timeOff: {
          ...defaultTimeOffPolicyRules('pto'),
          hoursPerYear: 120,
          resetMonthDay: farReset,
        },
        memberIds: [producerId, outsiderId, ctx.managerUserId],
      })
      .expect(201);
    ptoId = (policy.body as HrPolicyView).id;
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  describe('who may write events', () => {
    it('refuses someone without agency:hr:admin on every route', async () => {
      await api()
        .post('/api/v1/hr/events')
        .set(auth(producerToken))
        .send(event())
        .expect(403);
      await api()
        .post('/api/v1/hr/events/impact')
        .set(auth(producerToken))
        .send(event())
        .expect(403);
      await api()
        .get('/api/v1/hr/events/audience-options')
        .set(auth(producerToken))
        .expect(403);
      const { event: made } = await create(managerToken);
      await api()
        .get(`/api/v1/hr/events/${made.id}`)
        .set(auth(producerToken))
        .expect(403);
      await api()
        .patch(`/api/v1/hr/events/${made.id}`)
        .set(auth(producerToken))
        .send(event())
        .expect(403);
      await remove(producerToken, made.id).expect(403);
      await remove(managerToken, made.id).expect(204);
    });

    it('is closed to another agency: its admin finds nothing here', async () => {
      const { event: made } = await create(managerToken);
      const otherToken = await login(ctx.otherAgencyUserEmail);
      const res = await api()
        .get(`/api/v1/hr/events/${made.id}`)
        .set(auth(otherToken));
      expect([403, 404]).toContain(res.status);
      await remove(managerToken, made.id).expect(204);
    });
  });

  describe('saving an event', () => {
    it('creates, reads, edits and removes one — the row stays, soft-deleted', async () => {
      const day = week(1);
      const { event: made, impact } = await create(managerToken, {
        name: '  Christmas party  ',
        description: ' Bring a dish. ',
        firstDay: day,
        startTime: '18:00',
        endTime: '21:00',
      });
      expect(made).toMatchObject({
        name: 'Christmas party',
        description: 'Bring a dish.',
        firstDay: day,
        lastDay: day,
        startTime: '18:00',
        endTime: '21:00',
        effect: 'none',
        audience: { kind: 'agency', branchIds: [], userIds: [] },
        audienceLabel: 'Everyone',
      });
      expect(impact).toEqual({ requests: [], hiddenCount: 0 });

      const stored = await events.findById(made.id).lean();
      expect(stored?.agencyId).toBe(ctx.agencyId);
      expect(stored?.createdBy?.toString()).toBe(ctx.managerUserId);
      expect(stored?.deletedAt).toBeNull();

      const edited = await api()
        .patch(`/api/v1/hr/events/${made.id}`)
        .set(auth(managerToken))
        .send(
          event({
            name: 'Holiday party',
            firstDay: day,
            lastDay: addDays(day, 1),
            audience: {
              kind: 'people',
              userIds: [producerId],
              branchIds: [otherBranchId],
            },
          }),
        )
        .expect(200);
      expect((edited.body as Saved).event).toMatchObject({
        name: 'Holiday party',
        lastDay: addDays(day, 1),
        // The times were not sent again: an edit is the whole event.
        startTime: null,
        endTime: null,
        // The list the kind does not use is dropped.
        audience: { kind: 'people', branchIds: [], userIds: [producerId] },
      });
      expect((edited.body as Saved).event.audienceLabel).not.toBe('Everyone');

      const read = await api()
        .get(`/api/v1/hr/events/${made.id}`)
        .set(auth(ownerToken))
        .expect(200);
      expect((read.body as AgencyEventView).name).toBe('Holiday party');

      await remove(managerToken, made.id).expect(204);
      await remove(managerToken, made.id).expect(404);
      await api()
        .get(`/api/v1/hr/events/${made.id}`)
        .set(auth(managerToken))
        .expect(404);
      const gone = await events.findById(made.id).lean();
      expect(gone?.deletedAt).toBeInstanceOf(Date);
      expect(gone?.deletedBy?.toString()).toBe(ctx.managerUserId);
    });

    it('refuses an event that breaks the rules, with the rule as the message', async () => {
      const bad = async (over: Record<string, unknown>) => {
        const res = await api()
          .post('/api/v1/hr/events')
          .set(auth(managerToken))
          .send(event(over))
          .expect(400);
        return JSON.stringify(res.body);
      };
      expect(await bad({ name: ' ' })).toMatch(/Give the event a name/);
      expect(await bad({ lastDay: addDays(week(0), -1) })).toMatch(
        /before the start/,
      );
      expect(await bad({ lastDay: addDays(week(0), 31) })).toMatch(
        /at most 31 days/,
      );
      expect(await bad({ endTime: '21:00' })).toMatch(/Add a start time/);
      expect(
        await bad({ audience: { kind: 'branches', branchIds: [] } }),
      ).toMatch(/at least one branch/);
      expect(await bad({ effect: 'holiday' })).toBeTruthy();
    });

    it('refuses an audience that is not this agency’s', async () => {
      const stranger = new Types.ObjectId().toString();
      await api()
        .post('/api/v1/hr/events')
        .set(auth(managerToken))
        .send(event({ audience: { kind: 'branches', branchIds: [stranger] } }))
        .expect(400);
      await api()
        .post('/api/v1/hr/events')
        .set(auth(managerToken))
        .send(event({ audience: { kind: 'people', userIds: [stranger] } }))
        .expect(400);
      // Another agency's real user is as foreign as a made-up id.
      const foreigner = (await users
        .findOne({ email: ctx.otherAgencyUserEmail })
        .select('_id')
        .lean())!;
      await api()
        .post('/api/v1/hr/events')
        .set(auth(managerToken))
        .send(
          event({
            audience: { kind: 'people', userIds: [foreigner._id.toString()] },
          }),
        )
        .expect(400);
    });

    it('offers every branch and person of the agency to pick an audience from', async () => {
      const res = await api()
        .get('/api/v1/hr/events/audience-options')
        .set(auth(managerToken))
        .expect(200);
      const options = res.body as AgencyEventAudienceOptions;
      expect(options.branches.map((branch) => branch.id)).toEqual(
        expect.arrayContaining([ctx.branchId, otherBranchId]),
      );
      const outsider = options.people.find(
        (person) => person.id === outsiderId,
      );
      expect(outsider).toMatchObject({
        name: 'Olive Outsider',
        branchId: otherBranchId,
      });
      const foreigner = await users
        .findOne({ email: ctx.otherAgencyUserEmail })
        .lean();
      expect(options.people.map((person) => person.id)).not.toContain(
        foreigner!._id.toString(),
      );
    });
  });

  describe('what an event runs into', () => {
    it('lists the live requests it covers, and hides the ones the caller cannot see', async () => {
      const monday = week(2);
      // Mon–Tue in the manager's branch, approved; Mon in the other branch, pending.
      const mine = await send(producerToken, monday, addDays(monday, 1));
      await approve(managerToken, mine.id).expect(200);
      const theirs = await send(outsiderToken, monday);

      const over = { firstDay: monday, lastDay: monday, effect: 'blackout' };

      // The Branch Manager: their producer's request, and a count for the rest.
      const asManager = await impactOf(managerToken, over);
      expect(asManager.hiddenCount).toBe(1);
      expect(asManager.requests).toHaveLength(1);
      expect(asManager.requests[0]).toMatchObject({
        requestId: mine.id,
        reference: mine.reference,
        person: { id: producerId },
        status: 'approved',
        dates: [monday],
        hours: 8,
      });

      // The owner's agency scope reaches both.
      const asOwner = await impactOf(ownerToken, over);
      expect(asOwner.hiddenCount).toBe(0);
      expect(asOwner.requests.map((row) => row.requestId).sort()).toEqual(
        [mine.id, theirs.id].sort(),
      );
      expect(
        asOwner.requests.find((row) => row.requestId === theirs.id)?.status,
      ).toBe('pending');

      // An event with no effect runs into nothing.
      expect(await impactOf(ownerToken, { ...over, effect: 'none' })).toEqual({
        requests: [],
        hiddenCount: 0,
      });
      // Nor does one for a branch nobody on leave is in, or for other people.
      expect(
        (
          await impactOf(ownerToken, {
            ...over,
            audience: { kind: 'branches', branchIds: [otherBranchId] },
          })
        ).requests.map((row) => row.requestId),
      ).toEqual([theirs.id]);
      expect(
        (
          await impactOf(ownerToken, {
            ...over,
            audience: { kind: 'people', userIds: [ctx.managerUserId] },
          })
        ).requests,
      ).toEqual([]);
      // A weekend the request merely spans is not a day it takes hours on.
      expect(
        (
          await impactOf(ownerToken, {
            ...over,
            firstDay: addDays(monday, 5),
            lastDay: addDays(monday, 6),
          })
        ).requests,
      ).toEqual([]);
    });
  });

  describe('a blackout', () => {
    it('blocks an employee, warns a manager recording, and leaves sent requests alone', async () => {
      const monday = week(4);
      // Sent before the blackout exists.
      const before = await send(producerToken, addDays(monday, 1));
      const { event: blackout, impact } = await create(managerToken, {
        name: 'Year-end audit',
        firstDay: monday,
        lastDay: addDays(monday, 2),
        effect: 'blackout',
      });
      // Saving it reports the request it now covers…
      expect(impact.requests.map((row) => row.requestId)).toEqual([before.id]);
      // …and changes nothing about it: it is still approvable, at full hours.
      const approved = await approve(managerToken, before.id).expect(200);
      expect((approved.body as TimeOffRequestView).status).toBe('approved');
      expect(await usedHours(before.id)).toBe(8);

      // A new request on a blocked day is refused, by code.
      const blocked = await preview(producerToken, monday);
      expect(blocked.blockers.map((check) => check.code)).toEqual(['blackout']);
      expect(blocked.blockers[0].message).toMatch(/Year-end audit/);
      const refused = await api()
        .post('/api/v1/time-off/requests')
        .set(auth(producerToken))
        .send({ ...requestBody(monday), send: true })
        .expect(400);
      expect((refused.body as Refusal).code).toBe('blackout');

      // A manager recording it is told, and may go ahead.
      const recordPreview = await api()
        .post('/api/v1/time-off/records/preview')
        .set(auth(ownerToken))
        .send({ ...requestBody(monday), employeeId: producerId })
        .expect(200);
      const recorded = recordPreview.body as TimeOffPreview;
      expect(recorded.blockers).toEqual([]);
      expect(recorded.warnings.map((check) => check.code)).toEqual([
        'blackout',
      ]);
      const record = await api()
        .post('/api/v1/time-off/records')
        .set(auth(ownerToken))
        .send({ ...requestBody(monday), employeeId: producerId })
        .expect(201);
      const saved = record.body as TimeOffRequestView;
      expect(saved.status).toBe('approved');
      expect(saved.timeline.at(-1)?.warnings).toEqual(['blackout']);
      // Both requests now show what they run into.
      expect(saved.eventConflicts).toEqual([
        {
          eventId: blackout.id,
          name: 'Year-end audit',
          effect: 'blackout',
          dates: [monday],
        },
      ]);

      // Someone the event is not for is not blocked.
      await remove(managerToken, blackout.id).expect(204);
      const { event: narrow } = await create(managerToken, {
        name: 'Other branch stocktake',
        firstDay: addDays(monday, 3),
        effect: 'blackout',
        audience: { kind: 'branches', branchIds: [otherBranchId] },
      });
      expect(
        (await preview(producerToken, addDays(monday, 3))).blockers,
      ).toEqual([]);
      expect(
        (await preview(outsiderToken, addDays(monday, 3))).blockers.map(
          (c) => c.code,
        ),
      ).toEqual(['blackout']);
      await remove(managerToken, narrow.id).expect(204);
      // Removed: nobody is blocked.
      expect(
        (await preview(outsiderToken, addDays(monday, 3))).blockers,
      ).toEqual([]);
    });

    it('does not block a request whose only blocked days carry no hours', async () => {
      const saturday = addDays(week(6), 5);
      const { event: weekend } = await create(managerToken, {
        name: 'Weekend conference',
        firstDay: saturday,
        lastDay: addDays(saturday, 1),
        effect: 'blackout',
      });
      // Friday to Monday spans the blocked weekend and takes hours on neither day.
      const span = await preview(
        producerToken,
        addDays(saturday, -1),
        addDays(saturday, 2),
      );
      expect(span.totalHours).toBe(16);
      expect(span.blockers).toEqual([]);
      await remove(managerToken, weekend.id).expect(204);
    });
  });

  describe('a day off', () => {
    it('costs a new request nothing, and leaves an approved one as charged', async () => {
      const monday = week(8);
      // Approved before the office closes that Tuesday.
      const before = await send(producerToken, monday, addDays(monday, 2));
      await approve(managerToken, before.id).expect(200);
      expect(await usedHours(before.id)).toBe(24);

      const { event: closure, impact } = await create(managerToken, {
        name: 'Office move',
        firstDay: addDays(monday, 1),
        effect: 'day_off',
        audience: { kind: 'people', userIds: [producerId, ctx.managerUserId] },
      });
      expect(impact.requests).toHaveLength(1);
      expect(impact.requests[0]).toMatchObject({
        requestId: before.id,
        status: 'approved',
        dates: [addDays(monday, 1)],
        hours: 8,
      });

      // The approved request keeps its frozen hours and its ledger rows…
      const still = await api()
        .get(`/api/v1/time-off/requests/${before.id}`)
        .set(auth(managerToken))
        .expect(200);
      const view = still.body as TimeOffRequestView;
      expect(view.totalHours).toBe(24);
      expect(await usedHours(before.id)).toBe(24);
      // …and says what it now runs into.
      expect(view.eventConflicts).toEqual([
        {
          eventId: closure.id,
          name: 'Office move',
          effect: 'day_off',
          dates: [addDays(monday, 1)],
        },
      ]);

      // A new request over the same days charges nothing for the closed one.
      const next = await preview(managerToken, monday, addDays(monday, 2));
      expect(next.days.map((day) => [day.hours, day.reason])).toEqual([
        [8, 'scheduled'],
        [0, 'closure'],
        [8, 'scheduled'],
      ]);
      expect(next.totalHours).toBe(16);

      // Someone outside the audience still works that day.
      const outside = await preview(outsiderToken, addDays(monday, 1));
      expect(outside.days.map((day) => [day.hours, day.reason])).toEqual([
        [8, 'scheduled'],
      ]);

      // A request for only the closed day has no hours to take.
      const only = await preview(managerToken, addDays(monday, 1));
      expect(only.blockers.map((check) => check.code)).toEqual([
        'no_scheduled_hours',
      ]);

      await remove(managerToken, closure.id).expect(204);
      const reopened = await preview(managerToken, addDays(monday, 1));
      expect(reopened.days.map((day) => day.reason)).toEqual(['scheduled']);
    });
  });
});
