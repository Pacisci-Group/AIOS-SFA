import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash } from 'node:crypto';
import { Model } from 'mongoose';
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
  agencyId: string;
  branchId: string | null;
}

/** What a completed send hands to {@link MailDeliveryService.record}. */
export interface SentEmail extends SendResult {
  templateKey: TemplateKey;
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
      to,
      from,
      replyTo,
      subject,
      bodyHash: createHash('sha256').update(text).digest('hex'),
    };
  }

  /** Write the delivery record. Never throws in a way that un-sends anything. */
  async record(
    context: DeliveryContext,
    sent: SentEmail,
    status: EmailStatus = 'sent',
  ): Promise<void> {
    await this.messages.create({
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
    });

    this.logger.log(
      `Recorded ${status} email template=${sent.templateKey} provider=${sent.providerMessageId}`,
    );
  }
}
