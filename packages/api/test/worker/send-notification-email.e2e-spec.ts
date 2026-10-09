import { INestApplication } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  MongooseModule,
  getConnectionToken,
  getModelToken,
} from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { NonRetriableError } from 'inngest';
import { Connection, Model, Types } from 'mongoose';
import { ENV_FILE_PATH } from '../../src/config/env.config';
import type { NotificationEmailRequestedData } from '../../src/inngest/events';
import { InngestModule } from '../../src/inngest/inngest.module';
import { Notification } from '../../src/notifications/schemas/notification.schema';
import { Agency } from '../../src/platform/schemas/agency.schema';
import { AgencyDomain } from '../../src/platform/schemas/agency-domain.schema';
import { User } from '../../src/users/schemas/user.schema';
import {
  MailTransport,
  type OutboundMessage,
  type SendResult,
} from '../../src/worker/email/mail-transport';
import {
  EmailMessage,
  type EmailMessageDocument,
} from '../../src/worker/email/schemas/email-message.schema';
import { SendNotificationEmailFn } from '../../src/worker/functions/send-notification-email.fn';
import { WorkerModule } from '../../src/worker/worker.module';
import { inlineStep } from '../helpers/inline-step';

/**
 * The notification email (PAC-154, PR3).
 *
 * The assertions that matter are about the **host in the link**, because that
 * is the one thing this function adds to the stored row: the row holds a path,
 * and `HostTenantGuard` refuses the recipient on any host but their own. The
 * rest — one mail, one record, the row's `delivery.email` — is what makes it a
 * channel rather than a fire-and-forget.
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

/** `test/setup-env.ts` pins both; the links below are derived from them. */
const PLATFORM_ORIGIN = 'http://127.0.0.1:5173';
const TENANT_HOST = 'texasholdings.test';
const TENANT_ORIGIN = `http://${TENANT_HOST}:5173`;

describe('SendNotificationEmailFn (e2e)', () => {
  let app: INestApplication;
  let transport: CaptureMailTransport;
  let fn: SendNotificationEmailFn;
  let notifications: Model<Notification>;
  let users: Model<User>;
  let agencies: Model<Agency>;
  let domains: Model<AgencyDomain>;
  let messages: Model<EmailMessage>;

  let agencyId: Types.ObjectId;

  beforeAll(async () => {
    transport = new CaptureMailTransport();

    // Boots WorkerModule against a real Mongo with only the transport
    // substituted: the template, the delivery service, branding, the tenant
    // URL resolver and every schema are the real thing.
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

    fn = app.get(SendNotificationEmailFn);
    notifications = app.get<Model<Notification>>(
      getModelToken(Notification.name),
    );
    users = app.get<Model<User>>(getModelToken(User.name));
    agencies = app.get<Model<Agency>>(getModelToken(Agency.name));
    domains = app.get<Model<AgencyDomain>>(getModelToken(AgencyDomain.name));
    messages = app.get<Model<EmailMessage>>(getModelToken(EmailMessage.name));

    // A branded agency on its own host: the case every link must land on.
    const agency = await agencies.create({
      name: 'Texas Holdings LLC',
      slug: 'texas-holdings',
      branding: { displayName: 'Texas Holdings', logoKey: 'agencies/x/logo' },
    });
    agencyId = agency._id;
    await domains.create({
      agencyId,
      hostname: TENANT_HOST,
      kind: 'custom',
      status: 'active',
      isPrimary: true,
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
    transport.sent.length = 0;
    transport.failWith = null;
    await Promise.all([
      notifications.deleteMany({}),
      users.deleteMany({}),
      messages.deleteMany({}),
    ]);
  });

  /**
   * A recipient and a stored, unread row addressed to them. By default both
   * belong to the branded agency; `userAgencyId: null` makes the recipient a
   * platform admin while the row keeps the agency.
   */
  async function seed(
    overrides: {
      agencyId?: Types.ObjectId | null;
      userAgencyId?: Types.ObjectId | null;
      user?: Partial<User>;
    } = {},
  ) {
    const rowAgencyId =
      overrides.agencyId === undefined ? agencyId : overrides.agencyId;
    const userAgencyId =
      overrides.userAgencyId === undefined
        ? rowAgencyId
        : overrides.userAgencyId;
    const user = await users.create({
      email: 'pat@example.com',
      passwordHash: 'x',
      firstName: 'Pat',
      lastName: 'Producer',
      ...(userAgencyId
        ? { agencyId: userAgencyId }
        : { isPlatformAdmin: true }),
      ...overrides.user,
    });
    const row = await notifications.create({
      recipientId: user._id,
      agencyId: rowAgencyId,
      type: 'bug_report.filed',
      title: 'New bug report',
      body: 'Dana Owner: The leaderboard still shows last month',
      href: '/admin/bugs',
      entity: { kind: 'bugReport', id: '507f1f77bcf86cd799439031' },
      actorId: null,
      data: {},
      readAt: null,
      dedupeKey: `bug_report.filed:${new Types.ObjectId().toHexString()}`,
    });
    return { user, row };
  }

  function emailEvent(
    row: { _id: Types.ObjectId; recipientId: Types.ObjectId },
    rowAgencyId: Types.ObjectId | null,
    overrides: Partial<NotificationEmailRequestedData> = {},
  ): { id: string; name: string; data: NotificationEmailRequestedData } {
    return {
      id: '01NOTIFMAIL',
      name: 'notification/email.requested.v1',
      data: {
        eventLogId: '507f1f77bcf86cd799439010',
        notificationId: row._id.toHexString(),
        recipientId: row.recipientId.toHexString(),
        agencyId: rowAgencyId ? rowAgencyId.toHexString() : null,
        ...overrides,
      },
    };
  }

  it('mails the stored row with every link on the tenant host', async () => {
    const { row } = await seed();
    const { step, ran } = inlineStep();

    const result = await fn.handle(emailEvent(row, agencyId), step);

    expect(result.sent).toBe(true);
    expect(ran).toEqual(['load', 'send', 'record']);
    expect(transport.sent).toHaveLength(1);

    const { message } = transport.sent[0];
    expect(message.to).toBe('pat@example.com');
    // The subject is the row's title, so the inbox and the bell agree.
    expect(message.subject).toBe('New bug report');
    expect(message.text).toContain(
      'Dana Owner: The leaderboard still shows last month',
    );

    // The load-bearing assertions. The row stores `/admin/bugs`; the mail
    // must carry it on the agency's own host in both parts, and the logo
    // must be absolute on the same host. `APP_BASE_URL` is `localhost:5173`
    // in the suite, and it must appear nowhere.
    const link = `${TENANT_ORIGIN}/admin/bugs`;
    expect(message.text).toContain(link);
    expect(message.html).toContain(`href="${link}"`);
    expect(message.html).toMatch(
      new RegExp(`src="${TENANT_ORIGIN}/api/v1/public/tenant/logo\\?`),
    );
    expect(message.html).toContain('alt="Texas Holdings"');
    expect(message.html).not.toContain('localhost');
    expect(message.text).not.toContain('localhost');
  });

  it('records the delivery on both the emailMessages row and the notification', async () => {
    const { row } = await seed();

    const result = await fn.handle(
      emailEvent(row, agencyId),
      inlineStep().step,
    );

    const message = (await messages.findOne({}).lean()) as EmailMessageDocument;
    expect(message).toMatchObject({
      agencyId: agencyId.toHexString(),
      branchId: null,
      eventId: '01NOTIFMAIL',
      eventType: 'notification/email.requested.v1',
      templateKey: 'notification',
      to: 'pat@example.com',
      status: 'sent',
      providerMessageId: 'capture-1',
    });

    const stored = await notifications.findById(row._id).lean();
    expect(stored?.delivery.email).toMatchObject({
      status: 'sent',
      error: null,
      emailMessageId: message._id.toHexString(),
    });
    expect(stored?.delivery.email?.at).toBeInstanceOf(Date);
    expect(result.emailMessageId).toBe(message._id.toHexString());
    // The email channel never touches the in-app state.
    expect(stored?.readAt).toBeNull();
    expect(stored?.delivery.push).toBeNull();
  });

  it('lands a platform notification on the platform host under the platform brand', async () => {
    const { row } = await seed({ agencyId: null });

    await fn.handle(emailEvent(row, null), inlineStep().step);

    const { message } = transport.sent[0];
    expect(message.text).toContain(`${PLATFORM_ORIGIN}/admin/bugs`);
    expect(message.html).toContain('<title>AgencyOps</title>');
    expect(message.html).not.toContain('<img');

    const stored = (await messages.findOne({}).lean()) as EmailMessageDocument;
    expect(stored.agencyId).toBeNull();
  });

  it("links on the recipient's host, branded for the row's agency", async () => {
    // A platform admin notified about an agency-scoped row. The link has to
    // land where *they* can sign in — `HostTenantGuard` refuses their session
    // on the agency host — while the masthead is still the agency's, on the
    // agency's own host, because that is where its logo is served.
    const { row } = await seed({ userAgencyId: null });

    await fn.handle(emailEvent(row, agencyId), inlineStep().step);

    const { message } = transport.sent[0];
    expect(message.text).toContain(`${PLATFORM_ORIGIN}/admin/bugs`);
    expect(message.text).not.toContain(TENANT_HOST);
    expect(message.html).toContain(`href="${PLATFORM_ORIGIN}/admin/bugs"`);
    expect(message.html).toMatch(
      new RegExp(`src="${TENANT_ORIGIN}/api/v1/public/tenant/logo\\?`),
    );
    expect(message.html).toContain('alt="Texas Holdings"');
  });

  it('carries the agency name but no logo when the agency has no host of its own', async () => {
    // An agency that uploaded a logo but has not verified a domain is served
    // on the platform host, where the logo endpoint 404s. A URL built there
    // is a broken image; name-only is the honest brand.
    const domainless = await agencies.create({
      name: 'No Domain Co',
      slug: 'no-domain-co',
      branding: { logoKey: 'agencies/y/logo' },
    });
    const { row } = await seed({ agencyId: domainless._id });

    await fn.handle(emailEvent(row, domainless._id), inlineStep().step);

    const { message } = transport.sent[0];
    expect(message.text).toContain(`${PLATFORM_ORIGIN}/admin/bugs`);
    expect(message.html).toContain('<title>No Domain Co</title>');
    expect(message.html).not.toContain('<img');
  });

  it('refuses, without retry, an event that disagrees with the row about who is mailed', async () => {
    const { row } = await seed();
    const stranger = new Types.ObjectId().toHexString();
    const { step, ran } = inlineStep();

    await expect(
      fn.handle(emailEvent(row, agencyId, { recipientId: stranger }), step),
    ).rejects.toBeInstanceOf(NonRetriableError);

    expect(ran).toEqual(['load']);
    expect(transport.sent).toHaveLength(0);
    const stored = await notifications.findById(row._id).lean();
    expect(stored?.delivery.email).toBeNull();
  });

  it('keys the provider on the notification id', async () => {
    const { row } = await seed();
    await fn.handle(emailEvent(row, agencyId), inlineStep().step);

    // Matches the function's `idempotency: 'event.data.notificationId'`, so
    // the two layers dedupe on the same thing.
    expect(transport.sent[0].idempotencyKey).toBe(
      `notification:${row._id.toHexString()}`,
    );
  });

  it('does not re-send a row that was already mailed', async () => {
    // Inngest's idempotency is 24-hour scoped; the row's own status is what
    // holds past it (a sweeper replaying an old event, a re-run by hand).
    const { row } = await seed();
    await fn.handle(emailEvent(row, agencyId), inlineStep().step);

    const { step, ran } = inlineStep();
    const second = await fn.handle(emailEvent(row, agencyId), step);

    expect(second).toEqual({ sent: false, reason: 'already-sent' });
    expect(ran).toEqual(['load']);
    expect(transport.sent).toHaveLength(1);
    await expect(messages.countDocuments({})).resolves.toBe(1);
  });

  it('records a failed send on the row, leaves the rest alone, and rethrows', async () => {
    const { row } = await seed();
    const before = await notifications.findById(row._id).lean();
    transport.failWith = new Error('provider exploded');
    const { step, ran } = inlineStep();

    await expect(fn.handle(emailEvent(row, agencyId), step)).rejects.toThrow(
      'provider exploded',
    );

    // The throw is what makes Inngest retry; the record step must not run.
    expect(ran).toEqual(['load', 'send']);
    await expect(messages.countDocuments({})).resolves.toBe(0);

    const after = await notifications.findById(row._id).lean();
    expect(after?.delivery.email).toMatchObject({
      status: 'failed',
      error: 'provider exploded',
      emailMessageId: null,
    });
    // PAC-148 FR-H4: a failed channel never touches the in-app row.
    const untouched = (row: typeof after) => {
      const { delivery, updatedAt, ...rest } = row!;
      void delivery;
      void updatedAt;
      return rest;
    };
    expect(untouched(after)).toEqual(untouched(before));
  });

  it('skips, and says so on the row, when the recipient is deactivated', async () => {
    const { row } = await seed({ user: { isActive: false } });

    const result = await fn.handle(
      emailEvent(row, agencyId),
      inlineStep().step,
    );

    expect(result).toEqual({
      sent: false,
      reason: 'recipient is deactivated',
    });
    expect(transport.sent).toHaveLength(0);
    const stored = await notifications.findById(row._id).lean();
    expect(stored?.delivery.email).toMatchObject({
      status: 'skipped',
      error: 'recipient is deactivated',
    });
  });

  it('skips, with its own reason, when the recipient has no email address', async () => {
    const { row, user } = await seed();
    // Past the schema's `required`: the record exists, the address does not.
    await users.updateOne({ _id: user._id }, { $unset: { email: 1 } });

    const result = await fn.handle(
      emailEvent(row, agencyId),
      inlineStep().step,
    );

    expect(result).toEqual({
      sent: false,
      reason: 'recipient has no email address',
    });
    expect(transport.sent).toHaveLength(0);
    const stored = await notifications.findById(row._id).lean();
    expect(stored?.delivery.email?.error).toBe(
      'recipient has no email address',
    );
  });

  it('is a no-op for a row that no longer exists', async () => {
    const { row } = await seed();
    await notifications.deleteOne({ _id: row._id });

    const result = await fn.handle(
      emailEvent(row, agencyId),
      inlineStep().step,
    );

    expect(result).toEqual({ sent: false, reason: 'missing' });
    expect(transport.sent).toHaveLength(0);
  });
});
