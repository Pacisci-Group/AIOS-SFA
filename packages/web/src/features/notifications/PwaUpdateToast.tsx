import { useEffect } from 'react';
import { toast } from 'sonner';
import { useRegisterSW } from 'virtual:pwa-register/react';

/** How often a long-lived tab asks whether a new build has shipped. */
const UPDATE_CHECK_MS = 60 * 60 * 1000;

/**
 * "New version available — Reload" (PAC-154 PR4; the update half of PAC-153
 * §1, Asad 2026-10-07).
 *
 * The service worker is registered in `prompt` mode (`vite.config.ts`), so a
 * new build installs and **waits** for every tab to close before it takes
 * over — which, for an installed app that is never closed, is never. This is
 * the prompt: a persistent toast whose Reload tells the waiting worker to go
 * (`updateServiceWorker(true)` posts `SKIP_WAITING` and reloads).
 *
 * Never silent auto-update: swapping the worker under a tab whose lazy chunks
 * the deploy just deleted is the blank-page failure the shell is built to
 * avoid. Dismissing the toast is allowed — the next check, or the next open,
 * offers it again.
 *
 * Renders nothing; mounted once in `App.tsx` beside `NotificationStream`. In
 * `vite` dev the virtual module is a no-op (`devOptions.enabled: false`).
 */
export function PwaUpdateToast() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      // A tab left open for days should still learn about a deploy.
      setInterval(() => void registration.update(), UPDATE_CHECK_MS);
    },
    onRegisterError(error: unknown) {
      console.warn('Service worker registration failed', error);
    },
  });

  useEffect(() => {
    if (!needRefresh) return;
    const id = toast('New version available', {
      description: 'Reload to get the latest version of the app.',
      duration: Infinity,
      action: {
        label: 'Reload',
        onClick: () => void updateServiceWorker(true),
      },
      onDismiss: () => setNeedRefresh(false),
    });
    return () => {
      toast.dismiss(id);
    };
  }, [needRefresh, setNeedRefresh, updateServiceWorker]);

  return null;
}
