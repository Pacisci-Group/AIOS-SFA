import { Test } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { ENV_FILE_PATH } from '../../src/config/env.config';
import { InngestModule } from '../../src/inngest/inngest.module';
import { WorkerModule } from '../../src/worker/worker.module';
import { SendPasswordResetEmailFn } from '../../src/worker/functions/send-password-reset-email.fn';
import {
  MailTransport,
  type OutboundMessage,
  type SendResult,
} from '../../src/worker/email/mail-transport';
import {
  EmailMessage,
  type EmailMessageDocument,
} from '../../src/worker/email/schemas/email-message.schema';
import type { PasswordResetRequestedData } from '../../src/inngest/events';

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
 * A stand-in for Inngest's step tooling that runs each step inline — the same
 * seam `send-invite-email.e2e-spec.ts` uses, and for the same reason: retry and
 * memoization are Inngest's to guarantee, so what is worth testing here is our
 * handler's logic.
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

function resetEvent(overrides: Partial<PasswordResetRequestedData> = {}): {
  id: string;
  name: string;
  data: PasswordResetRequestedData;
} {
  return {
    id: '01ABCDEF',
    name: 'email/password-reset.requested.v1',
    data: {
      // Stamped by `InngestService.send` in real life; the handler never reads
      // it — the event-log middleware does.
      eventLogId: '507f1f77bcf86cd799439010',
      userId: '507f1f77bcf86cd799439011',
      agencyId: '507f1f77bcf86cd799439012',
      branchId: null,
      to: 'pat@example.com',
      recipientName: 'Pat Producer',
      agencyName: 'Smith Family Agency',
      resetUrl: 'https://app.example.com/auth/reset-password?token=abc123',
      expiresAt: '2026-08-26T14:30:00.000Z',
      ...overrides,
    },
  };
}

describe('SendPasswordResetEmailFn (e2e)', () => {
  let app: INestApplication;
  let fn: SendPasswordResetEmailFn;
  let transport: CaptureMailTransport;
  let messages: Model<EmailMessage>;

  beforeAll(async () => {
    transport = new CaptureMailTransport();

    // Boots WorkerModule against a real Mongo with only the transport
    // substituted. Templates, the delivery service, the schema and its indexes
    // are all the real thing.
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

    fn = app.get(SendPasswordResetEmailFn);
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

    const result = await fn.handle(resetEvent(), step);

    expect(transport.sent).toHaveLength(1);
    expect(result.providerMessageId).toBe('capture-1');
    // Both steps ran, in order. The split is what makes a crash between them
    // cost a re-recorded row rather than a second live reset link.
    expect(ran).toEqual(['send', 'record']);

    await expect(messages.countDocuments({})).resolves.toBe(1);
  });

  it('records the delivery with the event and tenancy context', async () => {
    const { step } = inlineStep();
    await fn.handle(resetEvent(), step);

    const row = (await messages.findOne({}).lean()) as EmailMessageDocument;

    expect(row).toMatchObject({
      agencyId: '507f1f77bcf86cd799439012',
      branchId: null,
      eventId: '01ABCDEF',
      eventType: 'email/password-reset.requested.v1',
      templateKey: 'passwordReset',
      to: 'pat@example.com',
      status: 'sent',
      providerMessageId: 'capture-1',
    });
    expect(row.sentAt).toBeInstanceOf(Date);
  });

  it('never persists the reset URL', async () => {
    // The strongest form of the rule the delivery schema documents: a reset
    // link takes over an account that already exists and has data in it. A row
    // readable by support and by any future admin UI must not contain one.
    const { step } = inlineStep();
    const event = resetEvent();
    await fn.handle(event, step);

    const row = await messages.findOne({}).lean();
    expect(JSON.stringify(row)).not.toContain(event.data.resetUrl);
    expect(JSON.stringify(row)).not.toContain('abc123');
    // A hash of the body is kept instead, so two recipients' content can still
    // be compared.
    expect(row?.bodyHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('passes the reset URL as the provider idempotency key', async () => {
    const { step } = inlineStep();
    const event = resetEvent();
    await fn.handle(event, step);

    // Matches the function's `idempotency: 'event.data.resetUrl'`, so both
    // layers dedupe on the same thing: a retry collapses, a genuine re-issue
    // (new token, new URL) correctly sends again.
    expect(transport.sent[0].idempotencyKey).toBe(event.data.resetUrl);
  });

  it('records nothing when the send fails', async () => {
    // A delivery row for an email that never left would be worse than no row.
    // The throw is what makes Inngest retry.
    const { step, ran } = inlineStep();
    transport.failWith = new Error('provider exploded');

    await expect(fn.handle(resetEvent(), step)).rejects.toThrow(
      'provider exploded',
    );

    expect(ran).toEqual(['send']);
    await expect(messages.countDocuments({})).resolves.toBe(0);
  });

  it('renders the agency into the stored subject, and no person', async () => {
    const { step } = inlineStep();
    await fn.handle(resetEvent(), step);

    const row = await messages.findOne({}).lean();
    expect(row?.subject).toBe(
      'Reset your Smith Family Agency password on AgencyOps',
    );
  });
});
