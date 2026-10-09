import { INestApplication } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  MongooseModule,
  getConnectionToken,
  getModelToken,
} from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { NOTIFICATION_TYPES } from '@sfa/shared';
import { NonRetriableError } from 'inngest';
import { Connection, Model, Types } from 'mongoose';
import {
  NotificationBus,
  type NotificationNudge,
} from '../../src/common/redis/notification-bus';
import { ENV_FILE_PATH } from '../../src/config/env.config';
import type { NotificationRequestedData } from '../../src/inngest/events';
import { InngestModule } from '../../src/inngest/inngest.module';
import { InngestService } from '../../src/inngest/inngest.service';
import { Notification } from '../../src/notifications/schemas/notification.schema';
import { PushSubscription } from '../../src/notifications/schemas/push-subscription.schema';
import { DeliverNotificationFn } from '../../src/worker/functions/deliver-notification.fn';
import {
  WebPushTransport,
  type PushSendOptions,
  type PushTarget,
} from '../../src/worker/push/web-push.transport';
import { WorkerModule } from '../../src/worker/worker.module';
import { inlineStep } from '../helpers/inline-step';
import { CapturedInngestService } from '../helpers/test-app';
import { WebPushError } from 'web-push';

const ADMIN_A = '507f1f77bcf86cd799439021';
const ADMIN_B = '507f1f77bcf86cd799439022';
const REPORTER = '507f1f77bcf86cd799439011';

/**
 * Records every push the worker would have sent (PR4), and can be told to
 * answer any endpoint with a given failure — a `WebPushError` 410 is what the
 * push service says about a subscription the browser has dropped.
 */
class CaptureWebPushTransport extends WebPushTransport {
  readonly enabled = true;
  readonly sent: Array<{
    target: PushTarget;
    payload: Record<string, unknown>;
    options: PushSendOptions;
  }> = [];
  /** Endpoint → error to throw instead of accepting. */
  readonly failures = new Map<string, Error>();

  send(
    target: PushTarget,
    payload: string,
    options: PushSendOptions,
  ): Promise<void> {
    const failure = this.failures.get(target.endpoint);
    if (failure) return Promise.reject(failure);
    this.sent.push({
      target,
      payload: JSON.parse(payload) as Record<string, unknown>,
      options,
    });
    return Promise.resolve();
  }
}

function gone(statusCode: 404 | 410, endpoint: string): WebPushError {
  return new WebPushError('Gone', statusCode, {}, '', endpoint);
}

function requestedEvent(overrides: Partial<NotificationRequestedData> = {}): {
  id: string;
  name: string;
  data: NotificationRequestedData;
} {
  return {
    id: '01NOTIF',
    name: 'notification/requested.v1',
    data: {
      eventLogId: '507f1f77bcf86cd799439010',
      type: 'bug_report.filed',
      recipientIds: [ADMIN_A, ADMIN_B],
      agencyId: null,
      actorId: REPORTER,
      entity: { kind: 'bugReport', id: '507f1f77bcf86cd799439031' },
      data: {
        bugReportId: '507f1f77bcf86cd799439031',
        summary: 'The leaderboard still shows last month',
        severity: 'high',
        reporterName: 'Pat Producer',
        agencyId: null,
      },
      dedupeKey: 'bug_report.filed:507f1f77bcf86cd799439031',
      ...overrides,
    },
  };
}

describe('DeliverNotificationFn (e2e)', () => {
  let app: INestApplication;
  let fn: DeliverNotificationFn;
  let notifications: Model<Notification>;
  let subscriptions: Model<PushSubscription>;
  let bus: NotificationBus;
  /** What the `email` step handed to the outbox (PR3). */
  const emitted = new CapturedInngestService();
  /** What the `push` step handed to the push services (PR4). */
  const pushes = new CaptureWebPushTransport();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, envFilePath: ENV_FILE_PATH }),
        MongooseModule.forRootAsync({
          imports: [ConfigModule],
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({
            uri: config.get<string>(
              'MONGODB_URI',
              'mongodb://localhost:27017/sfa_test',
            ),
          }),
        }),
        InngestModule,
        WorkerModule,
      ],
    })
      .overrideProvider(InngestService)
      .useValue(emitted)
      .overrideProvider(WebPushTransport)
      .useValue(pushes)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();

    fn = app.get(DeliverNotificationFn);
    bus = app.get(NotificationBus);
    notifications = app.get<Model<Notification>>(
      getModelToken(Notification.name),
    );
    subscriptions = app.get<Model<PushSubscription>>(
      getModelToken(PushSubscription.name),
    );
    // The worker root boots with `autoIndex: false`; the API owns these
    // indexes. The unique one is what the dedupe cases below exercise, so
    // build it here the way the API would.
    await notifications.syncIndexes();
    await subscriptions.syncIndexes();
  });

  afterAll(async () => {
    if (app) {
      const connection = app.get<Connection>(getConnectionToken());
      await connection.db?.dropDatabase();
      await app.close();
    }
  });

  beforeEach(async () => {
    await notifications.deleteMany({});
    await subscriptions.deleteMany({});
    emitted.sent.length = 0;
    pushes.sent.length = 0;
    pushes.failures.clear();
  });

  /** A live subscription for one user, written through the model. */
  async function subscribe(userId: string, endpoint: string) {
    return subscriptions.create({
      userId: new Types.ObjectId(userId),
      endpoint,
      keys: { p256dh: `p256dh-${endpoint.slice(-6)}`, auth: 'auth-16-bytes!!' },
      userAgent: 'test',
    });
  }

  it('writes one rendered, unread row per recipient', async () => {
    const { step, ran } = inlineStep();

    const result = await fn.handle(requestedEvent(), step);

    expect(ran).toEqual(['insert', 'publish', 'email', 'push']);
    expect(result.notificationIds).toHaveLength(2);

    const rows = await notifications.find({}).sort({ recipientId: 1 }).lean();
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.recipientId.toHexString())).toEqual([
      ADMIN_A,
      ADMIN_B,
    ]);
    for (const row of rows) {
      expect(row).toMatchObject({
        type: 'bug_report.filed',
        title: 'New bug report',
        body: 'Pat Producer: The leaderboard still shows last month',
        href: '/admin/bugs',
        entity: { kind: 'bugReport', id: '507f1f77bcf86cd799439031' },
        agencyId: null,
        readAt: null,
        dedupeKey: 'bug_report.filed:507f1f77bcf86cd799439031',
      });
      expect(row.actorId?.toHexString()).toBe(REPORTER);
      // Stored as a real null, not left absent — the unread index and the
      // `readAt: null` predicate both depend on it.
      expect(Object.prototype.hasOwnProperty.call(row, 'readAt')).toBe(true);
      expect(row.createdAt).toBeInstanceOf(Date);
    }
  });

  it('publishes one nudge per row, ids only, after the insert (PR2)', async () => {
    const nudges: NotificationNudge[] = [];
    const unsubscribe = bus.subscribe((nudge) => {
      nudges.push(nudge);
    });
    try {
      const result = await fn.handle(requestedEvent(), inlineStep().step);

      expect(nudges).toHaveLength(2);
      expect(nudges.map((nudge) => nudge.recipientId).sort()).toEqual([
        ADMIN_A,
        ADMIN_B,
      ]);
      expect(nudges.map((nudge) => nudge.notificationId).sort()).toEqual(
        [...result.notificationIds].sort(),
      );
      // Nothing but the two ids: the API node re-reads the row itself.
      for (const nudge of nudges) {
        expect(Object.keys(nudge).sort()).toEqual([
          'notificationId',
          'recipientId',
        ]);
      }
    } finally {
      unsubscribe();
    }
  });

  describe('email hand-off (PR3)', () => {
    it('requests one email per row, ids only, for a type whose defaults include email', async () => {
      const result = await fn.handle(requestedEvent(), inlineStep().step);

      expect(emitted.sent).toHaveLength(2);
      for (const event of emitted.sent) {
        expect(event.name).toBe('notification/email.requested.v1');
        // Nothing but the three ids: the mail function re-reads the row, so
        // the email can never say something the in-app list does not.
        expect(Object.keys(event.data).sort()).toEqual([
          'agencyId',
          'notificationId',
          'recipientId',
        ]);
        expect(event.data.agencyId).toBeNull();
      }
      expect(
        emitted.sent.map((event) => event.data.notificationId).sort(),
      ).toEqual([...result.notificationIds].sort());
      expect(
        emitted.sent.map((event) => event.data.recipientId).sort(),
      ).toEqual([ADMIN_A, ADMIN_B]);
    });

    it('requests nothing for a type whose defaults leave email off', async () => {
      // The catalog is the only switch until per-user preferences exist
      // (decision 4). With one type listed today there is no "off" row to
      // emit, so swap the one there is for the duration of this test — a
      // replaced property, never a mutation of the shared constant, so a
      // failure here cannot leak into the next suite.
      const type = NOTIFICATION_TYPES['bug_report.filed'];
      const replaced = jest.replaceProperty(type, 'defaultChannels', {
        ...type.defaultChannels,
        email: false,
      } as typeof type.defaultChannels);
      try {
        const result = await fn.handle(requestedEvent(), inlineStep().step);

        expect(result.notificationIds).toHaveLength(2);
        expect(emitted.sent).toHaveLength(0);
      } finally {
        replaced.restore();
      }
    });

    it('gives every request a stable id, so a replayed step deduplicates instead of duplicating', async () => {
      // The `email` step is one `step.run` over every row. A failure on the
      // last emit replays them all; with fresh ids the earlier rows would each
      // gain a second outbox row that nothing ever marks terminal.
      await fn.handle(requestedEvent(), inlineStep().step);
      const first = emitted.sent.map((event) => event.id);
      emitted.sent.length = 0;
      await fn.handle(requestedEvent(), inlineStep().step);
      const second = emitted.sent.map((event) => event.id);

      expect(first).toHaveLength(2);
      expect(first.every((id) => typeof id === 'string')).toBe(true);
      expect(new Set(first).size).toBe(2);
      expect(second).toEqual(first);
    });

    it("carries the row's agency, not the recipient's", async () => {
      const AGENCY = '507f1f77bcf86cd799439041';
      await fn.handle(
        requestedEvent({
          agencyId: AGENCY,
          dedupeKey: 'bug_report.filed:507f1f77bcf86cd799439033',
        }),
        inlineStep().step,
      );

      expect(emitted.sent.map((event) => event.data.agencyId)).toEqual([
        AGENCY,
        AGENCY,
      ]);
    });
  });

  describe('web push (PR4)', () => {
    const ENDPOINT_A1 = 'https://fcm.googleapis.com/fcm/send/admin-a-phone';
    const ENDPOINT_A2 = 'https://fcm.googleapis.com/fcm/send/admin-a-laptop';
    const ENDPOINT_B1 = 'https://updates.push.services.mozilla.com/wpush/b1';

    it('sends the stored row to every live subscription of each recipient and records sent', async () => {
      await subscribe(ADMIN_A, ENDPOINT_A1);
      await subscribe(ADMIN_A, ENDPOINT_A2);
      await subscribe(ADMIN_B, ENDPOINT_B1);
      // A dead device: soft-deleted earlier, must not be pushed to.
      const dead = await subscribe(
        ADMIN_B,
        'https://fcm.googleapis.com/fcm/send/admin-b-old',
      );
      await subscriptions.updateOne(
        { _id: dead._id },
        { $set: { deletedAt: new Date() } },
      );

      const result = await fn.handle(requestedEvent(), inlineStep().step);

      expect(pushes.sent).toHaveLength(3);
      expect(pushes.sent.map((push) => push.target.endpoint).sort()).toEqual(
        [ENDPOINT_A1, ENDPOINT_A2, ENDPOINT_B1].sort(),
      );

      const rows = await notifications.find({}).lean();
      for (const push of pushes.sent) {
        const row = rows.find(
          (candidate) => candidate._id.toHexString() === push.payload.id,
        );
        expect(row).toBeDefined();
        // The words are the stored row's, the path is app-relative, the icon
        // is absolute — a service worker fetches it with no origin of its own.
        expect(push.payload).toEqual({
          id: row!._id.toHexString(),
          title: row!.title,
          body: row!.body,
          href: '/admin/bugs',
          icon: expect.stringMatching(
            /^https?:\/\/.+\/icon-192\.png$/,
          ) as string,
        });
        expect(JSON.stringify(push.payload).length).toBeLessThan(4096);
        expect(push.target.keys).toEqual({
          p256dh: expect.any(String) as string,
          auth: 'auth-16-bytes!!',
        });
        expect(push.options).toEqual({
          TTL: 3600,
          urgency: 'normal',
          topic: row!._id.toHexString(),
        });
      }
      expect(result.notificationIds).toHaveLength(2);
      for (const row of rows) {
        expect(row.delivery.push).toMatchObject({
          status: 'sent',
          error: null,
        });
        expect(row.delivery.push?.at).toBeInstanceOf(Date);
        // Email is a hand-off; nothing has written its status yet.
        expect(row.delivery.email).toBeNull();
      }

      const live = await subscriptions.find({ deletedAt: null }).lean();
      expect(live).toHaveLength(3);
      for (const sub of live) expect(sub.lastSuccessAt).toBeInstanceOf(Date);
    });

    it('soft-deletes a subscription the push service reports gone, and still sends to the rest', async () => {
      await subscribe(ADMIN_A, ENDPOINT_A1);
      await subscribe(ADMIN_A, ENDPOINT_A2);
      pushes.failures.set(ENDPOINT_A1, gone(410, ENDPOINT_A1));

      await fn.handle(
        requestedEvent({ recipientIds: [ADMIN_A] }),
        inlineStep().step,
      );

      expect(pushes.sent.map((push) => push.target.endpoint)).toEqual([
        ENDPOINT_A2,
      ]);
      const dead = await subscriptions
        .findOne({ endpoint: ENDPOINT_A1 })
        .lean();
      // Still there — never hard-deleted (PAC-155) — but no longer live.
      expect(dead).not.toBeNull();
      expect(dead?.deletedAt).toBeInstanceOf(Date);
      const alive = await subscriptions
        .findOne({ endpoint: ENDPOINT_A2 })
        .lean();
      expect(alive?.deletedAt).toBeNull();

      const row = await notifications.findOne({ recipientId: ADMIN_A }).lean();
      expect(row?.delivery.push?.status).toBe('sent');
    });

    it('treats a 404 like a 410', async () => {
      await subscribe(ADMIN_A, ENDPOINT_A1);
      pushes.failures.set(ENDPOINT_A1, gone(404, ENDPOINT_A1));

      await fn.handle(
        requestedEvent({ recipientIds: [ADMIN_A] }),
        inlineStep().step,
      );

      const dead = await subscriptions
        .findOne({ endpoint: ENDPOINT_A1 })
        .lean();
      expect(dead?.deletedAt).toBeInstanceOf(Date);
      const row = await notifications.findOne({ recipientId: ADMIN_A }).lean();
      // Every subscription had expired: nothing was sent, nothing failed.
      expect(row?.delivery.push).toMatchObject({
        status: 'skipped',
        error: expect.stringContaining('expired') as string,
      });
    });

    it('records a push failure on delivery.push and nothing else on the row', async () => {
      await subscribe(ADMIN_A, ENDPOINT_A1);
      pushes.failures.set(
        ENDPOINT_A1,
        new WebPushError('Service Unavailable', 503, {}, '', ENDPOINT_A1),
      );
      // The run must not throw: a push failure is best-effort by contract.
      const result = await fn.handle(
        requestedEvent({ recipientIds: [ADMIN_A] }),
        inlineStep().step,
      );
      expect(result.notificationIds).toHaveLength(1);

      const row = await notifications.findOne({ recipientId: ADMIN_A }).lean();
      expect(row?.delivery.push).toMatchObject({
        status: 'failed',
        error: expect.stringContaining('Service Unavailable') as string,
      });
      // Only `delivery.push` is written by the channel (PAC-148 FR-H4).
      expect(row).toMatchObject({
        title: 'New bug report',
        body: 'Pat Producer: The leaderboard still shows last month',
        href: '/admin/bugs',
        readAt: null,
      });
      expect(row?.delivery.email).toBeNull();
      // A plain failure is not "gone": the subscription stays live.
      const sub = await subscriptions.findOne({ endpoint: ENDPOINT_A1 }).lean();
      expect(sub?.deletedAt).toBeNull();
    });

    it('records skipped, and sends nothing, for a recipient with no subscription', async () => {
      await fn.handle(
        requestedEvent({ recipientIds: [ADMIN_A] }),
        inlineStep().step,
      );

      expect(pushes.sent).toHaveLength(0);
      const row = await notifications.findOne({ recipientId: ADMIN_A }).lean();
      expect(row?.delivery.push).toMatchObject({
        status: 'skipped',
        error: expect.stringContaining('no push subscription') as string,
      });
    });

    it('sends nothing, and records nothing, for a type whose defaults leave push off', async () => {
      await subscribe(ADMIN_A, ENDPOINT_A1);
      const type = NOTIFICATION_TYPES['bug_report.filed'];
      const replaced = jest.replaceProperty(type, 'defaultChannels', {
        ...type.defaultChannels,
        push: false,
      } as typeof type.defaultChannels);
      try {
        await fn.handle(
          requestedEvent({ recipientIds: [ADMIN_A] }),
          inlineStep().step,
        );
      } finally {
        replaced.restore();
      }

      expect(pushes.sent).toHaveLength(0);
      const row = await notifications.findOne({ recipientId: ADMIN_A }).lean();
      expect(row?.delivery.push).toBeNull();
    });

    it('does not push a row again when the step is replayed', async () => {
      // One `step.run` over every row: a failure on the last one replays
      // them all. Rows that already carry a `delivery.push` outcome are
      // skipped, so a recipient is reached once (PR4 review).
      await subscribe(ADMIN_A, ENDPOINT_A1);
      await fn.handle(requestedEvent(), inlineStep().step);
      const first = await notifications
        .findOne({ recipientId: ADMIN_A })
        .lean();
      expect(pushes.sent).toHaveLength(1);

      await fn.handle(requestedEvent(), inlineStep().step);

      expect(pushes.sent).toHaveLength(1);
      const second = await notifications
        .findOne({ recipientId: ADMIN_A })
        .lean();
      expect(second?.delivery.push?.at).toEqual(first?.delivery.push?.at);
    });

    it('soft-deletes, and never sends to, a stored endpoint that is not a known push service', async () => {
      // Written straight through the model, past the DTO: a row from before
      // the allowlist, or from a host since removed from it. The worker is
      // the last line (PR4 review: SSRF).
      const rogue = await subscribe(
        ADMIN_A,
        'https://169.254.169.254/latest/meta-data/',
      );
      await subscribe(ADMIN_A, ENDPOINT_A1);

      await fn.handle(
        requestedEvent({ recipientIds: [ADMIN_A] }),
        inlineStep().step,
      );

      expect(pushes.sent.map((push) => push.target.endpoint)).toEqual([
        ENDPOINT_A1,
      ]);
      const stored = await subscriptions.findById(rogue._id).lean();
      expect(stored?.deletedAt).toBeInstanceOf(Date);
      const row = await notifications.findOne({ recipientId: ADMIN_A }).lean();
      expect(row?.delivery.push?.status).toBe('sent');
    });
  });

  it('is idempotent: a retry of the same event adds no rows and returns the same ids', async () => {
    const first = await fn.handle(requestedEvent(), inlineStep().step);
    const second = await fn.handle(requestedEvent(), inlineStep().step);

    expect(second.notificationIds.sort()).toEqual(first.notificationIds.sort());
    await expect(notifications.countDocuments({})).resolves.toBe(2);
  });

  it('converges after a partial insert: only the missing recipient is added', async () => {
    await fn.handle(
      requestedEvent({ recipientIds: [ADMIN_A] }),
      inlineStep().step,
    );
    // The same business fact, now addressed to both — as a producer retried
    // after a long outage, or a cron reusing its key, would send it.
    const result = await fn.handle(requestedEvent(), inlineStep().step);

    expect(result.notificationIds).toHaveLength(2);
    await expect(notifications.countDocuments({})).resolves.toBe(2);
    await expect(
      notifications.countDocuments({ dedupeKey: /bug_report/ }),
    ).resolves.toBe(2);
  });

  it('collapses a recipient listed twice into one row', async () => {
    const result = await fn.handle(
      requestedEvent({ recipientIds: [ADMIN_A, ADMIN_A, ADMIN_B] }),
      inlineStep().step,
    );

    expect(result.notificationIds).toHaveLength(2);
    await expect(notifications.countDocuments({})).resolves.toBe(2);
  });

  it('keeps distinct facts distinct: a different dedupeKey for the same recipient is a new row', async () => {
    await fn.handle(requestedEvent(), inlineStep().step);
    await fn.handle(
      requestedEvent({
        entity: { kind: 'bugReport', id: '507f1f77bcf86cd799439032' },
        dedupeKey: 'bug_report.filed:507f1f77bcf86cd799439032',
      }),
      inlineStep().step,
    );

    await expect(
      notifications.countDocuments({ recipientId: ADMIN_A }),
    ).resolves.toBe(2);
  });

  it('fails without retrying on a type the catalog does not know', async () => {
    const { step } = inlineStep();
    const event = requestedEvent();
    // Bypass the event schema the way a stale worker build would.
    (event.data as { type: string }).type = 'lead.teleported';

    await expect(fn.handle(event, step)).rejects.toBeInstanceOf(
      NonRetriableError,
    );
    await expect(notifications.countDocuments({})).resolves.toBe(0);
  });
});
