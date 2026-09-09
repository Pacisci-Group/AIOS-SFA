import { Test } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { ENV_FILE_PATH } from '../../src/config/env.config';
import { InngestModule } from '../../src/inngest/inngest.module';
import { WorkerModule } from '../../src/worker/worker.module';
import { SendInviteEmailFn } from '../../src/worker/functions/send-invite-email.fn';
import {
  MailTransport,
  type OutboundMessage,
  type SendResult,
} from '../../src/worker/email/mail-transport';
import {
  EmailMessage,
  type EmailMessageDocument,
} from '../../src/worker/email/schemas/email-message.schema';
import type { InviteRequestedData } from '../../src/inngest/events';

/** Records what would have been sent, so assertions can inspect it. */
class CaptureMailTransport extends MailTransport {
  readonly sent: Array<{ message: OutboundMessage; idempotencyKey: string }> =
    [];
  /** Set to throw on the next send, to exercise the failure path. */
  failWith: Error | null = null;

  send(message: OutboundMessage, idempotencyKey: string): Promise<SendResult> {
    if (this.failWith) return Promise.reject(this.failWith);
    this.sent.push({ message, idempotencyKey });
    return Promise.resolve({
      providerMessageId: `capture-${this.sent.length}`,
    });
  }
}

/**
 * A stand-in for Inngest's step tooling that simply runs each step inline.
 *
 * This is what makes the handler testable without a running Inngest server: the
 * platform's retry/memoization behaviour is Inngest's to guarantee, so the
 * thing worth testing is our handler's logic, and that only needs `run` to
 * invoke the callback.
 */
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

function inviteEvent(overrides: Partial<InviteRequestedData> = {}): {
  id: string;
  name: string;
  data: InviteRequestedData;
} {
  return {
    id: '01ABCDEF',
    name: 'email/invite.requested.v1',
    data: {
      // Stamped by `InngestService.send` in real life; the handler itself never
      // reads it — the event-log middleware does.
      eventLogId: '507f1f77bcf86cd799439010',
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
      ...overrides,
    },
  };
}

describe('SendInviteEmailFn (e2e)', () => {
  let app: INestApplication;
  let fn: SendInviteEmailFn;
  let transport: CaptureMailTransport;
  let messages: Model<EmailMessage>;

  beforeAll(async () => {
    transport = new CaptureMailTransport();

    // Boots WorkerModule against a real Mongo, with only the transport
    // substituted. Everything else — templates, the delivery service, the
    // schema and its indexes — is the real thing.
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
      .overrideProvider(MailTransport)
      .useValue(transport)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();

    fn = app.get(SendInviteEmailFn);
    messages = app.get<Model<EmailMessage>>(getModelToken(EmailMessage.name));
  });

  afterAll(async () => {
    if (app) {
      const connection = app.get<Connection>(getConnectionToken());
      await connection.db?.dropDatabase();
      await app.close();
    }
  });

  beforeEach(async () => {
    transport.sent.length = 0;
    transport.failWith = null;
    await messages.deleteMany({});
  });

  it('sends exactly one email and records exactly one delivery', async () => {
    const { step, ran } = inlineStep();
    const event = inviteEvent();

    const result = await fn.handle(event, step);

    expect(transport.sent).toHaveLength(1);
    expect(result.providerMessageId).toBe('capture-1');
    // Both steps ran, and in order. The split is what makes a crash between
    // them cost a re-recorded row rather than a second email.
    expect(ran).toEqual(['send', 'record']);

    const rows = await messages.find({}).lean();
    expect(rows).toHaveLength(1);
  });

  it('records the delivery with the event and tenancy context', async () => {
    const { step } = inlineStep();
    await fn.handle(inviteEvent(), step);

    const row = (await messages.findOne({}).lean()) as EmailMessageDocument;

    expect(row).toMatchObject({
      agencyId: '507f1f77bcf86cd799439012',
      branchId: null,
      eventId: '01ABCDEF',
      eventType: 'email/invite.requested.v1',
      templateKey: 'invite',
      to: 'pat@example.com',
      status: 'sent',
      providerMessageId: 'capture-1',
    });
    expect(row.sentAt).toBeInstanceOf(Date);
  });

  it('never persists the invite URL', async () => {
    // The invite link is a bearer credential. A delivery record is readable by
    // support and by any future admin UI, so a working password-set URL must
    // not be sitting in it.
    const { step } = inlineStep();
    const event = inviteEvent();
    await fn.handle(event, step);

    const row = await messages.findOne({}).lean();
    expect(JSON.stringify(row)).not.toContain(event.data.inviteUrl);
    // A hash of the body is kept instead, so two recipients' content can still
    // be compared.
    expect(row?.bodyHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('passes the invite URL as the provider idempotency key', async () => {
    const { step } = inlineStep();
    const event = inviteEvent();
    await fn.handle(event, step);

    // Matches the function's `idempotency: 'event.data.inviteUrl'`, so the two
    // layers dedupe on the same thing: a retry collapses, a genuine resend
    // (new token, new URL) correctly sends again.
    expect(transport.sent[0].idempotencyKey).toBe(event.data.inviteUrl);
  });

  it('records nothing when the send fails', async () => {
    // The record step must not run if the send threw — a delivery row for an
    // email that never left would be worse than no row at all. The throw is
    // what makes Inngest retry.
    const { step, ran } = inlineStep();
    transport.failWith = new Error('provider exploded');

    await expect(fn.handle(inviteEvent(), step)).rejects.toThrow(
      'provider exploded',
    );

    expect(ran).toEqual(['send']);
    await expect(messages.countDocuments({})).resolves.toBe(0);
  });

  it('renders the agency and inviter into the stored subject', async () => {
    const { step } = inlineStep();
    await fn.handle(inviteEvent(), step);

    // No "on AgencyOps" suffix: the subject is white-labelled, so it names the
    // agency the invitee is joining and never the platform behind it.
    const row = await messages.findOne({}).lean();
    expect(row?.subject).toBe('Dana Owner invited you to Smith Family Agency');
  });
});
