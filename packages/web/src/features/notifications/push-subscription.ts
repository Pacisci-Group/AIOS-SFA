import { getAccessToken } from '@/lib/api-client';
import {
  getVapidPublicKey,
  registerPushSubscription,
  removePushSubscription,
} from '@/lib/notifications-api';
import { ApiError } from '@/lib/api-client';

/**
 * This browser's web-push subscription (PAC-154 PR4) — the glue between the
 * Push API, the service worker and `/notifications/push-subscriptions`.
 *
 * Everything here is best-effort and never throws past the one place the
 * user can see (`PushOptIn`). The worker-side truth is the push service: a
 * subscription that is gone answers 410 on the next push and is soft-deleted
 * then, so a missed `DELETE` here costs one dead push, not a leak.
 */

/** What the browser can do at all, before asking the server anything. */
export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/**
 * The service worker registration, or `null` when there is none — which is
 * the case in `vite` dev (`devOptions.enabled: false`) and the first visit of
 * a production build before the worker has installed. Never `ready`: that
 * promise waits forever when no worker is coming.
 */
export async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null;
  try {
    return (await navigator.serviceWorker.getRegistration()) ?? null;
  } catch {
    return null;
  }
}

export async function getCurrentSubscription(): Promise<PushSubscription | null> {
  const registration = await getRegistration();
  if (!registration) return null;
  try {
    return await registration.pushManager.getSubscription();
  } catch {
    return null;
  }
}

/**
 * The VAPID public key, or `null` when push is not configured in this
 * environment (the API answers 404). Anything else is rethrown.
 */
export async function fetchVapidPublicKey(): Promise<string | null> {
  try {
    return (await getVapidPublicKey()).publicKey;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

export type SubscribeResult =
  | { ok: true }
  | { ok: false; reason: 'denied' | 'unsupported' | 'no-worker' | 'failed' };

/**
 * Ask for permission, subscribe, and register the subscription with the API.
 * Must run from a user gesture — browsers refuse `requestPermission()`
 * otherwise.
 */
export async function subscribeThisBrowser(
  publicKey: string,
): Promise<SubscribeResult> {
  if (!pushSupported()) return { ok: false, reason: 'unsupported' };
  const registration = await getRegistration();
  if (!registration) return { ok: false, reason: 'no-worker' };

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, reason: 'denied' };

  try {
    const subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      }));
    const json = subscription.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
      return { ok: false, reason: 'failed' };
    }
    await registerPushSubscription({
      endpoint: json.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      userAgent: navigator.userAgent.slice(0, 512),
    });
    return { ok: true };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

/**
 * Withdraw this browser's subscription: tell the API, then drop it locally.
 * The local `unsubscribe()` is what actually stops pushes arriving; the
 * `DELETE` keeps the row tidy and is allowed to fail (a 404 means it already
 * was).
 */
export async function unsubscribeThisBrowser(): Promise<void> {
  const subscription = await getCurrentSubscription();
  if (!subscription) return;
  try {
    await removePushSubscription(subscription.endpoint);
  } catch {
    // Already gone server-side, or offline — the 410 path cleans up later.
  }
  try {
    await subscription.unsubscribe();
  } catch {
    // Nothing to do: the browser refused, the next push 410s and the worker
    // soft-deletes the row.
  }
}

/**
 * On sign-out, or when another user takes over this browser: stop the
 * previous user's pushes landing here.
 *
 * Called **before** `clearTokens()` and left to run — sign-out must not wait
 * on the network. The token is captured now because the storage it lives in
 * is wiped a moment later; the request itself is `keepalive` so it survives a
 * page that navigates away. The local `unsubscribe()` needs no token at all,
 * and is the part that matters: the row, if the request never lands, dies on
 * its next 410.
 */
export function forgetPushSubscriptionOnSignOut(): void {
  if (!pushSupported()) return;
  const token = getAccessToken();
  void (async () => {
    const subscription = await getCurrentSubscription();
    if (!subscription) return;
    if (token) {
      try {
        await fetch(
          `${import.meta.env.VITE_API_BASE_URL || '/api/v1'}/notifications/push-subscriptions`,
          {
            method: 'DELETE',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ endpoint: subscription.endpoint }),
            keepalive: true,
          },
        );
      } catch {
        // Best-effort; see above.
      }
    }
    try {
      await subscription.unsubscribe();
    } catch {
      // Best-effort; see above.
    }
  })();
}

/** The VAPID key as the Push API wants it: raw bytes, not base64url. */
export function urlBase64ToUint8Array(
  base64Url: string,
): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  // A plain `ArrayBuffer`, named: `BufferSource` refuses a view over a
  // possibly-shared buffer, which is what `new Uint8Array(n)` is typed as.
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}
