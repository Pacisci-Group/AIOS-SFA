import { Globe } from 'lucide-react';
import { Card } from '@/components/ui/card';

/**
 * What an unrecognised hostname gets.
 *
 * ## Why this exists rather than falling through to the login page
 * It used to fall through, and that was wrong in a way that only shows up when
 * someone hits it: an unknown host rendered an ordinary, entirely convincing
 * "AgencyOps" sign-in form. But `HostTenantGuard` refuses **every** request from
 * a host that serves no tenant, so the form accepted correct credentials and
 * then failed with nothing to explain it. A mistyped agency domain looked like
 * a broken product rather than a wrong address.
 *
 * ## Deliberately says nothing about which hosts do exist
 * No agency names, no suggestions, no "did you mean". The API answers `404` on
 * an unknown host precisely so this page cannot be used to enumerate tenants,
 * and echoing the hostname back is as far as it goes — the visitor typed it, so
 * it tells them nothing they did not already know.
 *
 * No sign-in form, and no retry button: nothing about this is transient, and a
 * retry would only fail again. A *transient* failure never reaches here — see
 * `fetchTenantBranding`, which reports only a definitive `404` as unknown.
 */
export function UnknownHostPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md gap-4 border-border p-6">
        <div className="flex size-10 items-center justify-center rounded-lg bg-muted">
          <Globe className="size-5 text-muted-foreground" aria-hidden />
        </div>

        <div className="space-y-2">
          <h1 className="text-base font-semibold text-foreground">
            This address isn’t set up
          </h1>
          <p className="text-sm text-muted-foreground">
            No agency is currently served at{' '}
            <span className="font-mono text-foreground break-all">
              {window.location.host}
            </span>
            .
          </p>
        </div>

        <p className="text-xs text-muted-foreground">
          Check the address for a typo. If you reached this from a link, ask your
          agency for the correct one — if their domain was added recently, the
          DNS change can take a few minutes to take effect.
        </p>
      </Card>
    </div>
  );
}
