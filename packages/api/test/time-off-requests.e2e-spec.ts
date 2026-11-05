import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import {
  DEFAULT_AGENCY_TIME_ZONE,
  defaultTimeOffPolicyRules,
  type HrPolicyView,
  type TimeOffPreview,
  type TimeOffRequestList,
  type TimeOffRequestView,
  type TimeOffSummary,
  type TimeOffTypeKey,
} from '@sfa/shared';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Branch } from '../src/branches/schemas/branch.schema';
import { businessDateInstant } from '../src/common/dates/business-dates';
import { LeaveLedger } from '../src/hr/schemas/leave-ledger.schema';
import { notificationRequested } from '../src/inngest/events';
import { InngestService } from '../src/inngest/inngest.service';
import { agencyTodayIso } from '../src/performance/performance.range';
import { RoleAssignmentsService } from '../src/permissions/role-assignments.service';
import { Agency } from '../src/platform/schemas/agency.schema';
import { AgencyRole } from '../src/roles/schemas/agency-role.schema';
import { TimeOffRequest } from '../src/time-off-requests/schemas/time-off-request.schema';
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

const DAY_MS = 86_400_000;
const addDays = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
const weekday = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();

interface Refusal {
  code?: string;
  message?: string;
  request?: TimeOffRequestView;
  blockers?: { code: string }[];
}

/**
 * Time off requests (PAC-165): the lifecycle, who may see and decide what,
 * and the ledger rows each transition posts.
 *
 * The hours, balance-line and projection arithmetic is unit-tested in
 * `@sfa/shared`; the ledger writers against a real Mongo in
 * `worker/accrue-time-off.e2e-spec.ts`. What only a running app can answer
 * is here: that an approval posts `used` exactly once under a race, that a
 * second decision loses, that nobody decides their own request, that a
 * reader's data scope opens nobody else's leave, and that each transition
 * notifies the right people.
 *
 * Every date is computed from the agency's today. Each test takes its own
 * week (`week(n)`) so the hard overlap block never trips by accident, and
 * the policies reset ~200 days out so no accrual falls inside the window —
 * except the one policy built to reset inside it.
 */
describe('Time off requests (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestSeedContext;
  let inngest: CapturedInngestService;
  let users: Model<User>;
  let ledger: Model<LeaveLedger>;
  let requests: Model<TimeOffRequest>;

  let ownerToken: string;
  let managerToken: string;
  let producerToken: string;
  let csrToken: string;
  let readOnlyToken: string;
  let producerId: string;
  let ownerId: string;
  let timeZone: string;
  let today: string;
  /** A `MM-DD` about 200 days out: no reset falls in the test window. */
  let farReset: string;

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

  const monthDay = (iso: string) => {
    const value = iso.slice(5);
    return value === '02-29' ? '02-28' : value;
  };

  const createPolicy = async (
    name: string,
    type: TimeOffTypeKey,
    memberIds: string[],
    rules: Record<string, unknown> = {},
    startingBalanceHours?: Record<string, number>,
  ) => {
    const res = await api()
      .post('/api/v1/hr/policies')
      .set(auth(managerToken))
      .send({
        type: 'time_off',
        name,
        timeOff: {
          ...defaultTimeOffPolicyRules(type),
          hoursPerYear: 80,
          resetMonthDay: farReset,
          ...rules,
        },
        memberIds,
        ...(startingBalanceHours ? { startingBalanceHours } : {}),
      })
      .expect(201);
    return (res.body as HrPolicyView).id;
  };

  const body = (
    policyId: string,
    firstDay: string,
    lastDay = firstDay,
    over: Record<string, unknown> = {},
  ) => ({ policyId, firstDay, lastDay, dayMode: 'full', ...over });

  /** Send a request as `token` and expect it accepted. */
  const send = async (
    token: string,
    policyId: string,
    firstDay: string,
    lastDay = firstDay,
    over: Record<string, unknown> = {},
  ) => {
    const res = await api()
      .post('/api/v1/time-off/requests')
      .set(auth(token))
      .send({ ...body(policyId, firstDay, lastDay, over), send: true })
      .expect(201);
    return res.body as TimeOffRequestView;
  };

  const act = (
    token: string,
    id: string,
    action: string,
    payload: Record<string, unknown> = {},
  ) =>
    api()
      .post(`/api/v1/time-off/requests/${id}/${action}`)
      .set(auth(token))
      .send(payload);

  const read = (token: string, id: string) =>
    api().get(`/api/v1/time-off/requests/${id}`).set(auth(token));

  const summaryOf = async (token: string, policyId: string) => {
    const res = await api()
      .get('/api/v1/time-off/summary')
      .set(auth(token))
      .expect(200);
    const summary = res.body as TimeOffSummary;
    return {
      summary,
      card: summary.policies.find((policy) => policy.id === policyId)!,
    };
  };

  const rowsOf = (requestId: string, kind?: string) =>
    ledger
      .find({
        'source.id': new Types.ObjectId(requestId),
        ...(kind ? { kind } : {}),
      })
      .sort({ effectiveAt: 1 })
      .lean();

  /** The notifications requested since `from`, newest last. */
  const notified = (from: number) =>
    inngest.sent
      .slice(from)
      .filter((event) => event.name === 'notification/requested.v1')
      .map(
        (event) =>
          event.data as {
            type: string;
            recipientIds: string[];
            actorId: string | null;
            dedupeKey: string;
            entity: { kind: string; id: string };
            data: Record<string, unknown>;
          },
      );

  beforeAll(async () => {
    app = await createTestApp();
    await dropTestDatabase(app);
    ctx = await seedTestData(app);
    inngest = app.get(InngestService);
    users = app.get<Model<User>>(getModelToken(User.name));
    ledger = app.get<Model<LeaveLedger>>(getModelToken(LeaveLedger.name));
    requests = app.get<Model<TimeOffRequest>>(
      getModelToken(TimeOffRequest.name),
    );
    // The partial unique index is what makes a double post impossible.
    await ledger.syncIndexes();
    await requests.syncIndexes();

    ownerToken = await login(ctx.ownerEmail);
    managerToken = await login(ctx.managerEmail);
    producerToken = await login(ctx.producerEmail);
    csrToken = await login(ctx.csrEmail);
    readOnlyToken = await login(ctx.readOnlyEmail);

    const byEmail = async (email: string) =>
      (await users.findOne({ email }).select('_id').lean())!._id.toString();
    producerId = await byEmail(ctx.producerEmail);
    ownerId = await byEmail(ctx.ownerEmail);

    const agency = await app
      .get<Model<Agency>>(getModelToken(Agency.name))
      .findById(ctx.agencyId)
      .select('timezone')
      .lean<{ timezone?: string } | null>();
    timeZone = agency?.timezone ?? DEFAULT_AGENCY_TIME_ZONE;
    today = agencyTodayIso(timeZone);
    farReset = monthDay(addDays(today, 200));

    ptoId = await createPolicy('Requests PTO', 'pto', [
      producerId,
      ctx.managerUserId,
      ctx.csrUserId,
      ctx.readOnlyUserId,
      ownerId,
    ]);
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  describe('the form: hours and balance lines', () => {
    it('takes each date its scheduled hours and nothing for the weekend', async () => {
      const friday = addDays(week(0), 4);
      const res = await api()
        .post('/api/v1/time-off/requests/preview')
        .set(auth(producerToken))
        .send(body(ptoId, friday, addDays(friday, 3)))
        .expect(200);
      const preview = res.body as TimeOffPreview;
      expect(preview.days.map((day) => day.hours)).toEqual([8, 0, 0, 8]);
      expect(preview.days.map((day) => day.reason)).toEqual([
        'scheduled',
        'weekend',
        'weekend',
        'scheduled',
      ]);
      expect(preview.totalHours).toBe(16);
      expect(preview.balance).toEqual({
        currentBalance: 80,
        otherRequestedHours: 0,
        thisRequestHours: 16,
        remainingHours: 64,
      });
      expect(preview.projection).toMatchObject({
        lowestBalance: 64,
        crossesAccrual: false,
      });
      expect(preview.blockers).toEqual([]);
      // Nothing was written.
      expect(await requests.countDocuments({})).toBe(0);
    });

    it('takes the typed hours on Partial days, capped at the schedule', async () => {
      const friday = addDays(week(0), 4);
      const res = await api()
        .post('/api/v1/time-off/requests/preview')
        .set(auth(producerToken))
        .send(
          body(ptoId, friday, addDays(friday, 3), {
            dayMode: 'partial',
            hours: { [friday]: 2.5, [addDays(friday, 1)]: 4 },
          }),
        )
        .expect(200);
      const preview = res.body as TimeOffPreview;
      // Friday as typed, Saturday has nothing to take, Monday defaults.
      expect(preview.days.map((day) => day.hours)).toEqual([2.5, 0, 0, 8]);
      expect(preview.totalHours).toBe(10.5);
    });

    it('reports a broken rule as a blocker, not an error', async () => {
      const res = await api()
        .post('/api/v1/time-off/requests/preview')
        .set(auth(producerToken))
        .send(body(ptoId, addDays(week(0), 5), addDays(week(0), 6)))
        .expect(200);
      expect(
        (res.body as TimeOffPreview).blockers.map((blocker) => blocker.code),
      ).toEqual(['no_scheduled_hours']);
    });
  });

  describe('a draft', () => {
    let draftId: string;

    it('is saved with a reference, holds no hours and is its creator’s alone', async () => {
      const res = await api()
        .post('/api/v1/time-off/requests')
        .set(auth(producerToken))
        .send({ ...body(ptoId, week(0), addDays(week(0), 1)), send: false })
        .expect(201);
      const draft = res.body as TimeOffRequestView;
      draftId = draft.id;
      expect(draft).toMatchObject({
        status: 'draft',
        group: 'draft',
        source: 'self',
        totalHours: 16,
        actions: ['edit', 'submit', 'discard'],
      });
      expect(draft.reference).toBe(`TOR-${today.slice(0, 4)}-001`);
      expect(draft.timeline.map((row) => row.action)).toEqual(['created']);

      // Nothing is held against the balance, and nobody was told.
      const { card } = await summaryOf(producerToken, ptoId);
      expect(card).toMatchObject({
        currentBalance: 80,
        otherRequestedHours: 0,
        availableHours: 80,
      });
      expect(notified(0)).toHaveLength(0);

      // A reviewer cannot see it, by id or in the list.
      await read(managerToken, draftId).expect(404);
      const team = await api()
        .get('/api/v1/time-off/requests')
        .query({ group: 'pending,approved,changes_requested' })
        .set(auth(managerToken))
        .expect(200);
      expect((team.body as TimeOffRequestList).items).toHaveLength(0);
    });

    it('is edited without being sent', async () => {
      const res = await api()
        .patch(`/api/v1/time-off/requests/${draftId}`)
        .set(auth(producerToken))
        .send(
          body(ptoId, week(0), addDays(week(0), 2), { note: 'Family trip' }),
        )
        .expect(200);
      expect(res.body as TimeOffRequestView).toMatchObject({
        status: 'draft',
        totalHours: 24,
        note: 'Family trip',
      });
      // Not somebody else's to edit.
      await api()
        .patch(`/api/v1/time-off/requests/${draftId}`)
        .set(auth(csrToken))
        .send(body(ptoId, week(0)))
        .expect(404);
    });

    it('is discarded softly: the row stays, stamped, and leaves every list', async () => {
      await api()
        .delete(`/api/v1/time-off/requests/${draftId}`)
        .set(auth(producerToken))
        .expect(204);
      const stored = await requests.findById(draftId).lean();
      expect(stored?.deletedAt).toBeInstanceOf(Date);
      expect(String(stored?.deletedBy)).toBe(producerId);
      expect(stored?.status).toBe('draft');

      await read(producerToken, draftId).expect(404);
      const mine = await api()
        .get('/api/v1/time-off/requests/mine')
        .set(auth(producerToken))
        .expect(200);
      expect((mine.body as TimeOffRequestList).items).toHaveLength(0);
      // Discarding twice finds nothing to discard.
      await api()
        .delete(`/api/v1/time-off/requests/${draftId}`)
        .set(auth(producerToken))
        .expect(404);
    });
  });

  describe('submit → decide', () => {
    let approvedId: string;

    it('sends a request for review and tells the people who can decide it', async () => {
      const before = inngest.sent.length;
      const sent = await send(
        producerToken,
        ptoId,
        week(1),
        addDays(week(1), 2),
        { note: 'Moving house' },
      );
      approvedId = sent.id;
      expect(sent).toMatchObject({
        status: 'submitted',
        group: 'pending',
        totalHours: 24,
        actions: ['cancel'],
      });
      expect(sent.timeline.map((row) => row.action)).toEqual(['submitted']);
      expect(sent.timeline[0].note).toBe('Moving house');
      expect(sent.othersOff).toBeUndefined();

      // Held against the balance while it waits.
      const { card, summary } = await summaryOf(producerToken, ptoId);
      expect(card).toMatchObject({
        currentBalance: 80,
        otherRequestedHours: 24,
        availableHours: 56,
      });
      // The Branch Manager (their branch) and the owner (the agency).
      expect(summary.reviewerCount).toBe(2);

      const [event] = notified(before);
      expect(event).toMatchObject({
        type: 'time_off.submitted',
        actorId: producerId,
        entity: { kind: 'timeOffRequest', id: sent.id },
        dedupeKey: `time_off.submitted:${sent.id}:1`,
      });
      expect([...event.recipientIds].sort()).toEqual(
        [ctx.managerUserId, ownerId].sort(),
      );
      expect(event.data).toMatchObject({
        employeeName: 'Test Producer',
        policyName: 'Requests PTO',
        firstDay: week(1),
        totalHours: 24,
        resubmitted: false,
        note: 'Moving house',
      });
      // The real event schema accepts what was captured.
      await notificationRequested
        .create({
          ...event,
          eventLogId: new Types.ObjectId().toHexString(),
        } as never)
        .validate();
    });

    it('shows a reviewer the balance lines, who else is off and the decisions', async () => {
      const res = await read(managerToken, approvedId).expect(200);
      const view = res.body as TimeOffRequestView;
      expect(view.actions).toEqual(['approve', 'request_changes', 'decline']);
      expect(view.balance).toEqual({
        currentBalance: 80,
        otherRequestedHours: 0,
        thisRequestHours: 24,
        remainingHours: 56,
      });
      expect(view.othersOff).toEqual([]);
      const team = await api()
        .get('/api/v1/time-off/requests')
        .set(auth(managerToken))
        .expect(200);
      expect(
        (team.body as TimeOffRequestList).items.map((row) => row.id),
      ).toEqual([approvedId]);
    });

    it('posts `used` exactly once when two approvals race, and rejects the second decision', async () => {
      const before = inngest.sent.length;
      const [first, second] = await Promise.all([
        act(managerToken, approvedId, 'approve'),
        act(ownerToken, approvedId, 'approve', { note: 'Enjoy' }),
      ]);
      expect([first.status, second.status].sort()).toEqual([200, 409]);
      const lost = (first.status === 409 ? first : second).body as Refusal;
      expect(lost.code).toBe('already_decided');
      // The loser is handed the record as it now stands.
      expect(lost.request?.status).toBe('approved');

      const used = await rowsOf(approvedId, 'used');
      expect(used.map((row) => row.hours)).toEqual([-8, -8, -8]);
      expect(used.map((row) => row.effectiveAt)).toEqual(
        [0, 1, 2].map((offset) =>
          businessDateInstant(addDays(week(1), offset), timeZone),
        ),
      );
      expect(await rowsOf(approvedId)).toHaveLength(3);

      // A later decision of any kind loses too.
      const late = await act(managerToken, approvedId, 'decline', {
        note: 'Too late',
      }).expect(409);
      expect((late.body as Refusal).code).toBe('already_decided');
      expect(await rowsOf(approvedId)).toHaveLength(3);

      const events = notified(before);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'time_off.approved',
        recipientIds: [producerId],
      });

      // Approved leave that has not happened is "other requested", not gone
      // from the current balance.
      const { card } = await summaryOf(producerToken, ptoId);
      expect(card).toMatchObject({
        currentBalance: 80,
        otherRequestedHours: 24,
        availableHours: 56,
      });
    });

    it('refuses dates the person already has time off on, but not a draft’s', async () => {
      const clash = await api()
        .post('/api/v1/time-off/requests')
        .set(auth(producerToken))
        .send({
          ...body(ptoId, addDays(week(1), 2), addDays(week(1), 3)),
          send: true,
        })
        .expect(400);
      const refusal = clash.body as Refusal;
      expect(refusal.code).toBe('overlap');
      expect(refusal.message).toContain('TOR-');

      // A draft on a day does not hold it.
      await api()
        .post('/api/v1/time-off/requests')
        .set(auth(producerToken))
        .send({ ...body(ptoId, week(2)), send: false })
        .expect(201);
      const sent = await send(producerToken, ptoId, week(2));
      expect(sent.status).toBe('submitted');

      // Withdrawing a request nobody decided posts nothing and tells nobody.
      const before = inngest.sent.length;
      const res = await act(producerToken, sent.id, 'cancel').expect(200);
      expect((res.body as TimeOffRequestView).status).toBe('cancelled');
      expect(await rowsOf(sent.id)).toHaveLength(0);
      expect(notified(before)).toHaveLength(0);
    });

    it('declines with a note and posts nothing', async () => {
      const sent = await send(producerToken, ptoId, addDays(week(1), 3));
      await act(managerToken, sent.id, 'decline').expect(400);
      const before = inngest.sent.length;
      const res = await act(managerToken, sent.id, 'decline', {
        note: 'Two people are already off',
      }).expect(200);
      const declined = res.body as TimeOffRequestView;
      expect(declined).toMatchObject({ status: 'declined', actions: [] });
      expect(declined.timeline.at(-1)).toMatchObject({
        action: 'declined',
        note: 'Two people are already off',
        actor: { id: ctx.managerUserId },
      });
      expect(await rowsOf(sent.id)).toHaveLength(0);
      expect(notified(before)[0]).toMatchObject({
        type: 'time_off.declined',
        recipientIds: [producerId],
      });
      // Terminal: it cannot be sent again or cancelled.
      await act(producerToken, sent.id, 'submit').expect(409);
      await act(producerToken, sent.id, 'cancel').expect(409);
    });

    it('cancels approved leave with a mirror reversal and gives the hours back', async () => {
      const before = inngest.sent.length;
      const res = await act(producerToken, approvedId, 'cancel').expect(200);
      expect((res.body as TimeOffRequestView).status).toBe('cancelled');

      const used = await rowsOf(approvedId, 'used');
      const reversals = await rowsOf(approvedId, 'reversal');
      expect(reversals.map((row) => row.hours)).toEqual([8, 8, 8]);
      reversals.forEach((row, index) => {
        expect(String(row.reversesId)).toBe(String(used[index]._id));
        expect(row.effectiveAt).toEqual(used[index].effectiveAt);
      });
      const { card } = await summaryOf(producerToken, ptoId);
      expect(card).toMatchObject({
        otherRequestedHours: 0,
        availableHours: 80,
      });

      // The people who planned around it are told the employee cancelled.
      const [event] = notified(before);
      expect(event.type).toBe('time_off.approval_cancelled');
      expect(event.data.cancelledBy).toBe('employee');
      expect([...event.recipientIds].sort()).toEqual(
        [ctx.managerUserId, ownerId].sort(),
      );
    });

    it('lets a reviewer cancel approved leave only with a note, and tells the employee', async () => {
      const sent = await send(producerToken, ptoId, addDays(week(2), 2));
      await act(managerToken, sent.id, 'approve').expect(200);
      await act(managerToken, sent.id, 'cancel').expect(400);
      const before = inngest.sent.length;
      const res = await act(managerToken, sent.id, 'cancel', {
        note: 'Office closed that day',
      }).expect(200);
      expect((res.body as TimeOffRequestView).status).toBe('cancelled');
      expect(await rowsOf(sent.id, 'reversal')).toHaveLength(1);
      const [event] = notified(before);
      expect(event).toMatchObject({
        type: 'time_off.approval_cancelled',
        recipientIds: [producerId],
      });
      expect(event.data.cancelledBy).toBe('reviewer');
    });
  });

  describe('changes requested', () => {
    it('sends the request back, takes the edit, and recomputes on resend', async () => {
      const sent = await send(producerToken, ptoId, addDays(week(2), 3));
      const before = inngest.sent.length;
      await act(managerToken, sent.id, 'request-changes').expect(400);
      const back = await act(managerToken, sent.id, 'request-changes', {
        note: 'Can you take the Friday too?',
      }).expect(200);
      expect(back.body as TimeOffRequestView).toMatchObject({
        status: 'changes_requested',
        group: 'changes_requested',
      });
      // Still held against the balance while it is the employee's move.
      expect(
        (await summaryOf(producerToken, ptoId)).card.otherRequestedHours,
      ).toBe(8);

      const mine = await read(producerToken, sent.id).expect(200);
      expect((mine.body as TimeOffRequestView).actions).toEqual([
        'edit',
        'submit',
        'cancel',
      ]);

      // Resend with the edited form in one call.
      const resent = await act(
        producerToken,
        sent.id,
        'submit',
        body(ptoId, addDays(week(2), 3), addDays(week(2), 4), {
          note: 'Friday added',
        }),
      ).expect(200);
      const view = resent.body as TimeOffRequestView;
      expect(view).toMatchObject({ status: 'submitted', totalHours: 16 });
      expect(view.timeline.map((row) => row.action)).toEqual([
        'submitted',
        'changes_requested',
        'resubmitted',
      ]);

      const events = notified(before);
      expect(events.map((event) => event.type)).toEqual([
        'time_off.changes_requested',
        'time_off.submitted',
      ]);
      expect(events[1].data.resubmitted).toBe(true);
      // A key of its own, or the resubmission would be swallowed as a repeat.
      expect(events[1].dedupeKey).toBe(`time_off.submitted:${sent.id}:3`);

      await act(managerToken, sent.id, 'approve').expect(200);
      expect(await rowsOf(sent.id, 'used')).toHaveLength(2);
    });
  });

  describe('who may see and decide', () => {
    let pendingId: string;

    beforeAll(async () => {
      pendingId = (await send(producerToken, ptoId, week(3))).id;
    });

    it('never lets someone decide their own request', async () => {
      const own = await send(managerToken, ptoId, week(3));
      const res = await act(managerToken, own.id, 'approve').expect(403);
      expect((res.body as Refusal).code).toBe('own_request');
      await act(managerToken, own.id, 'decline', { note: 'No' }).expect(403);
      // It is not in their own team list either…
      const team = await api()
        .get('/api/v1/time-off/requests')
        .set(auth(managerToken))
        .expect(200);
      expect(
        (team.body as TimeOffRequestList).items.map((row) => row.id),
      ).not.toContain(own.id);
      // …and somebody else decides it.
      await act(ownerToken, own.id, 'approve').expect(200);
    });

    it('opens nobody else’s leave to a reader, however wide their data scope', async () => {
      // `hr:read` with agency scope (the Data Team's shape) and with own scope.
      await read(readOnlyToken, pendingId).expect(404);
      await read(csrToken, pendingId).expect(404);
      for (const token of [readOnlyToken, csrToken]) {
        await api()
          .get('/api/v1/time-off/requests')
          .set(auth(token))
          .expect(403);
        await act(token, pendingId, 'approve').expect(403);
        const mine = await api()
          .get('/api/v1/time-off/requests/mine')
          .set(auth(token))
          .expect(200);
        expect((mine.body as TimeOffRequestList).items).toHaveLength(0);
      }
      // Withdrawing is the employee's; a bystander gets a 404, not a 403.
      await act(csrToken, pendingId, 'cancel').expect(404);
    });

    it('rejects a read from another agency', async () => {
      const otherToken = await login(ctx.otherAgencyUserEmail);
      await read(otherToken, pendingId).expect(404);
      await act(otherToken, pendingId, 'cancel').expect(404);
      const mine = await api()
        .get('/api/v1/time-off/requests/mine')
        .set(auth(otherToken))
        .expect(200);
      expect((mine.body as TimeOffRequestList).items).toHaveLength(0);
      const summary = await api()
        .get('/api/v1/time-off/summary')
        .set(auth(otherToken))
        .expect(200);
      expect((summary.body as TimeOffSummary).policies).toHaveLength(0);
    });

    it('scopes a branch reviewer to their branch, and one with no branch to nothing', async () => {
      const branches = app.get<Model<Branch>>(getModelToken(Branch.name));
      const roles = app.get<Model<AgencyRole>>(getModelToken(AgencyRole.name));
      const assignments = app.get(RoleAssignmentsService);
      const agencyId = new Types.ObjectId(ctx.agencyId);
      const otherBranch = await branches
        .findOne({ agencyId, name: 'Other Branch' })
        .lean();
      const managerRole = await roles
        .findOne({ agencyId, slug: 'branch_manager' })
        .lean();
      const { passwordHash } = (await users
        .findOne({ email: ctx.producerEmail })
        .select('passwordHash')
        .lean())!;
      const actor = { userId: ownerId, isPlatformAdmin: true };
      const person = async (
        email: string,
        branchId: Types.ObjectId | undefined,
        roleId: unknown,
      ) => {
        const user = await users.create({
          agencyId,
          branchId,
          email,
          passwordHash,
          firstName: 'Time',
          lastName: email.split('@')[0],
          isActive: true,
        });
        await assignments.setUserRoles(actor, agencyId, user._id, [
          roleId as Types.ObjectId,
        ]);
        return user._id.toString();
      };
      const outsiderId = await person(
        'timeoff-outsider@sfa.local',
        otherBranch!._id,
        ctx.producerRoleId,
      );
      await person('timeoff-floating@sfa.local', undefined, managerRole!._id);

      // Enrol the outsider, who then asks for a day.
      await api()
        .post(`/api/v1/hr/policies/${ptoId}/members`)
        .set(auth(managerToken))
        .send({ userId: outsiderId })
        .expect(201);
      const outsiderToken = await login('timeoff-outsider@sfa.local');
      const theirs = await send(outsiderToken, ptoId, week(3));

      // Another branch: the Branch Manager neither sees nor decides it.
      await read(managerToken, theirs.id).expect(404);
      await act(managerToken, theirs.id, 'approve').expect(404);
      const team = await api()
        .get('/api/v1/time-off/requests')
        .set(auth(managerToken))
        .expect(200);
      expect(
        (team.body as TimeOffRequestList).items.map((row) => row.id),
      ).not.toContain(theirs.id);
      // The owner's agency scope reaches it.
      const all = await api()
        .get('/api/v1/time-off/requests')
        .query({ q: 'outsider' })
        .set(auth(ownerToken))
        .expect(200);
      expect(
        (all.body as TimeOffRequestList).items.map((row) => row.id),
      ).toEqual([theirs.id]);

      // Branch scope and no branch: nothing — not the whole agency.
      const floatingToken = await login('timeoff-floating@sfa.local');
      const none = await api()
        .get('/api/v1/time-off/requests')
        .query({ group: 'pending,approved,cancelled,declined' })
        .set(auth(floatingToken))
        .expect(200);
      expect((none.body as TimeOffRequestList).items).toHaveLength(0);
      await read(floatingToken, pendingId).expect(404);
      await act(floatingToken, pendingId, 'approve').expect(404);
    });

    it('lists by name, policy and group', async () => {
      const byName = await api()
        .get('/api/v1/time-off/requests')
        .query({ q: 'test producer', group: 'pending,cancelled,declined' })
        .set(auth(managerToken))
        .expect(200);
      const list = byName.body as TimeOffRequestList;
      expect(list.total).toBeGreaterThanOrEqual(3);
      expect(new Set(list.items.map((row) => row.employee?.id))).toEqual(
        new Set([producerId]),
      );
      expect(new Set(list.items.map((row) => row.group))).toEqual(
        new Set(['pending', 'cancelled', 'declined']),
      );
      const nobody = await api()
        .get('/api/v1/time-off/requests')
        .query({ q: 'zzz-nobody' })
        .set(auth(managerToken))
        .expect(200);
      expect((nobody.body as TimeOffRequestList).total).toBe(0);
      const otherPolicy = await api()
        .get('/api/v1/time-off/requests')
        .query({ policyId: new Types.ObjectId().toHexString() })
        .set(auth(managerToken))
        .expect(200);
      expect((otherPolicy.body as TimeOffRequestList).total).toBe(0);
    });
  });

  describe('the checks on sending', () => {
    it('refuses a self request that starts in the past', async () => {
      const res = await api()
        .post('/api/v1/time-off/requests')
        .set(auth(producerToken))
        .send({ ...body(ptoId, addDays(today, -1)), send: true })
        .expect(400);
      expect((res.body as Refusal).code).toBe('past_date');
    });

    it('refuses a policy the person is not in, and one that does not exist', async () => {
      const sickId = await createPolicy('Nobody’s sick leave', 'sick', []);
      const res = await api()
        .post('/api/v1/time-off/requests')
        .set(auth(producerToken))
        .send({ ...body(sickId, week(4)), send: true })
        .expect(400);
      expect((res.body as Refusal).code).toBe('not_enrolled');
      await api()
        .post('/api/v1/time-off/requests')
        .set(auth(producerToken))
        .send({
          ...body(new Types.ObjectId().toHexString(), week(4)),
          send: true,
        })
        .expect(404);
    });

    it('refuses a request the balance cannot cover', async () => {
      // Ten working days are the whole 80 h; some are already spoken for.
      const res = await api()
        .post('/api/v1/time-off/requests')
        .set(auth(producerToken))
        .send({ ...body(ptoId, week(5), addDays(week(6), 4)), send: true })
        .expect(400);
      const refusal = res.body as Refusal;
      expect(refusal.code).toBe('negative_balance');
      expect(refusal.blockers?.map((blocker) => blocker.code)).toEqual([
        'negative_balance',
      ]);
    });

    it('covers a request spanning the reset from the new period, and dates its rows on each side', async () => {
      // A policy that resets on the Wednesday of week 7, with 16 h to spend
      // before it: Monday and Tuesday come out of this period, Wednesday to
      // Friday out of the next one's 80 h.
      const resetDay = addDays(week(7), 2);
      const spanId = await createPolicy(
        'Spanning leave',
        'custom',
        [producerId],
        { resetMonthDay: monthDay(resetDay) },
        { [producerId]: 16 },
      );
      const preview = await api()
        .post('/api/v1/time-off/requests/preview')
        .set(auth(producerToken))
        .send(body(spanId, week(7), addDays(week(7), 4)))
        .expect(200);
      const lines = preview.body as TimeOffPreview;
      // Today's numbers say 24 h short; the projection says it is covered.
      expect(lines.balance?.remainingHours).toBe(-24);
      expect(lines.projection).toMatchObject({
        lowestBalance: 0,
        lowestOn: addDays(week(7), 1),
        crossesAccrual: true,
      });
      expect(lines.blockers).toEqual([]);

      const sent = await send(
        producerToken,
        spanId,
        week(7),
        addDays(week(7), 4),
      );
      await act(managerToken, sent.id, 'approve').expect(200);
      const used = await rowsOf(sent.id, 'used');
      const resetAt = businessDateInstant(resetDay, timeZone);
      expect(used.filter((row) => row.effectiveAt < resetAt)).toHaveLength(2);
      expect(used.filter((row) => row.effectiveAt >= resetAt)).toHaveLength(3);

      // One more day before the reset is one too many for this period.
      const short = await api()
        .post('/api/v1/time-off/requests')
        .set(auth(producerToken))
        .send({ ...body(spanId, addDays(week(6), 4)), send: true })
        .expect(400);
      expect((short.body as Refusal).code).toBe('negative_balance');
    });
  });

  describe('auto-approval', () => {
    let sickId: string;

    beforeAll(async () => {
      sickId = await createPolicy('Quick sick leave', 'sick', [producerId], {
        hoursPerYear: 40,
        autoApprove: { enabled: true, maxCalendarDays: 2, minNoticeHours: 24 },
      });
    });

    it('approves a request meeting the policy’s rules the moment it is sent', async () => {
      const before = inngest.sent.length;
      const sent = await send(producerToken, sickId, week(4));
      expect(sent).toMatchObject({
        status: 'approved',
        autoApproved: true,
        group: 'approved',
      });
      expect(sent.timeline.map((row) => row.action)).toEqual([
        'submitted',
        'auto_approved',
      ]);
      expect(sent.timeline[1].actor).toBeNull();
      expect(await rowsOf(sent.id, 'used')).toHaveLength(1);

      const events = notified(before);
      expect(events.map((event) => event.type)).toEqual([
        'time_off.approved',
        'time_off.auto_approved_notice',
      ]);
      expect(events[0]).toMatchObject({
        recipientIds: [producerId],
        actorId: null,
      });
      expect(events[0].data.automatic).toBe(true);
      expect([...events[1].recipientIds].sort()).toEqual(
        [ctx.managerUserId, ownerId].sort(),
      );
    });

    it('leaves a request outside the rules for a person to decide', async () => {
      const sent = await send(
        producerToken,
        sickId,
        addDays(week(4), 1),
        addDays(week(4), 3),
      );
      expect(sent).toMatchObject({ status: 'submitted', autoApproved: false });
      expect(await rowsOf(sent.id)).toHaveLength(0);

      // Taken out of the policy while it waits: it can be declined, not approved.
      await api()
        .delete(`/api/v1/hr/policies/${sickId}/members/${producerId}`)
        .set(auth(managerToken))
        .expect(204);
      const res = await act(managerToken, sent.id, 'approve').expect(409);
      expect((res.body as Refusal).code).toBe('policy_unavailable');
      await act(managerToken, sent.id, 'decline', {
        note: 'No longer in the policy',
      }).expect(200);
    });
  });

  describe('imported rows', () => {
    it('are read-only history: listed apart, opened, and never acted on', async () => {
      const imported = await requests.create({
        agencyId: ctx.agencyId,
        branchId: ctx.branchId,
        source: 'legacy',
        employeeId: new Types.ObjectId(producerId),
        firstDay: '2026-05-06',
        lastDay: '2026-05-06',
        totalHours: 8,
        legacy: {
          status: 'Submitted',
          type: 'PTO',
          requestType: 'Full Day(s)',
        },
        legacySmartSuiteId: 'e2e-imported-1',
      });
      const id = imported._id.toString();

      const mine = await read(producerToken, id).expect(200);
      expect(mine.body as TimeOffRequestView).toMatchObject({
        status: null,
        group: 'imported',
        reference: null,
        policy: null,
        actions: [],
        balance: null,
        legacy: { status: 'Submitted', type: 'PTO' },
      });

      // Not work waiting for anyone…
      const toReview = await api()
        .get('/api/v1/time-off/requests')
        .set(auth(managerToken))
        .expect(200);
      expect(
        (toReview.body as TimeOffRequestList).items.map((row) => row.id),
      ).not.toContain(id);
      // …but findable.
      const history = await api()
        .get('/api/v1/time-off/requests')
        .query({ group: 'imported' })
        .set(auth(managerToken))
        .expect(200);
      expect(
        (history.body as TimeOffRequestList).items.map((row) => row.id),
      ).toEqual([id]);

      for (const [token, action, payload] of [
        [managerToken, 'approve', {}],
        [managerToken, 'decline', { note: 'No' }],
        [managerToken, 'cancel', { note: 'No' }],
        [producerToken, 'cancel', {}],
        [producerToken, 'submit', {}],
      ] as const) {
        const res = await act(token, id, action, payload).expect(409);
        expect((res.body as Refusal).code).toBe('imported');
      }
      // In no balance.
      expect(await ledger.countDocuments({ 'source.id': imported._id })).toBe(
        0,
      );
    });
  });
});
