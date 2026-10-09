import { Logger, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DisabledWebPushTransport,
  WebPushLibTransport,
  WebPushTransport,
} from './web-push.transport';

/**
 * Picks the push transport from configuration — the `mail-transport.provider.ts`
 * shape, with the same temperament: **fails loud**.
 *
 * All three of `VAPID_SUBJECT`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` set →
 * the real transport. Anything less → a disabled one, logged at `error`
 * outside development, because the failure is otherwise silent: the app
 * boots, the health check passes, every `deliver-notification` run completes
 * (the push step records `skipped`), and not one device is ever pushed to.
 * The deploy preflight requires all three for exactly that reason.
 *
 * Generate a pair once per environment with `npx web-push generate-vapid-keys`.
 * Rotating it invalidates every subscription — devices re-subscribe on their
 * next visit, because `pushManager.subscribe()` with a new key replaces the old
 * subscription — so it is a deliberate act, not a routine one.
 */
export const webPushTransportProvider: Provider = {
  provide: WebPushTransport,
  inject: [ConfigService],
  useFactory: (config: ConfigService): WebPushTransport => {
    const logger = new Logger('WebPushTransportProvider');
    const subject = config.get<string>('VAPID_SUBJECT');
    const publicKey = config.get<string>('VAPID_PUBLIC_KEY');
    const privateKey = config.get<string>('VAPID_PRIVATE_KEY');

    if (!subject || !publicKey || !privateKey) {
      const message =
        'VAPID_SUBJECT / VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY are not all set — web push is disabled. No device will be notified.';
      if (config.get<string>('NODE_ENV') === 'production') {
        logger.error(message);
      } else {
        logger.warn(message);
      }
      return new DisabledWebPushTransport();
    }

    try {
      const transport = new WebPushLibTransport({
        subject,
        publicKey,
        privateKey,
      });
      logger.log('Web push enabled (VAPID).');
      return transport;
    } catch (err) {
      // `setVapidDetails` validates the key lengths and the subject scheme. A
      // malformed key is a configuration error, so say so loudly rather than
      // crashing the worker — a crash-loop would also stop email and the
      // campaign jobs, which have nothing to do with push.
      logger.error(
        `VAPID configuration rejected — web push is disabled: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return new DisabledWebPushTransport();
    }
  },
};
