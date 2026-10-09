import { NOTIFICATION_TYPE_KEYS } from '@sfa/shared';
import { eventType } from 'inngest';
import { z } from 'zod';
import { eventEnvelope, objectId } from './envelope';

/**
 * Event contract for notifications (PAC-154).
 *
 * The one way anything — an API feature service or another worker function —
 * asks for someone to be told something. `deliver-notification.fn.ts` is the
 * **sole writer** of the `notifications` collection: it renders the text from
 * `type` + `data`, inserts one row per recipient, and fans out to every other
 * channel. Nothing inserts a notification row directly (ticket decision 1).
 *
 * Same two rules as `email.events.ts`: no transforms, and ids plus display
 * fields only. `data` is where the display fields go — it is what the shared
 * `renderNotification` reads, so the worker needs no feature model to render
 * and the browser could render the same inputs later.
 */
const notificationRequestedSchema = z.object({
  ...eventEnvelope,
  /** A key of the shared `NOTIFICATION_TYPES` catalog. */
  type: z.enum(NOTIFICATION_TYPE_KEYS),
  /** One row is written per id. Duplicates are collapsed by the worker. */
  recipientIds: z.array(objectId).min(1),
  /** Context for the recipient's row; null for a platform-level notification. */
  agencyId: objectId.nullable(),
  /** Who caused it. Null means the system did. */
  actorId: objectId.nullable(),
  /** What it is about — for deep-linking and later collapsing. */
  entity: z.object({ kind: z.string().min(1), id: z.string().min(1) }),
  /** The per-type display payload the renderer reads. Never a document. */
  data: z.record(z.string(), z.unknown()),
  /**
   * The function's idempotency key **and** the durable one.
   *
   * Inngest collapses duplicate events on it for 24 hours; the unique
   * `{ recipientId, dedupeKey }` index on `notifications` does so forever. It
   * must therefore be **stable per business fact** — `<type>:<entityId>` or
   * `<type>:<entityId>:<qualifier>` (`timeoff.overdue:<id>:day1`) — never a
   * fresh value per attempt, or a retried producer double-notifies.
   */
  dedupeKey: z.string().min(1).max(256),
});

export const notificationRequested = eventType('notification/requested.v1', {
  schema: notificationRequestedSchema,
});

export type NotificationRequestedData = z.infer<
  typeof notificationRequestedSchema
>;
