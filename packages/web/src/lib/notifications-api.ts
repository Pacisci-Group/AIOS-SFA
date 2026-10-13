import type {
  MarkAllNotificationsReadResponse,
  NotificationListResponse,
  NotificationRecord,
  UnreadCountResponse,
} from '@sfa/shared';
import { apiFetch } from '@/lib/api-client';

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
