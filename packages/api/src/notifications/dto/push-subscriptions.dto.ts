import { z } from 'zod';
import { isAllowedPushEndpoint } from '../../common/push/push-endpoint';

/**
 * A push-service endpoint: `https:`, **on a known browser push service**.
 *
 * The worker POSTs a VAPID-signed body to this URL for every notification the
 * subscriber receives, so the host is a trust boundary: `https://` alone would
 * let any signed-in user point the worker at an internal service from inside
 * our network (PR4 review: SSRF). The allowlist lives in
 * `common/push/push-endpoint.ts` and `WebPushService` re-checks it before
 * every send, so a row that predates a tightening is covered too. Long: FCM
 * endpoints run past 200 chars.
 */
const endpointSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .url()
  .refine(isAllowedPushEndpoint, {
    message: 'endpoint must be an https URL on a known browser push service',
  });

/**
 * `PUT /notifications/push-subscriptions` — the body is `PushSubscription.toJSON()`
 * plus the user agent. `expirationTime` is accepted and dropped: the push
 * service says when a subscription is gone (410), and that is what the worker
 * acts on.
 */
export const pushSubscriptionSchema = z.object({
  endpoint: endpointSchema,
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    p256dh: z.string().trim().min(1).max(512),
    auth: z.string().trim().min(1).max(512),
  }),
  userAgent: z.string().trim().max(512).nullable().optional(),
});
export type PushSubscriptionDto = z.infer<typeof pushSubscriptionSchema>;

/**
 * `DELETE /notifications/push-subscriptions` — the endpoint travels in the
 * body, never the path: it is a URL with `/` and `%` in it, and nginx's
 * `proxy_pass` with a URI part re-normalises encoded slashes.
 */
export const removePushSubscriptionSchema = z.object({
  endpoint: endpointSchema,
});
export type RemovePushSubscriptionDto = z.infer<
  typeof removePushSubscriptionSchema
>;
