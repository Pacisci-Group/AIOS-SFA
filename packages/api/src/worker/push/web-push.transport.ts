import * as webpush from 'web-push';

/** The subscription as the push service wants it — endpoint plus the two keys. */
export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Delivery hints forwarded to the push service, nothing more. */
export interface PushSendOptions {
  /** Seconds the push service keeps the message for an offline device. */
  TTL: number;
  urgency: 'very-low' | 'low' | 'normal' | 'high';
  /** Coalescing key: a newer message with the same topic replaces an undelivered one. */
  topic?: string;
}

/**
 * The provider boundary for web push — the same shape as `MailTransport`, for
 * the same reason: the worker e2e swaps in a capture, and nothing but this
 * file imports `web-push`.
 *
 * ## Failure contract
 * A failed send **throws**; the service decides what each failure means. A
 * `WebPushError` with status `404` or `410` is the push service saying the
 * subscription is gone (`WebPushService` soft-deletes it); anything else is a
 * failure recorded on the row.
 *
 * ## Unconfigured is a state, not an error
 * {@link enabled} is `false` when the VAPID keys are not set. The service then
 * records `skipped` without reading a single subscription — the switch in the
 * web app hides itself in that environment too (`/public/push/vapid-public-key`
 * answers 404), so no row ever reaches here in practice.
 */
export abstract class WebPushTransport {
  abstract readonly enabled: boolean;

  abstract send(
    target: PushTarget,
    payload: string,
    options: PushSendOptions,
  ): Promise<void>;
}

/** The real thing: `web-push` with the VAPID details set once at construction. */
export class WebPushLibTransport extends WebPushTransport {
  readonly enabled = true;

  constructor(details: {
    subject: string;
    publicKey: string;
    privateKey: string;
  }) {
    super();
    webpush.setVapidDetails(
      details.subject,
      details.publicKey,
      details.privateKey,
    );
  }

  async send(
    target: PushTarget,
    payload: string,
    options: PushSendOptions,
  ): Promise<void> {
    await webpush.sendNotification(target, payload, {
      TTL: options.TTL,
      urgency: options.urgency,
      topic: options.topic,
      // A push service that hangs must not hold the worker's concurrency slot.
      timeout: 10_000,
    });
  }
}

/** What the worker runs with when the VAPID keys are not configured. */
export class DisabledWebPushTransport extends WebPushTransport {
  readonly enabled = false;

  send(): Promise<void> {
    return Promise.reject(
      new Error('Web push is not configured (VAPID keys unset)'),
    );
  }
}
