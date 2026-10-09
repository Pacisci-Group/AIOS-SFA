import { Logger, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import {
  AllowlistedMailTransport,
  parseRecipientAllowlist,
} from './allowlisted.transport';
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
 *
 * ## And the opposite guard outside production
 *
 * A live key in a developer's `.env` is the mirror-image failure: the stack
 * boots, a Bruno run files a bug report, and two real platform admins get a
 * real email about a test database (PAC-154 PR3 review). So when `NODE_ENV`
 * is not `production`, Resend is wrapped in {@link AllowlistedMailTransport}
 * and only reaches the addresses or domains in `MAIL_DEV_ALLOWED_RECIPIENTS`;
 * with a key and no allowlist, nothing is sent at all and the error says why.
 * The deploy sets `NODE_ENV=production`, so this never applies there.
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

    const resend = new ResendTransport(new Resend(apiKey));
    if (config.get<string>('NODE_ENV') === 'production') {
      logger.log('Using Resend for outbound email.');
      return resend;
    }

    const allowed = parseRecipientAllowlist(
      config.get<string>('MAIL_DEV_ALLOWED_RECIPIENTS'),
    );
    if (allowed.length === 0) {
      logger.error(
        'RESEND_API_KEY is set but NODE_ENV is not production and ' +
          'MAIL_DEV_ALLOWED_RECIPIENTS is empty — refusing to send real email. ' +
          'Every message is logged instead. List the addresses or @domains ' +
          'that may receive mail from this machine, or unset the key.',
      );
      return new LoggingMailTransport();
    }

    logger.log(
      `Using Resend for outbound email to ${allowed.join(', ')} only; ` +
        'anything else is logged (MAIL_DEV_ALLOWED_RECIPIENTS).',
    );
    return new AllowlistedMailTransport(
      resend,
      new LoggingMailTransport(),
      allowed,
    );
  },
};
