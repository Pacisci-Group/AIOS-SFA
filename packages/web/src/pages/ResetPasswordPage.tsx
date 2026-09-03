import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/auth-context';
import { ApiError } from '@/lib/api-client';
import {
  getPasswordResetPreview,
  resetPassword,
} from '@/lib/password-reset-api';
import { AuthShell } from '@/components/auth/AuthShell';
import { SetPasswordForm } from '@/components/auth/SetPasswordForm';
import { Button } from '@/components/ui/button';

/**
 * Set a new password from an admin-triggered reset link (PAC-79).
 *
 * **Public, and routed outside both `ProtectedRoute` and `PublicOnlyRoute`** —
 * the same placement and the same two reasons as `AcceptInvitePage`.
 * `ProtectedRoute` would bounce someone who cannot sign in, which is the entire
 * population this page serves; `PublicOnlyRoute` would redirect away the owner
 * checking the link and anyone on a machine where a colleague is still signed
 * in.
 *
 * There is deliberately **no self-service "Forgot password?" entry point** into
 * this page. A public variant needs its own threat model — per-IP rate limiting
 * and a response that does not reveal whether an address exists — and is a
 * sibling ticket, not a quiet widening of this one.
 */
export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const navigate = useNavigate();
  const { adoptSession } = useAuth();

  const [submitError, setSubmitError] = useState<string | null>(null);

  const resetQuery = useQuery({
    queryKey: ['password-reset', token],
    queryFn: () => getPasswordResetPreview(token),
    enabled: !!token,
    // A bad or expired token will never become good by asking again, and each
    // retry delays the error state the user actually needs to read.
    retry: false,
    staleTime: Infinity,
  });

  const status = useMemo(() => {
    if (!token) return 'invalid' as const;
    if (resetQuery.isLoading) return 'loading' as const;
    if (resetQuery.isError) {
      // 410 is the one failure with a remedy they can act on. Everything else —
      // unknown token, already used, the account since removed — collapses into
      // one generic message that leaks nothing about which it was.
      const httpStatus = (resetQuery.error as ApiError)?.status;
      return httpStatus === 410 ? ('expired' as const) : ('invalid' as const);
    }
    return 'valid' as const;
  }, [token, resetQuery.isLoading, resetQuery.isError, resetQuery.error]);

  async function handleSubmit(password: string) {
    setSubmitError(null);
    try {
      const result = await resetPassword(token, password);
      // The call persisted the new token pair; this tells React about the
      // session so `ProtectedRoute` lets them through on the next render.
      // It also replaces whatever session this browser held — the reset just
      // invalidated it server-side.
      adoptSession(result.user);
      // `/` is the role landing, which routes them to the dashboard their
      // permissions actually grant.
      navigate('/', { replace: true });
    } catch (err) {
      setSubmitError(
        err instanceof ApiError
          ? err.message
          : 'Could not set your password. Try again.',
      );
    }
  }

  if (status === 'loading') {
    return (
      <AuthShell>
        <p className="text-sm text-muted-foreground">Checking your link…</p>
      </AuthShell>
    );
  }

  if (status === 'expired') {
    return (
      <AuthShell
        title="This reset link has expired"
        description="Reset links are only valid for a short time. Ask your agency owner to send you a new one."
      >
        <Button asChild variant="outline" className="w-full">
          <Link to="/login">Back to sign in</Link>
        </Button>
      </AuthShell>
    );
  }

  if (status === 'invalid') {
    return (
      <AuthShell
        title="This reset link isn’t valid"
        description="It may already have been used, or the link may be incomplete. Ask your agency owner to send you a new one."
      >
        <Button asChild variant="outline" className="w-full">
          <Link to="/login">Back to sign in</Link>
        </Button>
      </AuthShell>
    );
  }

  const reset = resetQuery.data!;

  return (
    <AuthShell
      title="Set a new password"
      /*
        The address is text, not a field — the token already determines the
        account. It is shown because this mail arrives unprompted at an existing
        account, so whoever opened the link needs to see which one they are
        about to change, especially on a shared machine.
      */
      description={
        <>
          An administrator at{' '}
          <span className="text-foreground">{reset.agencyName}</span> asked you
          to reset the password for{' '}
          <span className="text-foreground">{reset.email}</span>.
        </>
      }
    >
      <SetPasswordForm
        email={reset.email}
        idPrefix="reset"
        submitLabel="Set password and sign in"
        pendingLabel="Setting your password…"
        error={submitError}
        onSubmit={handleSubmit}
        footer={
          <>
            {/*
              Date *and* time. The link lasts hours, not the invite's week — a
              bare "expires on August 30" read on August 30 says nothing.
            */}
            This link expires on {new Date(reset.expiresAt).toLocaleString()}{' '}
            and can only be used once.
          </>
        }
      />
    </AuthShell>
  );
}
