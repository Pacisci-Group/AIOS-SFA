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

/**
 * "Email this stored notification" (PAC-154, PR3).
 *
 * Emitted by `deliver-notification.fn.ts`'s `email` step for every inserted
 * row whose catalog type has the email channel on by default, and consumed by
 * `send-notification-email.fn.ts`. Ids only: the mail renders from the
 * **stored row** — the same words the in-app list shows — so the two cannot
 * drift, and a replayed event re-reads rather than re-renders.
 *
 * `notificationId` is the consumer's idempotency key, so one row is mailed at
 * most once in 24 hours whatever happens to this event; the row's own
 * `delivery.email` is the durable guard past that window.
 */
const notificationEmailRequestedSchema = z.object({
  ...eventEnvelope,
  /** The `notifications` row to mail. */
  notificationId: objectId,
  /** The row's recipient — the `User` whose address and name the mail uses. */
  recipientId: objectId,
  /** The row's context agency: the brand and the host its link lands on. */
  agencyId: objectId.nullable(),
});

export const notificationEmailRequested = eventType(
  'notification/email.requested.v1',
  { schema: notificationEmailRequestedSchema },
);

export type NotificationEmailRequestedData = z.infer<
  typeof notificationEmailRequestedSchema
>;
