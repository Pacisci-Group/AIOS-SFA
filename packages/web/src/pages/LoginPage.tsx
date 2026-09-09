import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { z } from 'zod';
import { AuthShell } from '@/components/auth/AuthShell';
import { FormError } from '@/components/form';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/auth-context';
import { useAppForm } from '@/hooks/form';
import { ApiError } from '@/lib/api-client';

/**
 * Sign in.
 *
 * ## What this page is built from, and why
 *
 * It used to hand-roll all three layers: its own centred-card markup (a third
 * copy of `AuthShell`, whose docblock had been asking for this), a bare `Card`
 * with `p-6` and an `<h2 className="text-base">` standing in for the header
 * slots, and `useState` + raw `Input`/`Label` pairs with `text-xs` labels — so
 * the app's most-seen screen was the one place following none of its own
 * conventions.
 *
 * Now: `AuthShell` for the shell, the `Card` parts for the header, and
 * `useAppForm` + the shared field components for the form, which is what
 * AGENTS.md §11 asks of every form in the app. The visible payoff is that the
 * labels, focus rings, spacing and validation messages here are now literally
 * the same components as on every other form.
 *
 * `zod` earns its place rather than just satisfying the convention: `required`
 * plus `type="email"` left the browser to phrase the complaint, so a typo'd
 * address produced a native bubble on one machine and a round-trip 401 —
 * "Invalid credentials" for what is actually a malformed address — on another.
 *
 * ## Two things deliberately *not* here
 *
 * **"Forgot password?" sits in the footer, not beside the password label.**
 * shadcn's own login card puts it inline with `ml-auto` inside the label row,
 * but that nests an anchor inside a `<label>`, where a click both navigates and
 * activates the label's control. The footer is the same affordance without the
 * conflict.
 *
 * **The submit button stays inside the `<form>`,** not in `CardFooter`. In the
 * upstream example the footer button sits outside the form element it submits,
 * which only works there because nothing is listening for the submit event.
 */
const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'Email is required')
    .email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const form = useAppForm({
    defaultValues: { email: '', password: '' },
    validators: { onBlur: loginSchema },
    onSubmit: async ({ value }) => {
      setError(null);
      setLoading(true);
      try {
        await login(value.email.trim(), value.password);
        navigate('/', { replace: true });
      } catch (err) {
        // The server's message is shown as-is: it distinguishes bad
        // credentials from a deactivated account, and the second one is
        // something the person needs to hear rather than retry.
        setError(err instanceof ApiError ? err.message : 'Login failed');
      } finally {
        setLoading(false);
      }
    },
  });

  return (
    <AuthShell
      title="Sign in"
      description="Enter your email and password to reach your agency."
      footer={
        <Link
          to="/auth/forgot-password"
          className="text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
        >
          Forgot password?
        </Link>
      }
    >
      <form.AppForm>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
          className="flex flex-col gap-4"
          noValidate
        >
          <FormError>{error}</FormError>

          <form.AppField name="email">
            {(f) => (
              <f.TextField
                label="Email"
                type="email"
                autoComplete="email"
                placeholder="you@agency.com"
                inputClassName="bg-input border-border"
              />
            )}
          </form.AppField>

          <form.AppField name="password">
            {(f) => (
              <f.TextField
                label="Password"
                type="password"
                autoComplete="current-password"
                inputClassName="bg-input border-border"
              />
            )}
          </form.AppField>

          <Button
            type="submit"
            variant="brand"
            disabled={loading}
            className="mt-1 w-full"
          >
            {loading && <Loader2 className="size-4 animate-spin" />}
            {loading ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </form.AppForm>
    </AuthShell>
  );
}
