import { useNotificationStream } from './use-notification-stream';

/**
 * Holds this tab's notification stream open for as long as someone is signed
 * in (PAC-154 PR2). Renders nothing.
 *
 * Mounted once in `App.tsx` beside `ReportBugWidget` — inside `BrowserRouter`,
 * because the toast's "View" action navigates, and outside `Routes`, so every
 * signed-in surface (tenant app, Super Admin panel, dev navigator) is covered
 * without mounting it anywhere else. The hook itself does nothing while
 * signed out.
 */
export function NotificationStream() {
  useNotificationStream();
  return null;
}
