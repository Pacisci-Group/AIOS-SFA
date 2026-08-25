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
 * ## Only ever selected when `RESEND_API_KEY` is unset
 * And the provider that selects it logs an error, not a debug line, when that
 * happens outside development. Silently not sending is the worst failure mode
 * this subsystem has: the app boots, health checks pass, runs complete
 * successfully, and no email arrives. See `mail-transport.provider.ts`.
 */
@Injectable()
export class LoggingMailTransport extends MailTransport {
  private readonly logger = new Logger(LoggingMailTransport.name);

  send(message: OutboundMessage, idempotencyKey: string): Promise<SendResult> {
    this.logger.log(
      [
        `[MAIL NOT SENT — no RESEND_API_KEY] to=${message.to} subject="${message.subject}"`,
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
