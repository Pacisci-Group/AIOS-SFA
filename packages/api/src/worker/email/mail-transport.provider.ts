import { Logger, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { LoggingMailTransport } from './logging.transport';
import { MailTransport } from './mail-transport';
import { ResendTransport } from './resend.transport';

/**
 * Picks the mail transport from configuration.
 *
 * Shaped after `permissions/cache/permission-cache.provider.ts` — same
 * "configured implementation, otherwise a no-op" factory — with one deliberate
 * difference in temperament that is worth stating explicitly, because the
 * similarity invites someone to "make them consistent":
 *
 * - The permission cache **fails open**. Losing it costs a database round-trip
 *   and nothing else, so a missing `REDIS_URL` is unremarkable.
 * - Mail **fails loud**. A missing `RESEND_API_KEY` means the app boots,
 *   health checks pass, Inngest runs complete successfully, and *no email is
 *   ever delivered*. That is precisely the silent-degradation failure the
 *   deploy workflow's preflight step already guards `STORAGE_ENDPOINT` against,
 *   which is why `RESEND_API_KEY` is in that same preflight list.
 *
 * Hence: outside development, an unset key is logged at `error`.
 */
export const mailTransportProvider: Provider = {
  provide: MailTransport,
  inject: [ConfigService],
  useFactory: (config: ConfigService): MailTransport => {
    const logger = new Logger('MailTransportProvider');
    const apiKey = config.get<string>('RESEND_API_KEY');

    if (!apiKey) {
      const message =
        'RESEND_API_KEY is not set — falling back to LoggingMailTransport. No email will be delivered.';
      if (config.get<string>('NODE_ENV') === 'production') {
        logger.error(message);
      } else {
        logger.warn(message);
      }
      return new LoggingMailTransport();
    }

    logger.log('Using Resend for outbound email.');
    return new ResendTransport(new Resend(apiKey));
  },
};
