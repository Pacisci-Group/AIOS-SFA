import { Inngest } from 'inngest';
import type { ConfigService } from '@nestjs/config';

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
 */
export function createInngestClient(config: ConfigService): Inngest.Any {
  const baseUrl = config.get<string>('INNGEST_BASE_URL');

  return new Inngest({
    id: INNGEST_APP_ID,
    eventKey: config.get<string>('INNGEST_EVENT_KEY'),
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
