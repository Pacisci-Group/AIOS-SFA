import { API_BASE, ApiError, getAccessToken } from '@/lib/api-client';
import {
  getVapidPublicKey,
  registerPushSubscription,
  removePushSubscription,
} from '@/lib/notifications-api';

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
 * How long to wait for a worker that may still be registering. `useRegisterSW`
 * registers after the window `load` event, so a first visit that lands
 * straight on `/settings/profile` asks before there is anything to find.
 */
const REGISTRATION_WAIT_MS = 3_000;

/**
 * The service worker registration, or `null` when there is none — which is
 * the case in `vite` dev (`devOptions.enabled: false`).
 *
 * When nothing is registered *yet*, waits on `serviceWorker.ready` for a
 * bounded time: that promise resolves once a worker is active, and never when
 * no worker is coming, so it is raced against a timeout rather than awaited
 * outright. Without the wait, the opt-in switch on a fresh production visit
 * read "Available in the installed app and the production build" until a
 * reload (PR4 review).
 */
export async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null;
  try {
    const existing = await navigator.serviceWorker.getRegistration();
    if (existing) return existing;
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), REGISTRATION_WAIT_MS),
      ),
    ]);
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
    const subscription = await subscriptionFor(registration, publicKey);
    if (!(await registerSubscription(subscription))) {
      return { ok: false, reason: 'failed' };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

/**
 * This browser's subscription **under the given key** — the existing one when
 * it was made with that key, otherwise a fresh one.
 *
 * Reusing a subscription blindly is how a VAPID rotation breaks push for
 * good: the old subscription stays, every push signed with the new key is
 * refused (401/403), and toggling the switch just re-registers the same stale
 * subscription (PR4 review). The key is compared byte for byte.
 */
async function subscriptionFor(
  registration: ServiceWorkerRegistration,
  publicKey: string,
): Promise<PushSubscription> {
  const existing = await registration.pushManager.getSubscription();
  if (existing) {
    if (subscriptionUsesKey(existing, publicKey)) return existing;
    await existing.unsubscribe();
  }
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
}

/** `PUT` the subscription to the API. `false` when the browser gave us nothing usable. */
async function registerSubscription(
  subscription: PushSubscription,
): Promise<boolean> {
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) return false;
  await registerPushSubscription({
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    userAgent: navigator.userAgent.slice(0, 512),
  });
  return true;
}

/** Whether the subscription was created with this VAPID public key. */
function subscriptionUsesKey(
  subscription: PushSubscription,
  publicKey: string,
): boolean {
  const current = subscription.options.applicationServerKey;
  if (!current) return false;
  const actual = new Uint8Array(current);
  const expected = urlBase64ToUint8Array(publicKey);
  return (
    actual.length === expected.length &&
    actual.every((byte, index) => byte === expected[index])
  );
}

/**
 * Bring this browser's subscription up to date with the key the server
 * publishes. Runs on every app load for a signed-in user who already granted
 * permission (`usePushSubscriptionRefresh`), so a VAPID rotation heals on the
 * next visit instead of leaving every device subscribed to a key the push
 * services now refuse. Never prompts: it only acts on an existing
 * subscription.
 */
export async function reconcilePushSubscription(
  publicKey: string,
): Promise<'none' | 'current' | 'renewed'> {
  if (!pushSupported() || Notification.permission !== 'granted') return 'none';
  const registration = await getRegistration();
  if (!registration) return 'none';
  try {
    const existing = await registration.pushManager.getSubscription();
    if (!existing) return 'none';
    if (subscriptionUsesKey(existing, publicKey)) return 'current';
    const renewed = await subscriptionFor(registration, publicKey);
    await registerSubscription(renewed);
    return 'renewed';
  } catch {
    return 'none';
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
 * On sign-out: withdraw this browser's subscription on the server, then drop
 * it locally, so the departing user's pushes stop landing here.
 *
 * Called **before** `clearTokens()` and left to run — sign-out must not wait
 * on the network. The token is captured now because the storage it lives in
 * is wiped a moment later; the request itself is `keepalive` so it survives a
 * page that navigates away. It is a bare `fetch` rather than `apiFetch`
 * because `apiFetch` has no `keepalive` and would try to refresh a token that
 * is about to be wiped — but it reads `API_BASE` from the same place, so the
 * two cannot drift. The local `unsubscribe()` needs no token at all, and is
 * the part that matters: the row, if the request never lands, dies on its
 * next 410.
 */
export function forgetPushSubscriptionOnSignOut(): void {
  if (!pushSupported()) return;
  const token = getAccessToken();
  void (async () => {
    const subscription = await getCurrentSubscription();
    if (!subscription) return;
    if (token) {
      try {
        await fetch(`${API_BASE}/notifications/push-subscriptions`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
          keepalive: true,
        });
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

/**
 * When someone *else* takes over this browser — `login()` as a different
 * user, `adoptSession` from an invite, a session that ended by a failed
 * refresh (`clearTokens()`, never `logout()`) followed by a new sign-in: drop
 * the subscription locally and nothing more.
 *
 * No `DELETE`: by the time this runs the only token in storage is the new
 * user's, and the row is not theirs — the request would 404 and prove
 * nothing. The local `unsubscribe()` is what stops the previous user's
 * notifications appearing as OS notifications on the new user's screen; the
 * row dies on its next 410 (PR4 review).
 */
export function forgetPushSubscriptionLocally(): void {
  if (!pushSupported()) return;
  void (async () => {
    const subscription = await getCurrentSubscription();
    if (!subscription) return;
    try {
      await subscription.unsubscribe();
    } catch {
      // Best-effort; the next push 410s and the worker soft-deletes the row.
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
