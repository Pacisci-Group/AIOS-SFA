import { useSyncExternalStore } from 'react';

/**
 * Whether this tab holds a live notification stream right now.
 *
 * A module-level store rather than React context on purpose: the stream is
 * mounted once in `App.tsx` as a *sibling* of the routes (next to
 * `ReportBugWidget`), and a sibling cannot provide context to them. The only
 * reader is `useUnreadCount`, which polls as the fallback while this is false.
 */
let connected = false;
const listeners = new Set<() => void>();

export function setNotificationStreamConnected(next: boolean): void {
  if (connected === next) return;
  connected = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): boolean {
  return connected;
}

/** True while the SSE stream is open; the badge polls only when it is not. */
export function useNotificationStreamConnected(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
