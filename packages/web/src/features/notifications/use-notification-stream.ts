import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { fetchEventSource } from '@microsoft/fetch-event-source';
import { toast } from 'sonner';
import type { NotificationRecord } from '@sfa/shared';
import { useAuth } from '@/contexts/auth-context';
import {
  API_BASE,
  getAccessToken,
  getAccessTokenExpiry,
  refreshAccessToken,
} from '@/lib/api-client';
import { notificationsKey } from '@/lib/notifications-api';
import { setNotificationStreamConnected } from './notification-stream-status';

/** Reconnect delay after a failed attempt, doubling per attempt up to this. */
const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 30_000;

/**
 * Refresh the token before connecting when it has less than this left. The
 * server closes the stream one second before `exp`; reconnecting with the
 * same token then either opens a stream the server closes at once or earns
 * a 401 — a few seconds of gap, plus an extra refetch, every fifteen minutes
 * in every tab (PR2 review). Refreshing first makes the reconnect carry a
 * token with a whole lifetime ahead of it.
 */
const TOKEN_REFRESH_MARGIN_MS = 30_000;

/**
 * A stream that lived at least this long before the server closed it was a
 * healthy one ending at `exp`: reconnect at once rather than back off. A
 * shorter life means the server is closing streams on arrival, and that
 * deserves the backoff.
 */
const STABLE_STREAM_MS = 5_000;

/** The server refused or dropped the connection: reconnect with backoff. */
class RetriableError extends Error {}
/** The server closed a healthy stream cleanly (at the token's `exp`). */
class ServerClosedError extends RetriableError {}
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
 * ## The token is read, and refreshed, on every connect
 *
 * `headers` is captured once for the life of the call, but the server ends
 * the stream at the token's `exp` (≤ 15 min) by design. The `fetch` override
 * is what makes each attempt carry the *current* token — and, when that token
 * is about to expire ({@link TOKEN_REFRESH_MARGIN_MS}), a freshly refreshed
 * one, so the reconnect after the server's `exp` close never has to be told
 * 401 first. The refresh is single-flight, shared with any `apiFetch` that
 * hits the same 401. A 401 that still arrives (a token revoked server-side)
 * refreshes in `onopen` and retries.
 *
 * ## `onclose` must throw
 *
 * The library treats a clean close as terminal. The server's close at `exp`
 * is clean, so without the throw the stream would silently die fifteen
 * minutes after login and the badge would quietly go back to polling. A
 * clean close after a stable stream reconnects immediately; anything else
 * backs off exponentially.
 *
 * ## Every open is a refetch
 *
 * Lossy pub/sub behind the stream is acceptable only because a (re)connect
 * invalidates the count and the list — whatever was missed while the socket
 * was down is read back from the row store, which is the truth. This is the
 * *only* refetch while the stream is up: `use-notifications.ts` turns its
 * focus refetch off while connected, so showing a tab costs one refetch
 * (the reopen), not two (PR2 review).
 *
 * ## Multi-tab
 *
 * N tabs = N streams and N toasts, accepted for v1. `openWhenHidden` is left
 * false: a background tab drops its stream and reopens (and refetches) when
 * it is shown again. The server admits eight streams per user per node and
 * answers 429 past that, which lands in the retriable path below.
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
    let openedAt = 0;

    const invalidate = () =>
      void queryClient.invalidateQueries({ queryKey: notificationsKey });

    void fetchEventSource(`${API_BASE}/notifications/stream`, {
      signal: controller.signal,
      headers: { Accept: 'text/event-stream' },
      fetch: async (input, init) => {
        const expiry = getAccessTokenExpiry();
        if (expiry !== null && expiry - Date.now() < TOKEN_REFRESH_MARGIN_MS) {
          // Best-effort: a failed refresh clears the tokens, the request goes
          // out without one, and `onopen` turns the 401 into a FatalError.
          await refreshAccessToken().catch(() => null);
        }
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
          openedAt = Date.now();
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
        // not change on retry. Anything else — 5xx, a proxy 502 mid-deploy,
        // the per-user stream cap's 429 — is worth coming back for.
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
        // token the fetch override reads (or refreshes) next time.
        setNotificationStreamConnected(false);
        throw new ServerClosedError('Stream closed by the server.');
      },
      onerror(err: unknown) {
        setNotificationStreamConnected(false);
        if (err instanceof FatalError) throw err;
        if (
          err instanceof ServerClosedError &&
          Date.now() - openedAt >= STABLE_STREAM_MS
        ) {
          // A healthy stream that reached `exp`: no gap worth waiting out.
          return 0;
        }
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
