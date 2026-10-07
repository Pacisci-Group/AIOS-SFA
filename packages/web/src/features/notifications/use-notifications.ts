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

/**
 * How often the badge re-asks the server while nothing live is connected.
 *
 * PR1 ships polling only; PR2's SSE stream turns this into the fallback for a
 * tab whose stream is down, and invalidates the same queries on each event.
 */
export const UNREAD_COUNT_POLL_MS = 60_000;

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
  return useQuery({
    queryKey: [...notificationsKey, 'unread-count'],
    queryFn: getUnreadCount,
    enabled,
    refetchInterval: UNREAD_COUNT_POLL_MS,
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
