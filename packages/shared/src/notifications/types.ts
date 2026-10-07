import type { NotificationType } from './catalog';

/**
 * The wire shapes of the notifications API (PAC-154).
 *
 * Named `NotificationRecord`, not `Notification`: the latter is a DOM global in
 * `packages/web` and in the service worker, and shadowing it is the kind of
 * mistake that compiles.
 */

/** What the notification is about, for deep-linking and later collapsing. */
export interface NotificationEntityRef {
  kind: string;
  id: string;
}

export interface NotificationRecord {
  id: string;
  type: NotificationType;
  /** Rendered at write time by `renderNotification`; never re-rendered. */
  title: string;
  body: string;
  /** App-relative path. Navigate to it; never prefix a host on the client. */
  href: string;
  entity: NotificationEntityRef;
  /** Null when the system, not a person, caused it. */
  actorId: string | null;
  /** Context, not tenancy: null for a platform recipient. */
  agencyId: string | null;
  /** The producer's per-type payload, versioned by `type`. */
  data: Record<string, unknown>;
  /** ISO instant, or null while unread. A date, not a boolean. */
  readAt: string | null;
  createdAt: string;
}

/**
 * `GET /notifications` — one page of the caller's notifications.
 *
 * Keyset-paged on `(createdAt, _id)` rather than offset-paged like the rest of
 * the API: new rows land at the top while the reader scrolls, and an offset
 * would skip or repeat across that insert. `nextCursor` is opaque; hand it back
 * untouched.
 */
export interface NotificationListResponse {
  items: NotificationRecord[];
  nextCursor: string | null;
}

export interface UnreadCountResponse {
  unread: number;
}

export interface MarkAllNotificationsReadResponse {
  /** How many rows went from unread to read in this call. */
  updated: number;
}

export const NOTIFICATION_LIST_DEFAULT_LIMIT = 20;
export const NOTIFICATION_LIST_MAX_LIMIT = 50;
