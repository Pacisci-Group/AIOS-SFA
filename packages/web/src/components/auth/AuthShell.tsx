import type { ReactNode } from 'react';
import { BrandLockup } from '@/components/common/BrandMark';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * The centred, branded card every pre-session page renders inside.
 *
 * Extracted from `AcceptInvitePage` when the password-reset page (PAC-79)
 * became its second consumer — which is exactly what that page's docblock said
 * to do rather than let two copies drift. These are the pages a person sees
 * before they are anybody, and they should look like one product.
 *
 * `LoginPage` held a third, inline copy of this markup until PAC-92; the ⚠ that
 * used to be here saying so is discharged.
 *
 * ## Composed from the `Card` primitive's own parts
 *
 * This was `<Card className="p-6 gap-4">` with every page hand-rolling an
 * `<h2 className="text-foreground font-semibold text-base">` inside it — a
 * heading tier belonging to no row of `styles/TYPOGRAPHY.md`, repeated ten
 * times across five pages. It is now the documented anatomy —
 * `CardHeader > CardTitle + CardDescription`, then `CardContent`, then
 * `CardFooter` — so the padding, the gaps and the description colour come from
 * the primitive instead of from five sets of overrides.
 *
 * `title` is rendered at the **page-title** tier (`text-lg tracking-tight`)
 * rather than the card-title tier, because on these pages the card *is* the
 * page: there is no `<h1>` above it to be subordinate to.
 *
 * The masthead is `BrandLockup`, not a hardcoded wordmark: these pages are
 * reached on the agency's own hostname, so the invitee must see the agency they
 * are joining rather than the platform name.
 */
export function AuthShell({
  title,
  description,
  footer,
  children,
  width = 'sm',
}: {
  /**
   * The card's heading. Optional — the transient states (a spinner while a
   * token is checked) have nothing to title yet, and a heading that appears for
   * 200ms then changes is worse than none.
   */
  title?: ReactNode;
  /** Sub-heading under the title. Prose about the state, not a field hint. */
  description?: ReactNode;
  /** Secondary actions under a separating rule — "Forgot password?", "Back to sign in". */
  footer?: ReactNode;
  children: ReactNode;
  /**
   * `sm` is the sign-in-sized card every page here started as, and stays the
   * default. `md` is for the agency-owner onboarding wizard (PAC-69), whose
   * branding step carries three upload rows and a two-column preview — at
   * `max-w-md` that renders as a column of slivers.
   */
  width?: 'sm' | 'md';
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className={cn('w-full', width === 'md' ? 'max-w-2xl' : 'max-w-md')}>
        <BrandLockup size="md" className="mb-8 justify-center" />

        <Card className="border-border">
          {title && (
            <CardHeader>
              <CardTitle className="text-lg tracking-tight">{title}</CardTitle>
              {description && <CardDescription>{description}</CardDescription>}
            </CardHeader>
          )}

          {/*
            `gap-4` is the stacking every page here was written against when the
            card itself supplied it. Kept on the content slot so migrating to
            the Card parts reflowed nothing.
          */}
          <CardContent className="flex flex-col gap-4">{children}</CardContent>

          {footer && (
            <CardFooter className="justify-center border-t">
              {footer}
            </CardFooter>
          )}
        </Card>
      </div>
    </div>
  );
}
