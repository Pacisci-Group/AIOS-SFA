/**
 * What the worker tells the API tier after it writes a notification row
 * (PAC-154, decision 2): *who* it is for and *which* row — never the row
 * itself. Every API node re-reads the row before writing an SSE frame, so
 * push, email, in-app and the stream all render from the one stored text.
 */
export interface NotificationNudge {
  recipientId: string;
  notificationId: string;
}

/**
 * The fan-out seam between the writer and whichever API node holds the
 * recipient's socket.
 *
 * ## Lossy by contract
 *
 * A nudge that is not delivered is not an error. The Mongo row is the truth;
 * the client refetches the count and the list every time its stream (re)opens,
 * which is what makes a fire-and-forget bus acceptable. Implementations log
 * and swallow transport failures for that reason — a `publish()` that throws
 * would fail the worker's step and retry a write that already happened.
 *
 * ## Two implementations, picked by `REDIS_URL`
 *
 * {@link RedisNotificationBus} when it is set: PUBLISH on one channel, every
 * API node subscribed, so the writer and the socket can be different
 * processes. {@link LocalNotificationBus} when it is not: an in-process
 * `EventEmitter`, which is exactly right for `api:dev` (the worker runs inline)
 * and for e2e — and exactly wrong for a deployed multi-node tier, which is why
 * `redis.provider.ts` logs an error in production when the URL is missing.
 */
export abstract class NotificationBus {
  abstract publish(nudge: NotificationNudge): Promise<void>;

  /**
   * Register a listener for every nudge, from every process. Returns the
   * function that removes it. Only the API tier subscribes; the worker only
   * publishes.
   */
  abstract subscribe(handler: (nudge: NotificationNudge) => void): () => void;
}

/** Narrow a parsed JSON value to a nudge; anything else is dropped silently. */
export function isNotificationNudge(
  value: unknown,
): value is NotificationNudge {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.recipientId === 'string' &&
    candidate.recipientId.length > 0 &&
    typeof candidate.notificationId === 'string' &&
    candidate.notificationId.length > 0
  );
}
