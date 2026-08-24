import { Test } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  MongooseModule,
  getModelToken,
  getConnectionToken,
} from '@nestjs/mongoose';
import { INestApplication } from '@nestjs/common';
import { Connection, Model, Types } from 'mongoose';
import { ENV_FILE_PATH } from '../../src/config/env.config';
import { InngestModule } from '../../src/inngest/inngest.module';
import { InngestService } from '../../src/inngest/inngest.service';
import { WorkerModule } from '../../src/worker/worker.module';
import { SweepEventLogFn } from '../../src/worker/functions/sweep-event-log.fn';
import { MailTransport } from '../../src/worker/email/mail-transport';
import {
  EventLogEntry,
  type EventLogStatus,
} from '../../src/inngest/event-log/event-log.schema';
import { DEFAULT_EVENT_LOG_STALE_MINUTES } from '../../src/config/event-log.config';

/**
 * Captures what would have gone back to Inngest.
 *
 * Substituted for the Inngest **client**, not for `InngestService` — the thing
 * under test is `InngestService.resend`'s behaviour (does it preserve the id?),
 * so stubbing the service would test the stub.
 */
class CaptureClient {
  readonly sent: Array<{ id: string; name: string }> = [];

  send(event: { id: string; name: string }): Promise<void> {
    this.sent.push({ id: event.id, name: event.name });
    return Promise.resolve();
  }
}

/** Runs each step inline — same seam as `send-invite-email.e2e-spec.ts`. */
function inlineStep() {
  const ran: string[] = [];
  return {
    ran,
    step: {
      run: <T>(id: string, fn: () => Promise<T> | T): Promise<unknown> => {
        ran.push(id);
        return Promise.resolve(fn());
      },
    },
  };
}

const MINUTE_MS = 60 * 1000;

describe('SweepEventLogFn (e2e)', () => {
  let app: INestApplication;
  let fn: SweepEventLogFn;
  let client: CaptureClient;
  let entries: Model<EventLogEntry>;

  /** Insert a row with an explicit age, bypassing the `timestamps` default. */
  async function seedRow(opts: {
    minutesOld: number;
    status?: EventLogStatus;
  }): Promise<string> {
    const id = new Types.ObjectId();
    const createdAt = new Date(Date.now() - opts.minutesOld * MINUTE_MS);
    await entries.collection.insertOne({
      _id: id,
      eventName: 'email/invite.requested.v1',
      payload: { eventLogId: id.toHexString(), to: 'pat@example.com' },
      status: opts.status ?? 'pending',
      attempts: 0,
      lastError: '',
      runId: null,
      resendCount: 0,
      agencyId: '507f1f77bcf86cd799439012',
      branchId: null,
      expiresAt: null,
      createdAt,
      updatedAt: createdAt,
    });
    return id.toHexString();
  }

  beforeAll(async () => {
    client = new CaptureClient();

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
      // No real mail transport: this suite never gets as far as sending one, but
      // WorkerModule would otherwise construct a Resend client from the repo .env.
      .overrideProvider(MailTransport)
      .useValue({ send: () => Promise.resolve({ providerMessageId: 'x' }) })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();

    fn = app.get(SweepEventLogFn);
    entries = app.get<Model<EventLogEntry>>(getModelToken(EventLogEntry.name));

    // Swap the client on the already-constructed service. The client is a
    // symbol-keyed factory provider baked into InngestService at construction,
    // so overriding the token would not reach this instance.
    Object.defineProperty(app.get(InngestService), 'client', {
      value: client,
      writable: true,
    });
  });

  afterAll(async () => {
    if (app) {
      const connection = app.get<Connection>(getConnectionToken());
      await connection.db?.dropDatabase();
      await app.close();
    }
  });

  beforeEach(async () => {
    client.sent.length = 0;
    await entries.deleteMany({});
  });

  it('replays a stale pending row, preserving the original event id', async () => {
    const id = await seedRow({
      minutesOld: DEFAULT_EVENT_LOG_STALE_MINUTES + 5,
    });
    const { step, ran } = inlineStep();

    const result = await fn.handle(step);

    expect(result).toEqual({ replayed: 1 });
    // The id is what makes a live sweeper safe: Inngest deduplicates on it, so
    // a row it still remembers is a no-op rather than a second email.
    expect(client.sent).toEqual([{ id, name: 'email/invite.requested.v1' }]);
    expect(ran).toEqual(['find-stale', `replay-${id}`]);

    const row = await entries.findById(id).lean();
    expect(row?.resendCount).toBe(1);
    // Still pending — a replay is not an outcome. Only the middleware makes a
    // row terminal.
    expect(row?.status).toBe('pending');
  });

  it('leaves a pending row that is not yet stale alone', async () => {
    await seedRow({ minutesOld: DEFAULT_EVENT_LOG_STALE_MINUTES - 5 });
    const { step } = inlineStep();

    const result = await fn.handle(step);

    expect(result).toEqual({ replayed: 0 });
    expect(client.sent).toEqual([]);
  });

  it.each(['succeeded', 'failed'] as const)(
    'never replays a %s row, however old',
    async (status) => {
      await seedRow({ minutesOld: 60 * 24, status });
      const { step } = inlineStep();

      const result = await fn.handle(step);

      expect(result).toEqual({ replayed: 0 });
      expect(client.sent).toEqual([]);
    },
  );

  it('replays every stale row in one sweep', async () => {
    const ids = [
      await seedRow({ minutesOld: 60 }),
      await seedRow({ minutesOld: 45 }),
      await seedRow({ minutesOld: 30 }),
    ];
    const { step } = inlineStep();

    const result = await fn.handle(step);

    expect(result).toEqual({ replayed: 3 });
    // Oldest first: after an outage the backlog should drain in the order the
    // work was originally requested.
    expect(client.sent.map((e) => e.id)).toEqual(ids);
  });
});
