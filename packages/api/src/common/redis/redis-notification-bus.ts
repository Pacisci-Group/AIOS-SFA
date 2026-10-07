import { Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import {
  isNotificationNudge,
  NotificationBus,
  NotificationNudge,
} from './notification-bus';

/**
 * The one pub/sub channel. Versioned in the name so a change to the payload
 * shape can run a new channel beside the old one during a rolling deploy
 * rather than having half the nodes drop frames they cannot parse.
 */
export const NOTIFICATION_CHANNEL = 'sfa:notify:v1';

/**
 * Redis pub/sub fan-out (PAC-154, decision 2). Redis stores nothing: a
 * PUBLISH reaches whichever nodes are subscribed at that instant, and a node
 * that is between reconnects misses it. That is the contract — see
 * {@link NotificationBus}.
 *
 * ## Two connections, not one
 *
 * An ioredis connection in subscriber mode can issue no other command, so the
 * subscriber is `client.duplicate()`, opened lazily by the first `subscribe()`.
 * The worker only ever publishes and therefore never opens one. `duplicate()`
 * inherits the reconnect policy and ioredis re-issues SUBSCRIBE on reconnect,
 * so a Redis restart costs a gap in delivery and nothing else.
 */
export class RedisNotificationBus extends NotificationBus {
  private readonly logger = new Logger(RedisNotificationBus.name);
  private readonly handlers = new Set<(nudge: NotificationNudge) => void>();
  private subscriber: Redis | null = null;

  constructor(private readonly client: Redis) {
    super();
  }

  async publish(nudge: NotificationNudge): Promise<void> {
    try {
      await this.client.publish(NOTIFICATION_CHANNEL, JSON.stringify(nudge));
    } catch (err) {
      // Lossy by contract: the row exists, the client refetches on reconnect.
      // Throwing here would fail the worker step and retry a finished write.
      this.logger.warn(
        `PUBLISH failed for notification ${nudge.notificationId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  subscribe(handler: (nudge: NotificationNudge) => void): () => void {
    this.handlers.add(handler);
    this.ensureSubscriber();
    return () => {
      this.handlers.delete(handler);
    };
  }

  /** Close the subscriber connection. The publishing client is the module's. */
  async close(): Promise<void> {
    const subscriber = this.subscriber;
    this.subscriber = null;
    if (!subscriber) return;
    try {
      await subscriber.quit();
    } catch {
      subscriber.disconnect();
    }
  }

  private ensureSubscriber(): void {
    if (this.subscriber) return;
    const subscriber = this.client.duplicate();
    this.subscriber = subscriber;

    subscriber.on('message', (channel: string, message: string) => {
      if (channel !== NOTIFICATION_CHANNEL) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(message);
      } catch {
        this.logger.warn('Dropped an unparseable notification nudge.');
        return;
      }
      if (!isNotificationNudge(parsed)) return;
      for (const handler of this.handlers) {
        try {
          handler(parsed);
        } catch (err) {
          // One registry's bug must not stop the others from being told.
          this.logger.error(
            `Notification nudge handler threw: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
    });
    subscriber.on('error', (err: Error) => {
      // ioredis emits this on every failed reconnect attempt too. Logged, never
      // thrown — an unhandled 'error' event would take the process down.
      this.logger.warn(`Subscriber connection error: ${err.message}`);
    });

    subscriber.subscribe(NOTIFICATION_CHANNEL).catch((err: Error) => {
      this.logger.error(
        `SUBSCRIBE ${NOTIFICATION_CHANNEL} failed: ${err.message}`,
      );
    });
  }
}
