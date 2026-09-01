import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/auth-context';
import { ApiError } from '@/lib/api-client';
import { acceptInvite, getInvitePreview } from '@/lib/invite-api';
import { AuthShell } from '@/components/auth/AuthShell';
import { SetPasswordForm } from '@/components/auth/SetPasswordForm';
import { Button } from '@/components/ui/button';

/**
 * Set a password from an emailed invite link (PAC-58 Scope 4).
 *
 * **Public, and routed outside both `ProtectedRoute` and `PublicOnlyRoute`.**
 * `ProtectedRoute` would bounce the invitee — who by definition has no session —
 * to `/login`. `PublicOnlyRoute` would be worse in the other direction: it
 * redirects anyone *with* a session away, so an owner testing their own invite,
 * or an employee on a shared machine where a colleague is still signed in, could
 * never reach the page. Same placement and reasoning as `/f/lead/:token`.
 *
 * Styling deliberately mirrors `LoginPage` — these are the pages a person sees
 * before they are anybody, and they should look like one product. The shell and
 * the password fields now live in `components/auth/`, shared with
 * `ResetPasswordPage`, which is the same page with different copy.
 */
export default function AcceptInvitePage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const navigate = useNavigate();
  const { adoptSession } = useAuth();

  const [submitError, setSubmitError] = useState<string | null>(null);

  const inviteQuery = useQuery({
    queryKey: ['invite', token],
    queryFn: () => getInvitePreview(token),
    enabled: !!token,
    // A bad or expired token will never become good by asking again, and each
    // retry delays the error state the invitee actually needs to read.
    retry: false,
    staleTime: Infinity,
  });

  const status = useMemo(() => {
    if (!token) return 'invalid' as const;
    if (inviteQuery.isLoading) return 'loading' as const;
    if (inviteQuery.isError) {
      // 410 is the one failure with a remedy the invitee can act on, so it gets
      // its own copy. Everything else — unknown token, already used, network —
      // collapses into one generic message that leaks nothing.
      const httpStatus = (inviteQuery.error as ApiError)?.status;
      return httpStatus === 410 ? ('expired' as const) : ('invalid' as const);
    }
    return 'valid' as const;
  }, [token, inviteQuery.isLoading, inviteQuery.isError, inviteQuery.error]);

  async function handleSubmit(password: string) {
    setSubmitError(null);
    try {
      const result = await acceptInvite(token, password);
      // `acceptInvite` already persisted the tokens; this tells React about the
      // session so `ProtectedRoute` lets them through on the very next render.
      adoptSession(result.user);
      // `/` is the role landing, which routes them to the dashboard their new
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
        <p className="text-sm text-muted-foreground">Checking your invite…</p>
      </AuthShell>
    );
  }

  if (status === 'expired') {
    return (
      <AuthShell>
        <h2 className="text-foreground font-semibold text-base">
          This invite has expired
        </h2>
        <p className="text-sm text-muted-foreground">
          Invite links are only valid for a short time. Ask your agency owner to
          send you a new one.
        </p>
        <Button asChild variant="outline" className="w-full">
          <Link to="/login">Back to sign in</Link>
        </Button>
      </AuthShell>
    );
  }

  if (status === 'invalid') {
    return (
      <AuthShell>
        <h2 className="text-foreground font-semibold text-base">
          This invite link isn’t valid
        </h2>
        <p className="text-sm text-muted-foreground">
          It may already have been used, or the link may be incomplete. Ask your
          agency owner to send you a new one.
        </p>
        <Button asChild variant="outline" className="w-full">
          <Link to="/login">Back to sign in</Link>
        </Button>
      </AuthShell>
    );
  }

  const invite = inviteQuery.data!;
  const roles = invite.roleNames.join(', ');

  return (
    <AuthShell>
      <div className="space-y-1">
        <h2 className="text-foreground font-semibold text-base">
          You’ve been invited to {invite.agencyName}
        </h2>
        {/*
          The invited address is shown as **text, not a field**. The token
          already determines the account, so an input — even a read-only one —
          would be asking for something the page is not actually collecting,
          and reads as a step the invitee has to complete. Setting the password
          is the only thing they do here.

          It is still displayed rather than dropped: it tells whoever opened
          the link which account they are about to activate, which matters on a
          shared machine or a forwarded email.
        */}
        <p className="text-sm text-muted-foreground">
          {roles && (
            <>
              You’ll join as <span className="text-foreground">{roles}</span>.{' '}
            </>
          )}
          Set a password for{' '}
          <span className="text-foreground">{invite.email}</span> to finish.
        </p>
      </div>

      <SetPasswordForm
        email={invite.email}
        idPrefix="invite"
        submitLabel="Set password and sign in"
        pendingLabel="Setting your password…"
        error={submitError}
        onSubmit={handleSubmit}
        footer={
          <>
            This link expires on{' '}
            {new Date(invite.expiresAt).toLocaleDateString()}.
          </>
        }
      />
    </AuthShell>
  );
}
