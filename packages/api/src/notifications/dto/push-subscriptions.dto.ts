import { z } from 'zod';

/**
 * A push-service endpoint. Always `https:` — every browser's push service is,
 * and the worker would otherwise be talked into POSTing an encrypted payload
 * at whatever host a client named. Long: FCM endpoints run past 200 chars.
 */
const endpointSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .url()
  .refine((value) => value.startsWith('https://'), {
    message: 'endpoint must be an https URL',
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
