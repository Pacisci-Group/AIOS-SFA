import type {
  MarkAllNotificationsReadResponse,
  NotificationListResponse,
  NotificationRecord,
  PushSubscriptionInput,
  PushSubscriptionResponse,
  UnreadCountResponse,
  VapidPublicKeyResponse,
} from '@sfa/shared';
import { apiFetch, publicFetch } from '@/lib/api-client';

/**
 * The caller's own notification centre (PAC-154).
 *
 * Every call here is authenticated and needs **no permission** — a
 * notification is addressed to you. The rows are written by the worker; this
 * module only reads them and flips `readAt`.
 */

/** Root query key. Every notifications query sits under it, so one
 * `invalidateQueries({ queryKey: notificationsKey })` refreshes the lot. */
export const notificationsKey = ['notifications'] as const;

/** The page, also the sidebar entry — one constant so the badge finds its row. */
export const NOTIFICATIONS_PATH = '/notifications';

export interface ListNotificationsParams {
  /** The previous page's `nextCursor`; omit for the first page. */
  cursor?: string | null;
  /** Only unread rows (the Unread tab). */
  unread?: boolean;
  limit?: number;
}

export function listNotifications(
  params: ListNotificationsParams = {},
): Promise<NotificationListResponse> {
  const search = new URLSearchParams();
  if (params.cursor) search.set('cursor', params.cursor);
  if (params.unread) search.set('unread', '1');
  if (params.limit) search.set('limit', String(params.limit));
  const query = search.toString();
  return apiFetch<NotificationListResponse>(
    `/notifications${query ? `?${query}` : ''}`,
  );
}

export function getUnreadCount(): Promise<UnreadCountResponse> {
  return apiFetch<UnreadCountResponse>('/notifications/unread-count');
}

export function markNotificationRead(id: string): Promise<NotificationRecord> {
  return apiFetch<NotificationRecord>(`/notifications/${id}/read`, {
    method: 'PATCH',
  });
}

export function markAllNotificationsRead(): Promise<MarkAllNotificationsReadResponse> {
  return apiFetch<MarkAllNotificationsReadResponse>('/notifications/read-all', {
    method: 'POST',
  });
}

/**
 * Web push (PAC-154 PR4). The subscription is this browser's; the three
 * calls are what `features/notifications/push-subscription.ts` wraps.
 */

/** `@Public()` — read before any session; 404 when push is not configured. */
export function getVapidPublicKey(): Promise<VapidPublicKeyResponse> {
  return publicFetch<VapidPublicKeyResponse>('/public/push/vapid-public-key');
}

/** Upsert on `endpoint`; `200` both the first time and every time after. */
export function registerPushSubscription(
  input: PushSubscriptionInput,
): Promise<PushSubscriptionResponse> {
  return apiFetch<PushSubscriptionResponse>('/notifications/push-subscriptions', {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

/**
 * The endpoint goes in the **body**, never the path — it is a URL with `/`
 * and `%` in it, and nginx re-normalises encoded slashes on `proxy_pass`.
 */
export function removePushSubscription(endpoint: string): Promise<void> {
  return apiFetch<void>('/notifications/push-subscriptions', {
    method: 'DELETE',
    body: JSON.stringify({ endpoint }),
  });
}
