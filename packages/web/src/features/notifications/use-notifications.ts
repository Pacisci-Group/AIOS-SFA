import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  getUnreadCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  notificationsKey,
} from '@/lib/notifications-api';
import { useNotificationStreamConnected } from './notification-stream-status';

/**
 * How often the badge re-asks the server while this tab has no live stream.
 *
 * The fallback, not the mechanism: with the SSE stream open (PR2) every event
 * invalidates these queries and polling slows to
 * {@link UNREAD_COUNT_CONNECTED_POLL_MS}. It comes back to this the moment
 * the stream drops, so a tab behind a proxy that cannot hold a stream open
 * still sees the badge move — just a minute late.
 */
export const UNREAD_COUNT_POLL_MS = 60_000;

/**
 * How often the badge re-asks the server while the stream *is* open.
 *
 * Slow, but never off. `ready` and `ping` come from the API node holding the
 * socket, so the stream looks healthy even when that node has lost its Redis
 * subscription or a PUBLISH was dropped — the row is written and nothing
 * tells this tab. Without a poll the badge would only move on window focus,
 * tab show or the token-expiry reconnect. This bounds the gap.
 */
export const UNREAD_COUNT_CONNECTED_POLL_MS = 5 * 60_000;

/**
 * One tab's worth of notifications, newest first, loading more by cursor.
 *
 * The first `useInfiniteQuery` in the app: every other list is offset-paged
 * with `TablePagination`, which would skip or repeat a row here whenever one
 * landed at the top mid-scroll. `nextCursor: null` is the end.
 */
export function useNotificationsList(unread: boolean) {
  return useInfiniteQuery({
    queryKey: [...notificationsKey, 'list', { unread }],
    queryFn: ({ pageParam }) => listNotifications({ cursor: pageParam, unread }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
}

/**
 * The badge's number. A query, never a counter: on any change the client
 * re-fetches this rather than incrementing locally, because multi-tab,
 * mark-read elsewhere and reconnect gaps all drift.
 */
export function useUnreadCount(enabled = true) {
  const connected = useNotificationStreamConnected();
  return useQuery({
    queryKey: [...notificationsKey, 'unread-count'],
    queryFn: getUnreadCount,
    enabled,
    refetchInterval: connected
      ? UNREAD_COUNT_CONNECTED_POLL_MS
      : UNREAD_COUNT_POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
}

/** Click = mark read + navigate. `onSettled`, so a 404 race still refreshes. */
export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: notificationsKey }),
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: markAllNotificationsRead,
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: notificationsKey }),
  });
}
