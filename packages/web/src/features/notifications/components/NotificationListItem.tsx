import type { NotificationRecord } from '@sfa/shared';
import { relativeTime } from '@/lib/relative-time';
import { cn } from '@/lib/utils';

/**
 * One row of the notification centre.
 *
 * A `button`, not a `Link`: opening a row does two things — marks it read and
 * navigates — and the page owns both, so the row only reports the click.
 * Unread is carried by weight and a dot rather than colour alone, so it reads
 * the same in both themes and to a screen reader (the `sr-only` text).
 */
export function NotificationListItem({
  notification,
  onOpen,
}: {
  notification: NotificationRecord;
  onOpen: (notification: NotificationRecord) => void;
}) {
  const unread = notification.readAt === null;

  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(notification)}
        className={cn(
          'flex w-full items-start gap-3 px-4 py-3 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
          unread && 'bg-primary/5',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'mt-2 size-2 shrink-0 rounded-full',
            unread ? 'bg-primary' : 'bg-transparent',
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-3">
            <span
              className={cn(
                'truncate text-base',
                unread ? 'font-semibold' : 'font-medium',
              )}
            >
              {unread && <span className="sr-only">Unread: </span>}
              {notification.title}
            </span>
            <time
              dateTime={notification.createdAt}
              className="shrink-0 text-xs text-muted-foreground tabular-nums"
            >
              {relativeTime(notification.createdAt)}
            </time>
          </span>
          <span className="mt-0.5 line-clamp-2 block text-sm text-muted-foreground">
            {notification.body}
          </span>
        </span>
      </button>
    </li>
  );
}
