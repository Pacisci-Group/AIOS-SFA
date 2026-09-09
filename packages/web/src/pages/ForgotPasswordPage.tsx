import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { AuthShell } from '@/components/auth/AuthShell';
import { FormError } from '@/components/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api-client';
import { requestPasswordReset } from '@/lib/password-reset-api';

/**
 * The self-service "Forgot password?" request (PAC-81).
 *
 * **Public, and routed outside both `ProtectedRoute` and `PublicOnlyRoute`**,
 * same placement as `ResetPasswordPage` — the population this serves cannot
 * sign in, and an owner checking the flow while signed in must not be bounced.
 *
 * The success state is the same whatever was typed: the API answers an
 * identical `202` for unknown addresses on purpose, so this page has nothing
 * account-specific to show and must not invent anything. The only real errors
 * are network trouble and the rate limit.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await requestPasswordReset(email.trim());
      setSent(true);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 429
          ? 'Too many requests — wait a minute and try again.'
          : 'Could not send the request. Check your connection and try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <AuthShell
        title="Check your email"
        description={
          <>
            If an account exists for{' '}
            <span className="text-foreground">{email.trim()}</span>, a password
            reset link is on its way. The link is valid for a limited time and
            can only be used once.
          </>
        }
      >
        <Button asChild variant="outline" className="w-full">
          <Link to="/login">Back to sign in</Link>
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Reset your password"
      description="Enter the email you sign in with and we’ll send you a link to set a new password."
      footer={
        <Link
          to="/login"
          className="text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
        >
          Back to sign in
        </Link>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <FormError>{error}</FormError>

        <div className="space-y-1.5">
          <Label htmlFor="forgot-email">Email</Label>
          <Input
            id="forgot-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="bg-input border-border"
          />
        </div>

        <Button
          type="submit"
          variant="brand"
          disabled={submitting || !email.trim()}
          className="w-full"
        >
          {submitting ? 'Sending…' : 'Send reset link'}
        </Button>
      </form>
    </AuthShell>
  );
}
