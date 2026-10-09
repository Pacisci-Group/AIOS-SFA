/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core';
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import type { NotificationRecord } from '@sfa/shared';

declare let self: ServiceWorkerGlobalScope;

/**
 * The AgencyOps service worker (PAC-154 PR4 · PAC-153 §1).
 *
 * Built by `vite-plugin-pwa` in `injectManifest` mode — this file is the whole
 * worker, the plugin only fills in `self.__WB_MANIFEST`. It does three things
 * and deliberately nothing else:
 *
 * 1. **Precache the shell** (every hashed chunk, the stylesheet, the fonts,
 *    the icons) and serve navigations from the cached `index.html`, so an
 *    installed app opens instantly and offline.
 * 2. **Show every push** from the worker's `deliver-notification` function
 *    as an OS notification — focused window or not. The first cut suppressed
 *    it while a window was focused (the in-app toast had already said it),
 *    which is fine in Chrome and fatal on WebKit: Safari counts a push that
 *    shows nothing as a *silent push* under `userVisibleOnly`, and after a
 *    few of them revokes the subscription — and the installed iOS app is
 *    exactly what this targets. So a user with the app in front may see the
 *    toast and the notification for one event; the `tag` keeps it to one
 *    notification per row. Ticket rule amended 2026-10-09 (PR4 review).
 * 3. **Deep-link a click** into an open window, or open one.
 *
 * ## `/api/v1/*` is never cached — by omission, on purpose
 *
 * There is no runtime caching route in this file. The precache holds build
 * output only, and the navigation route's `denylist` keeps `/api/` out of
 * the shell fallback, so an API request that reaches the worker falls through
 * to the network untouched. That absence is the "network-only" guarantee in
 * the ticket's acceptance criteria; adding a `registerRoute` for the API is
 * how a stale permission set or someone else's rows would be served from
 * cache after a re-login.
 *
 * ## Updates are prompted, never silent
 *
 * `registerType: 'prompt'` in `vite.config.ts`: a new build installs and
 * **waits**. The app shows "New version available — Reload"
 * (`PwaUpdateToast`), and the Reload posts `SKIP_WAITING` here. A silent
 * `skipWaiting()` on install would swap the worker under a running tab whose
 * lazy chunks the last deploy just deleted — the blank-page-after-deploy
 * failure `nginx.conf` already guards `index.html` against.
 *
 * ## Shared types
 *
 * `NotificationRecord`, never `Notification`: the latter is a DOM global in
 * this scope too, and shadowing it compiles.
 */

/** What `deliver-notification.fn.ts` sends — the stored row's one-line rendering. */
interface PushPayload {
  id: string;
  title: string;
  body: string;
  /** App-relative path, as stored; opened on this worker's own origin. */
  href: NotificationRecord['href'];
  /** Absolute URL of the agency mark, or the platform icon. */
  icon: string;
}

/** What the worker posts to a window after a notification click. */
export interface PushClickMessage {
  type: 'NOTIFICATION_CLICK';
  id: string;
  href: string;
}

const FALLBACK_HREF = '/notifications';

/**
 * Shown when a push arrives whose payload cannot be read. Dropping it would be
 * a silent push in every browser (WebKit revokes the subscription for those),
 * and something *did* happen — the list has it. No `id`, so a click opens the
 * list rather than trying to mark a row read.
 */
const FALLBACK_PAYLOAD: PushPayload = {
  id: '',
  title: 'AgencyOps',
  body: 'You have a new notification.',
  href: FALLBACK_HREF,
  icon: '/icon-192.png',
};

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// Navigations get the cached shell; the SPA router does the rest. `/api/`
// is denied so an API URL typed into the address bar (or fetched by a
// navigation-mode request) is never answered with `index.html`.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('index.html'), {
    denylist: [/^\/api\//, /^\/auth\/impersonate/],
  }),
);

// Once a waiting worker is told to go (the Reload toast), take over every
// open tab at once so they all run the same build.
self.addEventListener('message', (event: ExtendableMessageEvent) => {
  const data: unknown = event.data;
  if (
    data &&
    typeof data === 'object' &&
    (data as { type?: unknown }).type === 'SKIP_WAITING'
  ) {
    void self.skipWaiting();
  }
});
clientsClaim();

self.addEventListener('push', (event: PushEvent) => {
  // Always shown — see the docblock. A push that shows nothing is a silent
  // push, and WebKit revokes the subscription after a few of those.
  const payload = parsePayload(event.data) ?? FALLBACK_PAYLOAD;

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: payload.icon,
      // Same row twice (a replayed step) replaces rather than stacks; every
      // unreadable payload collapses into one.
      tag: payload.id || 'agencyops-notification',
      data: { id: payload.id, href: payload.href },
    }),
  );
});

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  const data = (event.notification.data ?? {}) as { id?: string; href?: string };
  const href =
    typeof data.href === 'string' && data.href.startsWith('/')
      ? data.href
      : FALLBACK_HREF;
  const id = typeof data.id === 'string' ? data.id : '';

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      const target = windows.find((client) => 'focus' in client);
      if (target) {
        // Focus the app and let the SPA navigate (and mark the row read) —
        // `client.navigate()` would be a full reload of a tab that is already
        // running the app.
        await target.focus();
        const message: PushClickMessage = { type: 'NOTIFICATION_CLICK', id, href };
        target.postMessage(message);
        return;
      }
      // Nothing open: a cold start straight to the row's page. The row is
      // not marked read on this path — the worker has no session to do it
      // with — and the Notifications page's own click still does.
      await self.clients.openWindow(href);
    })(),
  );
});

function parsePayload(data: PushMessageData | null): PushPayload | null {
  if (!data) return null;
  try {
    const parsed: unknown = data.json();
    if (!parsed || typeof parsed !== 'object') return null;
    const candidate = parsed as Partial<PushPayload>;
    if (
      typeof candidate.id !== 'string' ||
      typeof candidate.title !== 'string' ||
      typeof candidate.body !== 'string' ||
      typeof candidate.href !== 'string'
    ) {
      return null;
    }
    return {
      id: candidate.id,
      title: candidate.title,
      body: candidate.body,
      href: candidate.href,
      icon: typeof candidate.icon === 'string' ? candidate.icon : '/icon-192.png',
    };
  } catch {
    return null;
  }
}
