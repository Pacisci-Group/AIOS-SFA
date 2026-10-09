import 'reflect-metadata';
import { SkipThrottle } from '@nestjs/throttler';
import { THROTTLER_SKIP } from '@nestjs/throttler/dist/throttler.constants';
import { THROTTLER_NAMES } from '../../config/rate-limit.config';
import { NotificationsController } from '../../notifications/notifications.controller';
import { AcmeChallengeController } from '../../tls/acme-challenge.controller';
import { SkipAllThrottlers } from './throttle.decorators';

/**
 * What `ThrottlerGuard` reads for one named throttler: it looks up
 * `THROTTLER_SKIP + name` on the handler (then the class) and skips only when
 * that is truthy. Mirrors `throttler.guard.js` in `@nestjs/throttler` 6.x.
 */
function skipsFor(target: object, name: string): unknown {
  return Reflect.getMetadata(THROTTLER_SKIP + name, target);
}

/** The handler function the guard sees as `context.getHandler()`. */
function handlerOf(prototype: object, method: string): object {
  const descriptor = Object.getOwnPropertyDescriptor(prototype, method);
  if (!descriptor || typeof descriptor.value !== 'function') {
    throw new Error(`No method ${method} on the prototype.`);
  }
  return descriptor.value as object;
}

describe('SkipAllThrottlers', () => {
  it('marks every named throttler as skipped on a handler', () => {
    class Fixture {
      @SkipAllThrottlers()
      handler(): void {}
    }
    const handler = handlerOf(Fixture.prototype, 'handler');

    for (const name of THROTTLER_NAMES) {
      expect(skipsFor(handler, name)).toBe(true);
    }
  });

  it('marks every named throttler as skipped on a class', () => {
    @SkipAllThrottlers()
    class Fixture {}

    for (const name of THROTTLER_NAMES) {
      expect(skipsFor(Fixture, name)).toBe(true);
    }
  });

  // The trap this decorator exists for. If the library ever changes the bare
  // form to mean "every throttler", this test starts failing and the wrapper
  // can go.
  it('documents that the bare @SkipThrottle() skips none of our throttlers', () => {
    class Fixture {
      @SkipThrottle()
      handler(): void {}
    }
    const handler = handlerOf(Fixture.prototype, 'handler');

    for (const name of THROTTLER_NAMES) {
      expect(skipsFor(handler, name)).toBeUndefined();
    }
    expect(skipsFor(handler, 'default')).toBe(true);
  });

  // The two routes whose correctness depends on actually being exempt. A
  // revert to the bare decorator on either is a silent regression at runtime;
  // here it is a red test.
  it.each([
    [
      'GET /notifications/stream',
      handlerOf(NotificationsController.prototype, 'stream'),
    ],
    [
      'GET /.well-known/acme-challenge/:token',
      handlerOf(AcmeChallengeController.prototype, 'respond'),
    ],
  ])('%s is exempt from every named throttler', (_route, handler) => {
    for (const name of THROTTLER_NAMES) {
      expect(skipsFor(handler, name)).toBe(true);
    }
  });
});
