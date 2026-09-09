import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { MobileNav } from '@/components/layout/MobileNav';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * The shared shell for the agency settings pages.
 *
 * Extracted rather than copied three times: the header on `UsersPage` is
 * already the fourth instance of this exact markup, and the white-label work
 * would have made it seven. Same structure, same spacing, same back button —
 * changing it once should change it everywhere.
 *
 * ## The header is the Leads header
 *
 * Title and caption follow `styles/TYPOGRAPHY.md` exactly — `text-lg
 * font-semibold tracking-tight` over a `text-xs` uppercase caption, the same
 * two lines `/leads` and `/leads/:id` render. They previously used `text-sm
 * font-bold`, a *third* tier that existed nowhere else in the app, which is why
 * these pages read as a different product: the page title was smaller than the
 * body copy underneath it.
 */
export function SettingsPage({
  title,
  caption,
  icon: Icon,
  action,
  /**
   * Where the back arrow goes. Defaults to the workspace-settings hub, which is
   * where every one of these pages is now reached from; the personal profile
   * page passes `/` because it is not part of the workspace.
   */
  backTo = '/settings',
  /**
   * `narrow` (default) is the reading measure for forms and prose — the width
   * every white-label page wants. `wide` fills the viewport for pages whose
   * content is a table: `max-w-3xl` put an 11-row directory in a column with
   * two-thirds of a 1920px screen empty beside it.
   */
  width = 'narrow',
  children,
}: {
  title: string;
  caption: string;
  icon: LucideIcon;
  action?: ReactNode;
  backTo?: string;
  width?: 'narrow' | 'wide';
  children: ReactNode;
}) {
  return (
    <AppShell>
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-4 md:px-6">
        <div className="flex min-w-0 items-center gap-2 md:gap-3">
          <MobileNav className="-ml-1" />
          <Button
            asChild
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-foreground"
          >
            <Link to={backTo} aria-label="Back">
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <div className="hidden size-8 shrink-0 items-center justify-center rounded-lg bg-primary sm:flex">
            <Icon className="size-4 text-primary-foreground" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold tracking-tight">
              {title}
            </h1>
            <p className="truncate text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {caption}
            </p>
          </div>
        </div>
        {action && (
          <div className="flex shrink-0 items-center gap-2">{action}</div>
        )}
      </header>

      <main
        className={cn(
          'w-full px-4 py-6 md:px-6',
          width === 'narrow' && 'mx-auto max-w-3xl py-8',
        )}
      >
        {children}
      </main>
    </AppShell>
  );
}
