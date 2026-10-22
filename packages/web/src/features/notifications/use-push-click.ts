import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { markNotificationRead, notificationsKey } from '@/lib/notifications-api';
import { pushSupported } from './push-subscription';

/**
 * Finishes a push-notification click inside an already-open tab (PAC-154 PR4).
 *
 * The service worker focuses this window and posts `{ type:
 * 'NOTIFICATION_CLICK', id, href }` (see `src/sw.ts`); this hook does what a
 * click in the Notifications page does — mark the row read, then navigate —
 * without the full reload a `client.navigate()` would cost a running SPA.
 */
export function usePushClick() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  useEffect(() => {
    if (!pushSupported()) return;
    const onMessage = (event: MessageEvent) => {
      const data: unknown = event.data;
      if (
        !data ||
        typeof data !== 'object' ||
        (data as { type?: unknown }).type !== 'NOTIFICATION_CLICK'
      ) {
        return;
      }
      const { id, href } = data as { id?: unknown; href?: unknown };
      if (typeof id === 'string' && id) {
        markNotificationRead(id)
          .then(() => queryClient.invalidateQueries({ queryKey: notificationsKey }))
          .catch(() => {
            // Already read, or gone: the page we are about to open still works.
          });
      }
      if (typeof href === 'string' && href.startsWith('/')) {
        navigateRef.current(href);
      }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [queryClient]);
}
