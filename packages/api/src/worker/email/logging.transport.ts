import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  MailTransport,
  type OutboundMessage,
  type SendResult,
} from './mail-transport';

/**
 * The no-provider fallback: logs what it would have sent.
 *
 * This preserves the exact behaviour `MailService` had before a real transport
 * existed, which is what keeps the local invite loop walkable — the accept-invite
 * URL comes out of the API console.
 *
 * ## Selected for two reasons, and the log line says which
 * Either `RESEND_API_KEY` is unset (the provider logs an error, not a debug
 * line, when that happens outside development), or — outside production — the
 * key *is* set and the recipient is not on `MAIL_DEV_ALLOWED_RECIPIENTS`, in
 * which case `AllowlistedMailTransport` routes the message here. The reason is
 * in the constructor so the console never claims "no RESEND_API_KEY" while a
 * key is configured (PR3 second review). Silently not sending is the worst
 * failure mode this subsystem has: the app boots, health checks pass, runs
 * complete successfully, and no email arrives. See `mail-transport.provider.ts`.
 *
 * ## What the record says
 * The delivery is recorded as `sent` with a `local-` provider id: the row's
 * shape stays identical to a real send, so nothing downstream needs a "was
 * this real?" branch, and the prefix is the tell in the database.
 */
@Injectable()
export class LoggingMailTransport extends MailTransport {
  private readonly logger = new Logger(LoggingMailTransport.name);

  constructor(private readonly reason: string = 'no RESEND_API_KEY') {
    super();
  }

  send(message: OutboundMessage, idempotencyKey: string): Promise<SendResult> {
    this.logger.log(
      [
        `[MAIL NOT SENT — ${this.reason}] to=${message.to} subject="${message.subject}"`,
        `idempotencyKey=${idempotencyKey}`,
        message.text,
      ].join('\n'),
    );

    // A synthetic id keeps the delivery record's shape identical to a real
    // send, so nothing downstream needs a "was this real?" branch. The `local-`
    // prefix makes it obvious in the database that no provider was involved.
    return Promise.resolve({ providerMessageId: `local-${randomUUID()}` });
  }
}
