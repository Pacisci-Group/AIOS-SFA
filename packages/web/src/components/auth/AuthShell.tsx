import { Shield } from 'lucide-react';
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
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
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
