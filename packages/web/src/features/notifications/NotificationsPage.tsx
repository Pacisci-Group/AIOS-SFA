import type { NotificationRecord } from '@sfa/shared';
import { AlertCircle, Bell, CheckCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { useUrlState } from '@/hooks/useUrlState';
import { NotificationListItem } from './components/NotificationListItem';
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotificationsList,
  useUnreadCount,
} from './use-notifications';

/**
 * The tab rides on the URL so a link to "my unread" can be shared or
 * bookmarked. Unread is the default and therefore the empty value — the hook
 * removes a default from the URL, so only `?tab=all` ever appears.
 */
const TAB_DEFAULTS = { tab: '' } as const;
const TAB_ALLOWED = { tab: ['all'] } as const;

/**
 * The notification centre (PAC-154): Unread / All, newest first, load more.
 *
 * Routed at `/notifications` with **no permission gate** — a notification is
 * addressed to you, and the page each one opens keeps its own gate. Opening a
 * row marks it read and navigates to its `href`, which is a path the SPA
 * follows as-is.
 */
export default function NotificationsPage() {
  const navigate = useNavigate();
  const [{ tab }, setUrl] = useUrlState({
    defaults: TAB_DEFAULTS,
    allowed: TAB_ALLOWED,
  });
  const unreadOnly = tab !== 'all';

  const list = useNotificationsList(unreadOnly);
  const unreadCount = useUnreadCount();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const unread = unreadCount.data?.unread ?? 0;

  const open = (notification: NotificationRecord) => {
    if (notification.readAt === null) markRead.mutate(notification.id);
    navigate(notification.href);
  };

  return (
    <SettingsPage
      title="Notifications"
      caption={
        unreadCount.isLoading
          ? ' '
          : unread === 0
            ? 'All caught up'
            : `${unread} unread`
      }
      icon={Bell}
      // Personal, like the profile page: the back arrow goes home, not into
      // Workspace Settings.
      backTo="/"
      action={
        <Button
          variant="outline"
          size="sm"
          onClick={() => markAll.mutate()}
          disabled={unread === 0 || markAll.isPending}
        >
          <CheckCheck className="size-4" />
          Mark all read
        </Button>
      }
    >
      <Tabs
        value={unreadOnly ? 'unread' : 'all'}
        onValueChange={(value) => setUrl({ tab: value === 'all' ? 'all' : '' })}
      >
        <TabsList variant="line">
          <TabsTrigger value="unread">Unread</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="mt-4 overflow-hidden rounded-xl border border-border bg-card">
        {list.isLoading ? (
          <ul className="divide-y divide-border">
            {Array.from({ length: 5 }, (_, index) => (
              <li key={index} className="flex gap-3 px-4 py-3">
                <Skeleton className="mt-2 size-2 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3.5 w-3/4" />
                </div>
              </li>
            ))}
          </ul>
        ) : list.isError ? (
          <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
            <AlertCircle aria-hidden className="size-5 text-destructive" />
            <p className="text-sm text-muted-foreground">
              Couldn't load your notifications.
            </p>
            <Button variant="outline" size="sm" onClick={() => list.refetch()}>
              Retry
            </Button>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 p-8 text-center">
            <Bell aria-hidden className="size-5 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {unreadOnly
                ? "You're all caught up."
                : 'Nothing here yet. Updates about your work will show up here.'}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((notification) => (
              <NotificationListItem
                key={notification.id}
                notification={notification}
                onOpen={open}
              />
            ))}
          </ul>
        )}

        {list.hasNextPage && (
          <div className="border-t border-border p-3 text-center">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => list.fetchNextPage()}
              disabled={list.isFetchingNextPage}
            >
              {list.isFetchingNextPage ? 'Loading…' : 'Load more'}
            </Button>
          </div>
        )}
      </div>
    </SettingsPage>
  );
}
