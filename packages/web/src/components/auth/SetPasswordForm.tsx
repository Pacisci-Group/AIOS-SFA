import { FormEvent, useState } from 'react';
import { Check, Eye, EyeOff, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FormError } from '@/components/form';
import { cn } from '@/lib/utils';

/**
 * Must match `@MinLength(8)` on both `AcceptInviteDto` and `ResetPasswordDto`
 * in the API. Kept as a named constant so the pairing is obvious — if the
 * server rule is tightened, this is the line to change with it, or the form
 * will happily submit passwords the API then rejects.
 */
export const MIN_PASSWORD_LENGTH = 8;

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

interface SetPasswordFormProps {
  /**
   * The account the password is being set for. Not collected — the token in the
   * URL already determines it — but written into the hidden username field so
   * password managers file the credential correctly.
   */
  email: string;
  /** Distinguishes this form's input ids from anything else on the page. */
  idPrefix: string;
  submitLabel: string;
  pendingLabel: string;
  /** Rendered above the fields. The caller owns error mapping. */
  error?: string | null;
  /**
   * Called with the chosen password. **Must not reject** — the caller catches
   * and surfaces through `error`, and this component only uses the promise to
   * know when to stop showing the pending state.
   */
  onSubmit: (password: string) => Promise<void>;
  /** Small print under the button, e.g. when the link expires. */
  footer?: React.ReactNode;
}

/**
 * Choose and confirm a password from an emailed link.
 *
 * Shared by the accept-invite (PAC-58) and password-reset (PAC-79) pages, which
 * are the same form with different copy around it.
 *
 * Deliberately hand-rolled `useState` rather than `useAppForm`: there is no
 * `PasswordField` in `components/form/fields/` — `TextField`'s `type` union
 * excludes `password` on purpose — so going through TanStack Form would mean
 * inventing a field component for these two screens alone. The rest of the app's
 * forms are unaffected by that choice; this one matches `LoginPage`.
 */
export function SetPasswordForm({
  email,
  idPrefix,
  submitLabel,
  pendingLabel,
  error,
  onSubmit,
  footer,
}: SetPasswordFormProps) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [reveal, setReveal] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const longEnough = password.length >= MIN_PASSWORD_LENGTH;
  const matches = password.length > 0 && password === confirm;
  const canSubmit = longEnough && matches && !submitting;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    try {
      await onSubmit(password);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <FormError>{error}</FormError>

      {/*
        Present but not rendered, purely so password managers file the saved
        credential under the right account instead of prompting for a username
        on the next sign-in. `autocomplete="username"` next to `new-password`
        is the pairing browsers look for.
      */}
      <input
        type="text"
        name="username"
        autoComplete="username"
        value={email}
        readOnly
        hidden
        aria-hidden="true"
        tabIndex={-1}
      />

      <div className="space-y-1.5">
        <Label
          htmlFor={`${idPrefix}-password`}
          className="text-xs text-muted-foreground"
        >
          Password
        </Label>
        <div className="relative">
          <Input
            id={`${idPrefix}-password`}
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
          htmlFor={`${idPrefix}-confirm`}
          className="text-xs text-muted-foreground"
        >
          Confirm password
        </Label>
        <Input
          id={`${idPrefix}-confirm`}
          type={reveal ? 'text' : 'password'}
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="bg-input border-border"
        />
      </div>

      <ul className="space-y-1">
        <Rule met={longEnough}>At least {MIN_PASSWORD_LENGTH} characters</Rule>
        <Rule met={matches}>Both passwords match</Rule>
      </ul>

      <Button
        type="submit"
        variant="brand"
        disabled={!canSubmit}
        className="w-full"
      >
        {submitting ? pendingLabel : submitLabel}
      </Button>

      {footer && (
        <p className="text-[10px] text-muted-foreground text-center pt-2">
          {footer}
        </p>
      )}
    </form>
  );
}
