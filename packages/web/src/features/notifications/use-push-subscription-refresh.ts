import { useEffect } from 'react';
import { useAuth } from '@/contexts/auth-context';
import {
  fetchVapidPublicKey,
  pushSupported,
  reconcilePushSubscription,
} from './push-subscription';

/**
 * Once per sign-in, make sure this browser's push subscription was made with
 * the VAPID key the server currently publishes (PAC-154 PR4 review).
 *
 * `DEPLOYMENT.md` promises that a key rotation heals as devices come back;
 * this is what keeps that promise. Without it the old subscription stays,
 * every push signed with the new key is refused by the push service, and the
 * user's switch still reads "on". Only acts when permission is already
 * granted and a subscription exists — it never prompts, and a visitor who
 * never opted in costs one `getRegistration()` and nothing else.
 */
export function usePushSubscriptionRefresh(): void {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!userId || !pushSupported() || Notification.permission !== 'granted') {
      return;
    }
    let cancelled = false;
    void (async () => {
      const publicKey = await fetchVapidPublicKey().catch(() => null);
      if (cancelled || !publicKey) return;
      await reconcilePushSubscription(publicKey);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);
}
