import { BrandLockup } from '@/components/common/BrandMark';
import { Card } from '@/components/ui/card';

/**
 * The centred, branded card every pre-session page renders inside.
 *
 * Extracted from `AcceptInvitePage` when the password-reset page (PAC-79)
 * became its second consumer — which is exactly what that page's docblock said
 * to do rather than let two copies drift. These are the pages a person sees
 * before they are anybody, and they should look like one product.
 *
 * ⚠ `LoginPage` still holds a third, inline copy of this markup. Folding it in
 * is worth doing, but not inside a password-reset change: restyling the sign-in
 * page is risk with no payoff here.
 *
 * The masthead is `BrandLockup`, not a hardcoded wordmark: these pages are
 * reached on the agency's own hostname, so the invitee must see the agency they
 * are joining rather than the platform name.
 */
export function AuthShell({
  children,
  width = 'sm',
}: {
  children: React.ReactNode;
  /**
   * `sm` is the sign-in-sized card every page here started as, and stays the
   * default. `md` is for the agency-owner onboarding wizard (PAC-69), whose
   * branding step carries three upload rows and a two-column preview — at
   * `max-w-md` that renders as a column of slivers.
   */
  width?: 'sm' | 'md';
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-10">
      <div className={width === 'md' ? 'w-full max-w-2xl' : 'w-full max-w-md'}>
        <BrandLockup size="md" className="mb-8 justify-center" />
        <Card className="p-6 gap-4 border-border">{children}</Card>
      </div>
    </div>
  );
}
