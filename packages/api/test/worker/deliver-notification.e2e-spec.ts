import { INestApplication } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  MongooseModule,
  getConnectionToken,
  getModelToken,
} from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { NonRetriableError } from 'inngest';
import { Connection, Model } from 'mongoose';
import { ENV_FILE_PATH } from '../../src/config/env.config';
import type { NotificationRequestedData } from '../../src/inngest/events';
import { InngestModule } from '../../src/inngest/inngest.module';
import { Notification } from '../../src/notifications/schemas/notification.schema';
import { DeliverNotificationFn } from '../../src/worker/functions/deliver-notification.fn';
import { WorkerModule } from '../../src/worker/worker.module';

const ADMIN_A = '507f1f77bcf86cd799439021';
const ADMIN_B = '507f1f77bcf86cd799439022';
const REPORTER = '507f1f77bcf86cd799439011';

/** Runs each step inline — the platform's memoisation is Inngest's to prove. */
function inlineStep() {
  const ran: string[] = [];
  return {
    ran,
    step: {
      run: async <T>(
        id: string,
        fn: () => Promise<T> | T,
      ): Promise<unknown> => {
        ran.push(id);
        return await fn();
      },
    },
  };
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
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    fn = app.get(DeliverNotificationFn);
    notifications = app.get<Model<Notification>>(
      getModelToken(Notification.name),
    );
    // The worker root boots with `autoIndex: false`; the API owns these
    // indexes. The unique one is what the dedupe cases below exercise, so
    // build it here the way the API would.
    await notifications.syncIndexes();
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
  });

  it('writes one rendered, unread row per recipient', async () => {
    const { step, ran } = inlineStep();

    const result = await fn.handle(requestedEvent(), step);

    expect(ran).toEqual(['insert']);
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
