import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash } from 'node:crypto';
import { Model, Types } from 'mongoose';
import { MailTransport, type SendResult } from './mail-transport';
import {
  EMAIL_TEMPLATES,
  type TemplateData,
  type TemplateKey,
} from './templates/registry';
import { EmailMessage, type EmailStatus } from './schemas/email-message.schema';
import { SenderIdentityService } from './sender-identity.service';

/** Everything needed to record a delivery against the run that produced it. */
export interface DeliveryContext {
  eventId: string;
  eventType: string;
  /**
   * `null` for platform mail — the mailer campaign completion notice (PAC-71)
   * belongs to no tenant. See `EmailMessage.agencyId`.
   */
  agencyId: string | null;
  branchId: string | null;
}

/** What a completed send hands to {@link MailDeliveryService.record}. */
export interface SentEmail extends SendResult {
  templateKey: TemplateKey;
  /** The provider idempotency key — `record`'s upsert key (PAC-157). */
  idempotencyKey: string;
  to: string;
  from: string;
  replyTo: string;
  subject: string;
  bodyHash: string;
}

@Injectable()
export class MailDeliveryService {
  private readonly logger = new Logger(MailDeliveryService.name);

  constructor(
    private readonly transport: MailTransport,
    private readonly sender: SenderIdentityService,
    @InjectModel(EmailMessage.name)
    private readonly messages: Model<EmailMessage>,
  ) {}

  /**
   * Render a template and hand it to the provider.
   *
   * Split from {@link record} so each is its own `step.run()` in the calling
   * function. That split is what makes a retry safe: once the send step has
   * succeeded Inngest replays its memoized result rather than re-running it, so
   * a crash between sending and recording costs a re-recorded row, never a
   * second email.
   *
   * Throws on failure — see {@link MailTransport}'s contract.
   */
  async send<K extends TemplateKey>(
    templateKey: K,
    data: TemplateData<K>,
    idempotencyKey: string,
    /**
     * Whose agency this is sent on behalf of, for the `From:` header.
     *
     * Passed explicitly rather than read off `data`, even though every payload
     * happens to carry an `agencyId` today: the sender is a *delivery* decision
     * and should not depend on a field a future template might not have.
     */
    agencyId?: string | null,
  ): Promise<SentEmail> {
    const template = EMAIL_TEMPLATES[templateKey] as {
      subject: (d: TemplateData<K>) => string;
      render: (d: TemplateData<K>) => { html: string; text: string };
    };

    const subject = template.subject(data);
    const { html, text } = template.render(data);
    const { from, replyTo } = await this.sender.resolve(agencyId);
    const to = (data as { to: string }).to;

    const result = await this.transport.send(
      { to, from, subject, html, text, ...(replyTo ? { replyTo } : {}) },
      idempotencyKey,
    );

    return {
      ...result,
      templateKey,
      idempotencyKey,
      to,
      from,
      replyTo,
      subject,
      bodyHash: createHash('sha256').update(text).digest('hex'),
    };
  }

  /**
   * Write the delivery record. Never throws in a way that un-sends anything.
   *
   * An **upsert on the idempotency key** (PAC-157): one mail, one row. A
   * `record` step that is retried — because the caller's own write after it
   * failed, or the process died between the two — finds the row it already
   * wrote instead of inserting a second one, and returns the same id. Only
   * `$setOnInsert`, so the first record wins and a replay never rewrites a
   * row a webhook may since have updated. The key is stored as a hash: for an
   * invite it is the bearer URL, which must never sit in this collection.
   *
   * Returns the row's id so a caller that keeps its own per-channel status —
   * `notifications.delivery.email.emailMessageId` (PAC-154) — can point at it.
   */
  async record(
    context: DeliveryContext,
    sent: SentEmail,
    status: EmailStatus = 'sent',
  ): Promise<{ emailMessageId: string }> {
    const idempotencyKeyHash = hashKey(sent.idempotencyKey);
    const row = await this.messages
      .findOneAndUpdate(
        { idempotencyKeyHash },
        {
          $setOnInsert: {
            idempotencyKeyHash,
            agencyId: context.agencyId,
            branchId: context.branchId,
            eventId: context.eventId,
            eventType: context.eventType,
            templateKey: sent.templateKey,
            to: sent.to,
            from: sent.from,
            replyTo: sent.replyTo,
            subject: sent.subject,
            status,
            providerMessageId: sent.providerMessageId,
            sentAt: new Date(),
            bodyHash: sent.bodyHash,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .lean<{ _id: Types.ObjectId }>();

    this.logger.log(
      `Recorded ${status} email template=${sent.templateKey} provider=${sent.providerMessageId}`,
    );
    return { emailMessageId: row._id.toHexString() };
  }

  /**
   * The row already recorded under this key, if any. For a caller that keeps
   * a durable "was this mailed?" guard of its own past Inngest's 24-hour
   * window: a mail whose `record` step never completed still has its row
   * here, and must not be sent again (PAC-157).
   */
  async findRecorded(
    idempotencyKey: string,
  ): Promise<{ emailMessageId: string } | null> {
    const row = await this.messages
      .findOne({ idempotencyKeyHash: hashKey(idempotencyKey) })
      .select({ _id: 1 })
      .lean<{ _id: Types.ObjectId }>();
    return row ? { emailMessageId: row._id.toHexString() } : null;
  }
}

/** The stored form of an idempotency key — see `EmailMessage.idempotencyKeyHash`. */
function hashKey(idempotencyKey: string): string {
  return createHash('sha256').update(idempotencyKey).digest('hex');
}
