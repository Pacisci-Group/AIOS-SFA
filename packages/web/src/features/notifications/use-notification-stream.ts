import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { fetchEventSource } from '@microsoft/fetch-event-source';
import { toast } from 'sonner';
import type { NotificationRecord } from '@sfa/shared';
import { useAuth } from '@/contexts/auth-context';
import { API_BASE, getAccessToken, refreshAccessToken } from '@/lib/api-client';
import { notificationsKey } from '@/lib/notifications-api';
import { setNotificationStreamConnected } from './notification-stream-status';

/** Reconnect delay after a failed attempt, doubling per attempt up to this. */
const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 30_000;

/** The server closed a healthy stream (at the token's `exp`), or refused a
 * stale token: reconnect. */
class RetriableError extends Error {}
/** Nothing a retry can fix (signed out, forbidden): stop, and let the badge
 * fall back to polling. */
class FatalError extends Error {}

/**
 * One tab's live connection to `GET /notifications/stream` (PAC-154 PR2).
 *
 * ## Why `fetch`, not `EventSource`
 *
 * Native `EventSource` cannot send a header, and the stream authenticates with
 * the same Bearer token as everything else (ticket decision 3; a token in the
 * URL would land in every proxy log). `@microsoft/fetch-event-source` is
 * `EventSource` semantics over `fetch`.
 *
 * ## The token must be read on every connect
 *
 * `headers` is captured once for the life of the call, but the server ends
 * the stream at the token's `exp` (≤ 15 min) by design. The `fetch` override
 * is what makes the reconnect carry the *current* token: on the first
 * reconnect after an expiry the stored token is stale, the server answers
 * 401, `onopen` refreshes (single-flight, shared with any `apiFetch` that hit
 * the same 401), and the next attempt reads the new one.
 *
 * ## `onclose` must throw
 *
 * The library treats a clean close as terminal. The server's close at `exp`
 * is clean, so without the throw the stream would silently die fifteen
 * minutes after login and the badge would quietly go back to polling.
 *
 * ## Every open is a refetch
 *
 * Lossy pub/sub behind the stream is acceptable only because a (re)connect
 * invalidates the count and the list — whatever was missed while the socket
 * was down is read back from the row store, which is the truth.
 *
 * ## Multi-tab
 *
 * N tabs = N streams and N toasts, accepted for v1. `openWhenHidden` is left
 * false: a background tab drops its stream and reopens (and refetches) when
 * it is shown again.
 */
export function useNotificationStream(): void {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  // The toast action outlives any one render; always navigate with the latest.
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  useEffect(() => {
    if (!userId) return;

    const controller = new AbortController();
    let attempt = 0;

    const invalidate = () =>
      void queryClient.invalidateQueries({ queryKey: notificationsKey });

    void fetchEventSource(`${API_BASE}/notifications/stream`, {
      signal: controller.signal,
      headers: { Accept: 'text/event-stream' },
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        const token = getAccessToken();
        if (token) headers.set('Authorization', `Bearer ${token}`);
        return fetch(input, { ...init, headers });
      },
      async onopen(res) {
        if (
          res.ok &&
          (res.headers.get('content-type') ?? '').startsWith('text/event-stream')
        ) {
          attempt = 0;
          setNotificationStreamConnected(true);
          invalidate();
          return;
        }
        if (res.status === 401) {
          const token = await refreshAccessToken();
          if (!token) throw new FatalError('Signed out.');
          throw new RetriableError('Token refreshed; reconnecting.');
        }
        // A client error other than 401 (403, 404 after a bad deploy) will
        // not change on retry. Anything else — 5xx, a proxy 502 mid-deploy —
        // is worth coming back for.
        if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          throw new FatalError(`Stream refused: ${res.status}`);
        }
        throw new RetriableError(`Stream unavailable: ${res.status}`);
      },
      onmessage(event) {
        if (event.event !== 'notification' || !event.data) return;
        let record: NotificationRecord;
        try {
          record = JSON.parse(event.data) as NotificationRecord;
        } catch {
          return;
        }
        // A query, never a counter: the badge and the list re-ask the server.
        invalidate();
        toast(record.title, {
          description: record.body,
          action: {
            label: 'View',
            onClick: () => navigateRef.current(record.href),
          },
        });
      },
      onclose() {
        // Clean close = the server's `exp` cutoff. Reconnect, with whatever
        // token the fetch override reads next time.
        setNotificationStreamConnected(false);
        throw new RetriableError('Stream closed by the server.');
      },
      onerror(err) {
        setNotificationStreamConnected(false);
        if (err instanceof FatalError) throw err;
        attempt += 1;
        return Math.min(RETRY_BASE_MS * 2 ** (attempt - 1), RETRY_MAX_MS);
      },
    }).catch(() => {
      // A `FatalError` lands here. The stream is down for this session;
      // `useUnreadCount` is already polling because `connected` is false.
    });

    return () => {
      controller.abort();
      setNotificationStreamConnected(false);
    };
    // Keyed on the user id so logout, `adoptSession` and an impersonation
    // handoff each tear the old stream down and open one for the new session.
  }, [userId, queryClient]);
}
