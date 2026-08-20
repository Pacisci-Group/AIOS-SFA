import { FormEvent, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Check, Eye, EyeOff, Shield, X } from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import { ApiError } from '@/lib/api-client';
import { acceptInvite, getInvitePreview } from '@/lib/invite-api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FormError } from '@/components/form';
import { cn } from '@/lib/utils';

/**
 * Must match `AcceptInviteDto`'s `@MinLength(8)` in the API. Kept as a named
 * constant so the two are obviously paired — if the server rule is tightened,
 * this is the line to change with it, or the form will happily submit passwords
 * the API then rejects.
 */
const MIN_PASSWORD_LENGTH = 8;

function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 mb-8 justify-center">
          <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center">
            <Shield size={20} className="text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-foreground tracking-tight">
              AgencyOps
            </h1>
            <p className="text-[10px] text-muted-foreground uppercase tracking-widest">
              Operations Platform
            </p>
          </div>
        </div>
        <Card className="p-6 gap-4 border-border">{children}</Card>
      </div>
    </div>
  );
}

/** A live pass/fail hint, not a validation message — hence no error styling. */
function Rule({ met, children }: { met: boolean; children: React.ReactNode }) {
  return (
    <li
      className={cn(
        'flex items-center gap-1.5 text-xs',
        met ? 'text-success' : 'text-muted-foreground',
      )}
    >
      {met ? <Check size={12} /> : <X size={12} />}
      {children}
    </li>
  );
}

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
 * Styling deliberately mirrors `LoginPage` — these are the two pages a person
 * sees before they are anybody, and they should look like one product. Both
 * share {@link AuthShell}; if PAC-5 restyles login, move that component into a
 * shared location rather than letting the two drift.
 */
export default function AcceptInvitePage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const navigate = useNavigate();
  const { adoptSession } = useAuth();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [reveal, setReveal] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const inviteQuery = useQuery({
    queryKey: ['invite', token],
    queryFn: () => getInvitePreview(token),
    enabled: !!token,
    // A bad or expired token will never become good by asking again, and each
    // retry delays the error state the invitee actually needs to read.
    retry: false,
    staleTime: Infinity,
  });

  const longEnough = password.length >= MIN_PASSWORD_LENGTH;
  const matches = password.length > 0 && password === confirm;
  const canSubmit = longEnough && matches && !submitting;

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

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitError(null);
    setSubmitting(true);
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
    } finally {
      setSubmitting(false);
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
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
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

        <FormError>{submitError}</FormError>

        {/*
          Present but not rendered, purely so password managers file the saved
          credential under the right account instead of prompting for a username
          on the next sign-in. `autocomplete="username"` next to
          `new-password` is the pairing browsers look for.
        */}
        <input
          type="text"
          name="username"
          autoComplete="username"
          value={invite.email}
          readOnly
          hidden
          aria-hidden="true"
          tabIndex={-1}
        />

        <div className="space-y-1.5">
          <Label
            htmlFor="invite-password"
            className="text-xs text-muted-foreground"
          >
            Password
          </Label>
          <div className="relative">
            <Input
              id="invite-password"
              type={reveal ? 'text' : 'password'}
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="bg-input border-border pr-10"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setReveal((v) => !v)}
              className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={reveal ? 'Hide password' : 'Show password'}
              aria-pressed={reveal}
            >
              {reveal ? <EyeOff size={14} /> : <Eye size={14} />}
            </Button>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label
            htmlFor="invite-confirm"
            className="text-xs text-muted-foreground"
          >
            Confirm password
          </Label>
          <Input
            id="invite-confirm"
            type={reveal ? 'text' : 'password'}
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="bg-input border-border"
          />
        </div>

        <ul className="space-y-1">
          <Rule met={longEnough}>
            At least {MIN_PASSWORD_LENGTH} characters
          </Rule>
          <Rule met={matches}>Both passwords match</Rule>
        </ul>

        <Button
          type="submit"
          variant="brand"
          disabled={!canSubmit}
          className="w-full"
        >
          {submitting ? 'Setting your password…' : 'Set password and sign in'}
        </Button>

        <p className="text-[10px] text-muted-foreground text-center pt-2">
          This link expires on{' '}
          {new Date(invite.expiresAt).toLocaleDateString()}.
        </p>
      </form>
    </AuthShell>
  );
}
