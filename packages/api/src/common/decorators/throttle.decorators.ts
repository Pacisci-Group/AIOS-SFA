import { SkipThrottle } from '@nestjs/throttler';
import { THROTTLER_NAMES } from '../../config/rate-limit.config';

/**
 * Exempt a route (or a whole controller) from every global throttler.
 *
 * Exists because `@SkipThrottle()` with no argument does not do that here.
 * `@nestjs/throttler` stores skip metadata per throttler *name* and the guard
 * reads it per name; the bare decorator writes the key for `default`, while
 * `app.module.ts` registers `short` and `long`. The result is a route that
 * reads as exempt and is throttled exactly like its neighbours — a reconnect
 * wave on the SSE stream after a deploy would 429 the badge for everyone
 * behind one office NAT, which is the very thing the decorator was meant to
 * prevent. This wrapper names every throttler in {@link THROTTLER_NAMES}, so
 * adding a throttler there is the one change needed.
 *
 * Use it only where the decorator's docblock can say why the route is safe
 * without a limit: a stream that is one request held open, or a lookup whose
 * key is unguessable.
 */
export const SkipAllThrottlers = (): MethodDecorator & ClassDecorator =>
  SkipThrottle(Object.fromEntries(THROTTLER_NAMES.map((name) => [name, true])));
