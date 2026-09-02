import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthShell } from '@/components/auth/AuthShell';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/auth-context';
import { ApiError, clearTokens, fetchMe, setTokens } from '@/lib/api-client';
import { HANDOFF_PATH, parseHandoffHash } from '@/lib/impersonation-handoff';

/**
 * Where an impersonation lands (PAC-70).
 *
 * The Super Admin panel minted a session as a tenant user and navigated the
 * browser here, on the *target's* origin, with the token pair in the URL
 * fragment (see `impersonation-handoff.ts` for why). This page stores the
 * tokens in this origin, confirms them against `/auth/me` — which is also
 * where `HostTenantGuard` would refuse a session used on the wrong host — and
 * sends the operator to the user's normal landing page. From then on the app
 * has no idea anyone is impersonating; the operator simply logs out when done.
 *
 * **Public, and routed outside both `ProtectedRoute` and `PublicOnlyRoute`.**
 * `ProtectedRoute` would bounce a visitor with no session on this origin to
 * `/login`; `PublicOnlyRoute` would redirect away the operator arriving *with*
 * a live session, which is exactly the case when the target agency has no
 * domain and this is the platform host. Same placement as `/auth/accept-invite`.
 *
 * The fragment is read **once**, inside the ref-guarded effect, and the URL is
 * replaced in the same breath — so the tokens survive neither a reload nor the
 * history stack.
 *
 * ⚠ Not in a `useState` initializer. StrictMode runs a mounting component's
 * render twice and keeps the *second* pass's hooks, so an initializer that
 * scrubs the fragment as a side effect hands the surviving pass an empty hash
 * — the page then reports "missing its session" with the tokens sitting right
 * there in the address bar. That is how this was first written, and how it
 * failed.
 */
export default function ImpersonateHandoffPage() {
  const navigate = useNavigate();
  const { adoptSession } = useAuth();

  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    // A ref rather than a cleanup flag: StrictMode mounts, unmounts and
    // remounts, and a "cancelled" flag set on that first unmount would strand
    // the real run with its tokens already stored and nowhere to go.
    if (started.current) return;
    started.current = true;

    const tokens = parseHandoffHash(window.location.hash);
    if (window.location.hash) {
      window.history.replaceState(null, '', HANDOFF_PATH);
    }
    if (!tokens) {
      setError('This link is missing its session.');
      return;
    }

    void (async () => {
      try {
        // Whatever session this origin held before — the operator's own, on
        // the platform host — is replaced, not merged. `clearTokens` also wipes
        // `branchId` and the stored `user`, so nothing of theirs leaks through.
        clearTokens();
        setTokens(tokens.accessToken, tokens.refreshToken);
        const user = await fetchMe();
        // Drops the React Query cache too, so no data of the previous user
        // renders under the new identity.
        adoptSession(user);
        navigate('/', { replace: true });
      } catch (err) {
        // A half-stored session is worse than none: the next page load would
        // present as "logged in" with a token the API refuses.
        clearTokens();
        setError(
          err instanceof ApiError
            ? err.message
            : 'Could not start this session.',
        );
      }
    })();
  }, [adoptSession, navigate]);

  if (error) {
    return (
      <AuthShell>
        <h2 className="text-foreground font-semibold text-base">
          Couldn’t start this session
        </h2>
        <p className="text-sm text-muted-foreground">{error}</p>
        <p className="text-sm text-muted-foreground">
          Go back to the Super Admin panel and try again, or sign in normally.
        </p>
        <Button asChild variant="outline" className="w-full">
          <Link to="/login">Go to sign in</Link>
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <p className="text-sm text-muted-foreground">Starting session…</p>
    </AuthShell>
  );
}
