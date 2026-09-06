import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ApiError } from '@/lib/api-client';
import { getInvitePreview } from '@/lib/invite-api';
import { AuthShell } from '@/components/auth/AuthShell';
import { InviteWizard } from '@/features/agency-setup/InviteWizard';
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

  if (status === 'loading') {
    return (
      <AuthShell>
        <p className="text-sm text-muted-foreground">Checking your invite…</p>
      </AuthShell>
    );
  }

  if (status === 'expired') {
    return (
      <AuthShell
        title="This invite has expired"
        description="Invite links are only valid for a short time. Ask your agency owner to send you a new one."
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
        title="This invite link isn’t valid"
        description="It may already have been used, or the link may be incomplete. Ask your agency owner to send you a new one."
      >
        <Button asChild variant="outline" className="w-full">
          <Link to="/login">Back to sign in</Link>
        </Button>
      </AuthShell>
    );
  }

  const invite = inviteQuery.data!;

  return (
    // Wider for an owner: their flow includes the branding step, which needs
    // room for three upload rows and the preview.
    <AuthShell
      width={invite.agencySetupPending ? 'md' : 'sm'}
      title={
        invite.agencySetupPending
          ? `Let’s set up ${invite.agencyName}`
          : `You’ve been invited to ${invite.agencyName}`
      }
      description={
        invite.agencySetupPending
          ? 'Your agency has been created and this account runs it. A few short steps and you’re in.'
          : 'A couple of details and a password, and you’re in.'
      }
    >
      <InviteWizard token={token} preview={invite} />
    </AuthShell>
  );
}
