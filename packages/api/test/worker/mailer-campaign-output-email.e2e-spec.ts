import { INestApplication } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  MongooseModule,
  getConnectionToken,
  getModelToken,
} from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Connection, Model, Types } from 'mongoose';
import { ENV_FILE_PATH } from '../../src/config/env.config';
import { DEFAULT_MAILER_OUTPUT_LINK_TTL_SECONDS } from '../../src/config/mailer-output.config';
import { InngestModule } from '../../src/inngest/inngest.module';
import {
  MailerCampaign,
  type MailerCampaignDocument,
} from '../../src/mailers/schemas/mailer-campaign.schema';
import { StorageService } from '../../src/storage/storage.service';
import { WorkerModule } from '../../src/worker/worker.module';
import { MailerCampaignOutputEmailFn } from '../../src/worker/functions/mailer-campaign-output-email.fn';
import {
  MailTransport,
  type OutboundMessage,
  type SendResult,
} from '../../src/worker/email/mail-transport';
import {
  EmailMessage,
  type EmailMessageDocument,
} from '../../src/worker/email/schemas/email-message.schema';
import { FakeStorage } from '../helpers/fake-storage';

/**
 * The campaign completion email (PAC-71).
 *
 * The interesting assertions are all about the *link*, because that is what
 * this feature is: the file is too big to attach, so the mail's entire value is
 * a URL that still works when the printer opens it tomorrow and does not sit in
 * a database afterwards. The rest — one mail per recipient, no tenant on the
 * record — is what makes it platform mail rather than an agency's.
 */

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

describe('MailerCampaignOutputEmailFn (e2e)', () => {
  let app: INestApplication;
  let connection: Connection;
  let storage: FakeStorage;
  let transport: CaptureMailTransport;
  let fn: MailerCampaignOutputEmailFn;
  let campaigns: Model<MailerCampaign>;
  let messages: Model<EmailMessage>;

  const OUTPUT_KEY = 'platform/mailer-campaigns/2026/output/abc/1/sfa-qbp.csv';

  /** An imported campaign with a print file sitting in storage. */
  const stage = async (
    overrides: Record<string, unknown> = {},
  ): Promise<MailerCampaignDocument> => {
    await storage.putObject(
      OUTPUT_KEY,
      Buffer.from('firstname,lastname\nPat,Producer\n', 'utf8'),
      'text/csv',
    );
    return campaigns.create({
      carrierId: new Types.ObjectId(),
      name: 'Week 36',
      campaignNumber: 'Week_Number-36',
      year: 2026,
      status: 'imported',
      source: 'vendor',
      assignment: { mode: 'all', agencyIds: [] },
      commitMode: 'append',
      commitAttempt: 1,
      requestedBy: new Types.ObjectId(),
      outputFile: {
        storageKey: OUTPUT_KEY,
        name: 'SFA-QBP.csv',
        size: 34,
        contentType: 'text/csv',
      },
      stats: {
        inputRows: 198,
        outputRows: 197,
        duplicatesRemoved: 1,
        floorRaised: 188,
        zipMatched: 197,
        zipUnmatched: 0,
        zipEmpty: 0,
        premium: null,
      },
      importCounts: {
        read: 197,
        mapped: 196,
        created: 190,
        updated: 6,
        skipped: 1,
        deleted: 0,
        leadsLinked: 0,
        leadsConflicted: 0,
      },
      ...overrides,
    });
  };

  const run = (
    campaign: MailerCampaignDocument,
    recipients: string[],
    step = inlineStep().step,
    attempt = 1,
  ) =>
    fn.handle(
      {
        id: 'evt',
        name: 'mailers/campaign.output-email.requested.v1',
        data: {
          eventLogId: new Types.ObjectId().toHexString(),
          campaignId: campaign._id.toString(),
          attempt,
          requestedBy: campaign.requestedBy?.toString() ?? '',
          recipients,
        },
      },
      step,
    );

  beforeAll(async () => {
    storage = new FakeStorage();
    transport = new CaptureMailTransport();

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, envFilePath: ENV_FILE_PATH }),
        MongooseModule.forRootAsync({
          imports: [ConfigModule],
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({
            uri: config.get<string>('MONGODB_URI', ''),
          }),
        }),
        InngestModule,
        WorkerModule,
      ],
    })
      .overrideProvider(StorageService)
      .useValue(storage.asService())
      .overrideProvider(MailTransport)
      .useValue(transport)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();

    connection = app.get<Connection>(getConnectionToken());
    await connection.db!.dropDatabase();

    fn = app.get(MailerCampaignOutputEmailFn);
    campaigns = app.get(getModelToken(MailerCampaign.name));
    messages = app.get(getModelToken(EmailMessage.name));
  });

  afterAll(async () => {
    if (app) {
      await connection.db?.dropDatabase();
      await app.close();
    }
  });

  beforeEach(async () => {
    transport.sent.length = 0;
    transport.failWith = null;
    storage.downloads.length = 0;
    await Promise.all([campaigns.deleteMany({}), messages.deleteMany({})]);
  });

  it('sends one email per recipient and records each delivery', async () => {
    const campaign = await stage();
    const { step, ran } = inlineStep();

    const result = await run(campaign, [
      'print@vendor.example',
      'david@apex.example',
    ]);
    expect(result.sent).toBe(2);

    // Re-run with the tracking step to assert the ordering, since `handle`
    // above used its own.
    await run(campaign, ['print@vendor.example'], step);
    // Send and record are separate steps per recipient: `step.run` memoizes on
    // success, so a crash between them costs a re-recorded row, never a second
    // email.
    expect(ran).toEqual(['load', 'send:0', 'record:0']);

    expect(transport.sent.map((s) => s.message.to)).toEqual([
      'print@vendor.example',
      'david@apex.example',
      'print@vendor.example',
    ]);
    await expect(messages.countDocuments({})).resolves.toBe(3);
  });

  it('signs the link for seven days, as an attachment named like the file', async () => {
    const campaign = await stage();
    await run(campaign, ['print@vendor.example']);

    // The whole point of the feature: the five-minute default the campaign page
    // uses would be dead before the recipient opened the mail.
    expect(storage.downloads).toEqual([
      {
        key: OUTPUT_KEY,
        disposition: 'attachment',
        filename: 'SFA-QBP.csv',
        expiresIn: DEFAULT_MAILER_OUTPUT_LINK_TTL_SECONDS,
      },
    ]);

    const { message } = transport.sent[0];
    const url = `https://storage.test/${OUTPUT_KEY}?signed=1&expires=${DEFAULT_MAILER_OUTPUT_LINK_TTL_SECONDS}`;
    // Escaped in the html — a presigned URL is full of `&`-joined query
    // parameters, and an unescaped one would break the markup around it.
    expect(message.html).toContain(url.replace(/&/g, '&amp;'));
    // Buttons are stripped in some clients, and this URL is the only copy of
    // the file the recipient has, so it survives verbatim into the text part.
    expect(message.text).toContain(url);
  });

  it('links back to the campaign page as the durable path', async () => {
    const campaign = await stage();
    await run(campaign, ['print@vendor.example']);

    expect(transport.sent[0].message.text).toContain(
      `/admin/campaigns/${campaign._id.toString()}`,
    );
  });

  it('reports the run in the subject and the counts in the body', async () => {
    const campaign = await stage();
    await run(campaign, ['print@vendor.example']);

    const { message } = transport.sent[0];
    expect(message.subject).toBe(
      'Mail file ready: Week 36 (Week_Number-36, 2026)',
    );
    // 197 output rows, and 190 created + 6 updated mailers.
    expect(message.text).toContain('197 records');
    expect(message.text).toContain('196 mailers');
  });

  it('records the delivery with no agency at all', async () => {
    // A campaign is run once and can serve many agencies, so there is no tenant
    // to file this under. A sentinel agency id would put platform mail into
    // some agency's support view.
    const campaign = await stage();
    await run(campaign, ['print@vendor.example']);

    const row = (await messages.findOne({}).lean()) as EmailMessageDocument;
    expect(row).toMatchObject({
      agencyId: null,
      branchId: null,
      eventId: 'evt',
      eventType: 'mailers/campaign.output-email.requested.v1',
      templateKey: 'mailerCampaignOutput',
      to: 'print@vendor.example',
      status: 'sent',
    });
  });

  it('never persists the download link', async () => {
    // The presigned URL is a bearer capability: whoever holds it can fetch the
    // file with no login and no tenant check. A delivery record is readable by
    // support, so it keeps a hash of the body rather than the body.
    const campaign = await stage();
    await run(campaign, ['print@vendor.example']);

    const row = await messages.findOne({}).lean();
    expect(JSON.stringify(row)).not.toContain('signed=1');
    expect(row?.bodyHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('keys provider idempotency on campaign, attempt and recipient', async () => {
    const campaign = await stage();
    const id = campaign._id.toString();

    await run(campaign, ['print@vendor.example', 'david@apex.example']);
    // A re-send of the same run to the same address collapses at the provider…
    await run(campaign, ['print@vendor.example']);
    // …while a second commit of the same campaign correctly mails again.
    await run(campaign, ['print@vendor.example'], inlineStep().step, 2);

    expect(transport.sent.map((s) => s.idempotencyKey)).toEqual([
      `mailer-campaign:${id}:1:print@vendor.example`,
      `mailer-campaign:${id}:1:david@apex.example`,
      `mailer-campaign:${id}:1:print@vendor.example`,
      `mailer-campaign:${id}:2:print@vendor.example`,
    ]);
  });

  it('is a no-op, not a failure, when there is nothing to mail', async () => {
    // A campaign deleted or re-run between the commit and this job is not worth
    // four retries and a red run in the dashboard.
    const stillRunning = await stage({ status: 'processing' });
    const { step, ran } = inlineStep();

    await expect(
      run(stillRunning, ['print@vendor.example'], step),
    ).resolves.toEqual({ sent: 0 });

    expect(ran).toEqual(['load']);
    expect(transport.sent).toHaveLength(0);
    await expect(messages.countDocuments({})).resolves.toBe(0);
  });

  it('records nothing when the send fails', async () => {
    // The record step must not run if the send threw — a delivery row for an
    // email that never left is worse than no row. The throw is what makes
    // Inngest retry, and the memoized earlier steps are what stop the retry
    // from mailing the first recipients again.
    const campaign = await stage();
    const { step, ran } = inlineStep();
    transport.failWith = new Error('provider exploded');

    await expect(run(campaign, ['print@vendor.example'], step)).rejects.toThrow(
      'provider exploded',
    );

    expect(ran).toEqual(['load', 'send:0']);
    await expect(messages.countDocuments({})).resolves.toBe(0);
  });
});
