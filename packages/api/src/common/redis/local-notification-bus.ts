import { EventEmitter } from 'events';
import { NotificationBus, NotificationNudge } from './notification-bus';

const EVENT = 'nudge';

/**
 * The in-process bus, used when `REDIS_URL` is unset.
 *
 * Correct wherever the writer and the sockets share one Nest graph: the
 * `api:dev` loop (`WORKER_INLINE` defaults to true) and every e2e suite.
 * A deployed tier with a separate worker container gets nothing from it —
 * the nudge is emitted in the worker process and nobody there is listening —
 * which is why production without Redis is logged as an error at boot.
 */
export class LocalNotificationBus extends NotificationBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    super();
    // One listener per open stream registry, which is one per process — but a
    // test that builds several apps in one process would trip the default
    // warning threshold of 10 for no good reason.
    this.emitter.setMaxListeners(0);
  }

  publish(nudge: NotificationNudge): Promise<void> {
    this.emitter.emit(EVENT, nudge);
    return Promise.resolve();
  }

  subscribe(handler: (nudge: NotificationNudge) => void): () => void {
    this.emitter.on(EVENT, handler);
    return () => {
      this.emitter.off(EVENT, handler);
    };
  }
}
