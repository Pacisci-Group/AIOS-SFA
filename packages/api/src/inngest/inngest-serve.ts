import { Logger, type INestApplication } from '@nestjs/common';
import { serve } from 'inngest/express';
import { INNGEST_CLIENT, type InngestClient } from './inngest.client';
import { InngestRegistry } from './inngest-registry.service';

/** Where Inngest invokes our functions. Referenced by `INNGEST_URLS`. */
export const INNGEST_SERVE_PATH = '/api/inngest';

/**
 * Mount the Inngest serve handler.
 *
 * Shared by both entrypoints (`main.ts` when the worker runs inline,
 * `worker.ts` when it runs standalone) so the two cannot drift on path,
 * client, or function list.
 *
 * ## Two things about this endpoint that surprise people
 *
 * 1. **It is outside Nest.** `serve()` returns raw Express middleware, mounted
 *    with `app.use()`, so it never passes through Nest's router. The seven
 *    global guards, the global `ValidationPipe`, and `setGlobalPrefix('api/v1')`
 *    all miss it. The path really is `/api/inngest`, not `/api/v1/api/inngest`,
 *    and it cannot collide with any `/api/v1/*` route.
 *
 * 2. **It authenticates itself.** Because the guards don't see it, its only
 *    protection is Inngest's request signing, verified by the SDK using
 *    `INNGEST_SIGNING_KEY`. That is the designed security model, but it means an
 *    unset signing key in production leaves the endpoint unauthenticated — which
 *    is why the key is in the deploy preflight, and why the droplet firewall
 *    only admits the Inngest host.
 *
 * 3. **Deployed, it streams.** The deploy writes `INNGEST_STREAMING=true`
 *    (PAC-172), which the SDK reads itself: every step response is answered
 *    201 at once and kept open with a whitespace heartbeat every three seconds
 *    until the step's result is written. That is for the weekly database
 *    snapshot, whose one step runs for minutes, behind the internal load
 *    balancer that fronts the pool's workers — an idle connection there would
 *    be cut, and Inngest would retry a step that was still running.
 *
 *    It is an environment variable rather than `streaming: true` here on
 *    purpose: the option changes how *every* function's response is delivered,
 *    and the SDK lets the code value override the environment. Left to the
 *    environment, it can be switched off (the `INNGEST_STREAMING` GitHub
 *    variable) without a code change if the self-hosted server ever disagrees
 *    with it. Unset — local dev, the test suites — the SDK does not stream.
 */
export function mountInngest(app: INestApplication): void {
  const logger = new Logger('InngestServe');
  const client = app.get<InngestClient>(INNGEST_CLIENT);
  const functions = app.get(InngestRegistry).all();

  app.use(INNGEST_SERVE_PATH, serve({ client, functions }));
  logger.log(
    `Serving ${functions.length} Inngest function(s) at ${INNGEST_SERVE_PATH}`,
  );
}
