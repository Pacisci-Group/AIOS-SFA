import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { MobileNav } from '@/components/layout/MobileNav';
import { Button } from '@/components/ui/button';

/**
 * The shared shell for the agency settings pages.
 *
 * Extracted rather than copied three times: the header on `UsersPage` is
 * already the fourth instance of this exact markup, and the white-label work
 * would have made it seven. Same structure, same spacing, same back button —
 * changing it once should change it everywhere.
 */
export function SettingsPage({
  title,
  caption,
  icon: Icon,
  action,
  children,
}: {
  title: string;
  caption: string;
  icon: LucideIcon;
  action?: ReactNode;
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
            <Link to="/" aria-label="Back">
              <ArrowLeft size={16} />
            </Link>
          </Button>
          <div className="hidden size-8 shrink-0 items-center justify-center rounded-lg bg-primary sm:flex">
            <Icon size={16} className="text-primary-foreground" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-bold">{title}</h1>
            <p className="truncate text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {caption}
            </p>
          </div>
        </div>
        {action && (
          <div className="flex shrink-0 items-center gap-3">{action}</div>
        )}
      </header>

      <main className="mx-auto w-full max-w-3xl px-4 py-8 md:px-6">
        {children}
      </main>
    </AppShell>
  );
}
