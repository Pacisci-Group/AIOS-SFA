import {
  NOTIFICATION_LIST_DEFAULT_LIMIT,
  NOTIFICATION_LIST_MAX_LIMIT,
} from '@sfa/shared';
import { z } from 'zod';

/**
 * `GET /notifications` — the caller's own notifications, keyset-paged.
 *
 * `cursor` is opaque to the client; its shape is validated by the service,
 * which is the only thing that knows it. `unread=1` narrows to unread rows —
 * the Unread tab. A `limit` above the shared maximum is a 400 rather than a
 * silent clamp, so a client that asks for 500 finds out.
 */
export const listNotificationsSchema = z.object({
  cursor: z.string().trim().min(1).max(256).optional(),
  unread: z
    .enum(['1', 'true', '0', 'false'])
    .optional()
    .transform((value) => value === '1' || value === 'true'),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(NOTIFICATION_LIST_MAX_LIMIT)
    .default(NOTIFICATION_LIST_DEFAULT_LIMIT),
});
export type ListNotificationsDto = z.infer<typeof listNotificationsSchema>;
