import { Inngest } from 'inngest';
import type { ConfigService } from '@nestjs/config';
import { createEventLogMiddleware } from './event-log/event-log.middleware';
import type { EventLogService } from './event-log/event-log.service';

/** Identifies this app to Inngest. Shows up as the app name in the dashboard. */
export const INNGEST_APP_ID = 'sfa';

/**
 * DI token for the client.
 *
 * A token rather than a class because the client is a third-party instance, not
 * something Nest can construct — the same reason `permission-cache.provider.ts`
 * uses a factory provider.
 */
export const INNGEST_CLIENT = Symbol('INNGEST_CLIENT');

/**
 * Build the Inngest client.
 *
 * ## Why this is a factory and not a module-level singleton
 * The obvious shape — `export const inngest = new Inngest({ ... process.env })`
 * — reads `process.env` **at import time**, which is before
 * `ConfigModule.forRoot()` has run dotenv. Every value from the repo `.env`
 * would silently be `undefined`, and the client would quietly fall back to dev
 * mode in production. That is the identical trap documented at length in
 * `config/rate-limit.config.ts`, and the reason those constants must be real
 * environment variables.
 *
 * Building through a provider sidesteps it: the factory runs during DI, after
 * config is loaded, so `INNGEST_*` can live in the repo `.env` like everything
 * else. Functions are built by {@link InngestRegistry} after the container is
 * up, so they get this same instance — `serve()` requires the client that
 * created the functions to be the one that serves them.
 *
 * ## Why `eventLog` is a parameter here
 * Middleware is registered on the client and constructed by Inngest itself, so
 * it has no constructor Nest can inject through. Threading the service in here —
 * where DI is already happening — lets `event-log.middleware.ts` close over a
 * real `@Injectable` instead of reaching for a module-level singleton.
 */
export function createInngestClient(
  config: ConfigService,
  eventLog: EventLogService,
): Inngest.Any {
  const baseUrl = config.get<string>('INNGEST_BASE_URL');

  return new Inngest({
    id: INNGEST_APP_ID,
    eventKey: config.get<string>('INNGEST_EVENT_KEY'),
    // Applies to every function this client runs, including ones not written
    // yet — which is the whole reason the outbox's terminal write lives in
    // middleware rather than in a per-function `onFailure`.
    middleware: [createEventLogMiddleware(eventLog)],
    // Point the SDK at our self-hosted server. Unset locally, where the SDK
    // discovers the dev server on its default port by itself.
    ...(baseUrl ? { baseUrl } : {}),
    // `INNGEST_DEV=0` is what tells the SDK it is talking to a real (self-hosted)
    // server rather than a dev server: it turns on signature verification and
    // stops it assuming localhost. Left undefined, the SDK infers from NODE_ENV,
    // which is not a signal we want this to hang off.
    ...(config.get<string>('INNGEST_DEV') === '0' ? { isDev: false } : {}),
  });
}

/**
 * The client type, for injection sites.
 *
 * `Inngest.Any` rather than a concrete generic instantiation: in SDK v4 an
 * event's payload type is inferred from the **trigger** (`eventType` instances
 * passed to `createFunction`), not from a schema registry on the client, so
 * nothing is lost by keeping the client itself loosely typed.
 */
export type InngestClient = Inngest.Any;
