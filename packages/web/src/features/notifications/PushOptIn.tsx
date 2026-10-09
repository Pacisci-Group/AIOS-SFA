import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { toast } from 'sonner';
import { DetailCard } from '@/components/common/DetailCard';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  fetchVapidPublicKey,
  getCurrentSubscription,
  getRegistration,
  pushSupported,
  subscribeThisBrowser,
  unsubscribeThisBrowser,
} from './push-subscription';

/**
 * The "Browser notifications" switch on `/settings/profile` (PAC-154 PR4).
 *
 * Per browser, not per account: a subscription belongs to this browser
 * profile on this device, so the switch reads the browser's own state
 * (`pushManager.getSubscription()`) rather than anything stored server-side.
 * Switching it on is a user gesture — the only moment a browser allows
 * `Notification.requestPermission()`.
 *
 * ## When it hides, and when it is merely off
 *
 * - **Hidden** when the browser has no Push API, or the API answers 404 for
 *   the VAPID key (push is not configured in this environment). Nothing to
 *   offer, so nothing is shown.
 * - **Disabled with a reason** when the service worker is not registered
 *   (the `vite` dev server never registers one) or the user has blocked
 *   notifications for the site — both are fixable, neither from here.
 *
 * Per-type / per-channel preferences are deliberately not here (ticket
 * decision 4); when they land they go in this card.
 */
export function PushOptIn() {
  if (!pushSupported()) return null;
  return <PushOptInCard />;
}

function PushOptInCard() {
  const vapid = useQuery({
    queryKey: ['public', 'push', 'vapid-public-key'],
    queryFn: fetchVapidPublicKey,
    staleTime: Infinity,
    retry: false,
  });

  const [hasWorker, setHasWorker] = useState<boolean | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>(
    () => Notification.permission,
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const registration = await getRegistration();
      const subscription = await getCurrentSubscription();
      if (cancelled) return;
      setHasWorker(registration !== null);
      setSubscribed(subscription !== null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Not configured here: no switch at all, rather than one that fails.
  if (vapid.isSuccess && vapid.data === null) return null;

  const blocked = permission === 'denied';
  const unavailable = hasWorker === false;
  const disabled =
    busy || blocked || unavailable || hasWorker === null || !vapid.isSuccess;

  async function toggle(next: boolean) {
    setBusy(true);
    try {
      if (next) {
        const result = await subscribeThisBrowser(vapid.data ?? '');
        setPermission(Notification.permission);
        if (result.ok) {
          setSubscribed(true);
          toast.success('Browser notifications on', {
            description: 'You’ll be notified here when the app isn’t open.',
          });
        } else if (result.reason === 'denied') {
          toast.error('Notifications are blocked for this site', {
            description: 'Allow them in your browser’s site settings, then try again.',
          });
        } else if (result.reason === 'no-worker') {
          setHasWorker(false);
        } else {
          toast.error('Could not turn on browser notifications');
        }
      } else {
        await unsubscribeThisBrowser();
        setSubscribed(false);
        toast.success('Browser notifications off');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <DetailCard title="Notifications" icon={Bell}>
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <Label htmlFor="push-opt-in" className="text-sm font-medium">
            Browser notifications
          </Label>
          <p className="text-sm text-muted-foreground">
            {blocked
              ? 'Blocked for this site in your browser settings.'
              : unavailable
                ? 'Available in the installed app and the production build.'
                : vapid.isError
                  ? 'Could not check whether push is available. Reload to try again.'
                  : 'Get a notification on this device when something needs you and the app isn’t open. Per browser; turn it on wherever you work.'}
          </p>
        </div>
        <Switch
          id="push-opt-in"
          checked={subscribed}
          disabled={disabled}
          onCheckedChange={(checked) => void toggle(checked)}
          aria-label="Browser notifications"
        />
      </div>
    </DetailCard>
  );
}
