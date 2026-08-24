import { Test } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  MongooseModule,
  getModelToken,
  getConnectionToken,
} from '@nestjs/mongoose';
import { INestApplication } from '@nestjs/common';
import { Connection, Model } from 'mongoose';
import { ENV_FILE_PATH } from '../src/config/env.config';
import { InngestModule } from '../src/inngest/inngest.module';
import { InngestService } from '../src/inngest/inngest.service';
import { INNGEST_CLIENT } from '../src/inngest/inngest.client';
import { inviteRequested } from '../src/inngest/events';
import { EventLogEntry } from '../src/inngest/event-log/event-log.schema';

/** Captures outbound events, and can be told to fail like an unreachable Inngest. */
class CaptureClient {
  readonly sent: Array<{
    id?: string;
    name: string;
    data: Record<string, unknown>;
  }> = [];
  failWith: Error | null = null;

  send(event: {
    id?: string;
    name: string;
    data: Record<string, unknown>;
  }): Promise<void> {
    if (this.failWith) return Promise.reject(this.failWith);
    this.sent.push({ id: event.id, name: event.name, data: event.data });
    return Promise.resolve();
  }
}

/** The invite payload minus `eventLogId`, which the transport stamps. */
function invitePayload() {
  return {
    userId: '507f1f77bcf86cd799439011',
    agencyId: '507f1f77bcf86cd799439012',
    branchId: null,
    to: 'pat@example.com',
    recipientName: 'Pat Producer',
    agencyName: 'Smith Family Agency',
    inviterName: 'Dana Owner',
    roleNames: ['Producer'],
    inviteUrl: 'https://app.example.com/auth/accept-invite?token=abc123',
    expiresAt: '2026-08-26T00:00:00.000Z',
  };
}

describe('Event log — the emit gap (e2e)', () => {
  let app: INestApplication;
  let events: InngestService;
  let client: CaptureClient;
  let entries: Model<EventLogEntry>;

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
      ],
    })
      .overrideProvider(INNGEST_CLIENT)
      .useValue(client)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();

    events = app.get(InngestService);
    entries = app.get<Model<EventLogEntry>>(getModelToken(EventLogEntry.name));
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
    client.failWith = null;
    await entries.deleteMany({});
  });

  it('writes one pending row per event, with tenancy read off the payload', async () => {
    await events.send(inviteRequested, invitePayload());

    const rows = await entries.find({}).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      eventName: 'email/invite.requested.v1',
      status: 'pending',
      agencyId: '507f1f77bcf86cd799439012',
      branchId: null,
      resendCount: 0,
    });
    // Null until a terminal state, which is what keeps the TTL reaper away from
    // a row the sweeper might still need.
    expect(rows[0].expiresAt).toBeNull();
  });

  it('stamps the row id onto the event, as both `id` and `data.eventLogId`', async () => {
    await events.send(inviteRequested, invitePayload());

    const row = (await entries.findOne({}).lean())!;
    const id = row._id.toString();

    expect(client.sent).toHaveLength(1);
    // `id` is what Inngest deduplicates on, so a sweeper replay is a no-op.
    expect(client.sent[0].id).toBe(id);
    // `data.eventLogId` is what the worker's middleware reads back — carried in
    // the payload rather than trusted to survive as `event.id`.
    expect(client.sent[0].data.eventLogId).toBe(id);
  });

  /**
   * The guarantee the whole outbox exists for.
   *
   * If the row were written after the send — or only on success — an unreachable
   * Inngest would leave no trace that the work was ever requested, and nothing
   * could recover it. Writing first is what turns "lost" into "late".
   */
  it('keeps the pending row when the send fails, so the sweeper can recover it', async () => {
    client.failWith = new Error('inngest unreachable');

    await expect(events.send(inviteRequested, invitePayload())).rejects.toThrow(
      'inngest unreachable',
    );

    const rows = await entries.find({}).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('pending');
  });

  /**
   * Validation runs before the write, deliberately. A payload the catalog
   * rejects is a producer bug, not lost work — leaving a row behind would give
   * the sweeper something to retry forever against a payload that can never
   * succeed.
   */
  it('writes no row when the payload fails catalog validation', async () => {
    await expect(
      events.send(inviteRequested, {
        ...invitePayload(),
        agencyId: 'not-an-object-id',
      }),
    ).rejects.toThrow();

    expect(await entries.countDocuments({})).toBe(0);
    expect(client.sent).toHaveLength(0);
  });
});
