import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { LogOut, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { useAuth } from "@/contexts/auth-context";
import { cn } from "@/lib/utils";
import { PANEL_AREAS } from "./panel-areas";

/**
 * Chrome for the Super Admin panel (PAC-73).
 *
 * ⚠ **A placeholder that PAC-68 replaces.** It is a header, a menu and a
 * container; keep it that way. Everything real about the panel — the agency
 * directory, onboarding, impersonation — is a separate story, and the more this
 * grows the more of it has to be unpicked rather than deleted.
 *
 * It deliberately does **not** use `AppShell`/`AppSidebar`. Those are the
 * tenant app's chrome, gated on module entitlements a platform operator does
 * not have; reusing them would render an empty sidebar and, worse, make the two
 * surfaces look the same.
 */
export function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const location = useLocation();

  useSuperAdminTheme();

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="hidden w-[224px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
        <div className="flex items-center gap-2 px-4 py-4">
          <ShieldCheck className="size-5 text-sidebar-primary" />
          <span className="text-sm font-semibold tracking-tight">Platform</span>
        </div>
        <nav className="flex flex-col gap-0.5 px-2">
          {PANEL_AREAS.map((area) => {
            const active = area.to && location.pathname.startsWith(area.to);
            // A disabled area renders as a non-interactive row rather than
            // being hidden: the shape of the product should read at a glance,
            // and nothing here navigates somewhere it cannot go.
            return area.to ? (
              <Button
                key={area.key}
                asChild
                variant="ghost"
                className={cn(
                  "h-9 justify-start gap-2 px-2 text-sm",
                  active && "bg-sidebar-accent text-sidebar-accent-foreground",
                )}
              >
                <Link to={area.to}>
                  <area.icon className="size-4" />
                  {area.label}
                </Link>
              </Button>
            ) : (
              <div
                key={area.key}
                aria-disabled
                className="flex h-9 items-center gap-2 rounded-md px-2 text-sm text-muted-foreground/60"
              >
                <area.icon className="size-4" />
                <span className="truncate">{area.label}</span>
              </div>
            );
          })}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/*
          A persistent header, so the distinction survives a screenshot — a
          neutral palette alone is deniable in a bug report, a "Platform" badge
          next to the operator's name is not.
        */}
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-4 md:px-6">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-primary md:hidden" />
            <h1 className="text-lg font-semibold tracking-tight">
              Super Admin
            </h1>
            <Badge size="sm" variant="secondary">
              Platform
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {user?.name ?? user?.email}
            </span>
            <ThemeToggle />
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={logout}
              aria-label="Log out"
            >
              <LogOut className="size-4" />
            </Button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-5xl px-4 py-8 md:px-6">
          {children}
        </main>
      </div>
    </div>
  );
}

/**
 * Scope the panel's palette for as long as the panel is mounted.
 *
 * On `<html>` rather than on the layout root because Radix portals and the
 * sonner `Toaster` mount into `document.body` — outside any React root — so a
 * root-scoped class would leave every modal, dropdown and toast in the panel
 * rendering in the tenant theme. Removing it on unmount is what keeps
 * navigating back to a tenant page from carrying the neutral palette with it.
 *
 * `next-themes` keeps owning the `light`/`dark` class independently; this only
 * adds a third.
 */
function useSuperAdminTheme(): void {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("super-admin");
    return () => root.classList.remove("super-admin");
  }, []);
}
