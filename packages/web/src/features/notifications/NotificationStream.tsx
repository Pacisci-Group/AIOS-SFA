import { useNotificationStream } from './use-notification-stream';
import { usePushClick } from './use-push-click';

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
 * navigates — the same two things a click in the list does.
 */
export function NotificationStream() {
  useNotificationStream();
  usePushClick();
  return null;
}
