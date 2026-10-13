import { useNotificationStream } from './use-notification-stream';
import { usePushClick } from './use-push-click';
import { usePushSubscriptionRefresh } from './use-push-subscription-refresh';

/**
 * Holds this tab's notification stream open for as long as someone is signed
 * in (PAC-154 PR2). Renders nothing.
 *
 * Mounted once in `App.tsx` beside `ReportBugWidget` — inside `BrowserRouter`,
 * because the toast's "View" action navigates, and outside `Routes`, so every
 * signed-in surface (tenant app, Super Admin panel, dev navigator) is covered
 * without mounting it anywhere else. The hook itself does nothing while
 * signed out.
 *
 * Also finishes a push-notification click (PR4): the service worker focuses
 * this tab and posts the row's `href`, and `usePushClick` marks it read and
 * navigates — the same two things a click in the list does. And once per
 * sign-in it re-checks that this browser's push subscription still matches
 * the published VAPID key (`usePushSubscriptionRefresh`).
 */
export function NotificationStream() {
  useNotificationStream();
  usePushClick();
  usePushSubscriptionRefresh();
  return null;
}
