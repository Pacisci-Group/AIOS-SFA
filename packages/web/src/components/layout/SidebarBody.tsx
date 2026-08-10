import { LogOut, Shield } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/auth-context";
import { usePermissions } from "@/hooks/usePermissions";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { cn } from "@/lib/utils";
import { isNavItemActive, NAV_SECTIONS, type NavItem } from "./nav-items";

function nameFromEmail(email: string | undefined): string {
  if (!email) return "User";
  const handle = email.split("@")[0] ?? "";
  return handle
    .split(/[._-]/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

function initialsFromName(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  const letters = (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "");
  return (letters || name.slice(0, 2) || "U").toUpperCase();
}

/**
 * Wraps a control in a tooltip only while the rail is collapsed.
 *
 * Rendering `Tooltip` unconditionally and relying on the label being visible
 * would double up the accessible name and pop a redundant bubble on every nav
 * item in the expanded sidebar. `TooltipProvider` is mounted globally in
 * `App.tsx`, so there is none here.
 *
 * ⚠ Anything passed as `children` must take a **string** `className`. Radix's
 * `asChild` merges the trigger's props into the child through `Slot`, which
 * joins the two class values — so a function `className` (the `NavLink` render
 * prop) gets `toString()`-ed and its own source code lands in the `class`
 * attribute. That is exactly the bug that made the collapsed rail render with
 * both branches' classes applied at once; see `SidebarNavItem` below for the
 * shape that avoids it.
 */
export function RailTooltip({
  collapsed,
  label,
  children,
}: {
  collapsed: boolean;
  label: string;
  children: ReactNode;
}) {
  if (!collapsed) return <>{children}</>;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

/** The shield mark, and the wordmark when there is room for it. */
export function SidebarBrand({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2.5">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary">
        <Shield className="size-4 text-primary-foreground" />
      </div>
      {!collapsed && (
        <div className="min-w-0">
          <p className="text-sm leading-tight font-bold tracking-[0.01em] text-sidebar-accent-foreground">
            AgencyOps
          </p>
          <p className="text-xs leading-tight tracking-wide text-muted-foreground uppercase">
            Agency Portal
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * One nav row.
 *
 * A plain `Link` with a computed `isActive` rather than `NavLink`'s render-prop
 * `className`: the collapsed rail wraps this in a tooltip trigger, and a
 * function `className` cannot survive that (see `RailTooltip`). Computing the
 * match here also lets a detail route keep its parent lit — `isNavItemActive`.
 */
function SidebarNavItem({
  item,
  collapsed,
  onNavigate,
}: {
  item: NavItem;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const { pathname } = useLocation();
  const isActive = isNavItemActive(pathname, item.to);
  const Icon = item.icon;

  return (
    <RailTooltip collapsed={collapsed} label={item.label}>
      <Link
        to={item.to}
        onClick={onNavigate}
        aria-current={isActive ? "page" : undefined}
        className={cn(
          "group flex w-full items-center gap-2.5 rounded-md py-2 text-left outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-sidebar-ring",
          collapsed ? "justify-center px-0" : "px-2.5",
          isActive
            ? "bg-primary/10 text-primary"
            : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        )}
      >
        <Icon
          className={cn(
            "size-4 shrink-0 transition-colors",
            isActive ? "text-primary" : "text-muted-foreground",
          )}
        />
        {collapsed ? (
          // The tooltip is not an accessible name — without this the rail is a
          // column of unlabelled links.
          <span className="sr-only">{item.label}</span>
        ) : (
          // No active-state chevron. It duplicated what the filled background
          // and primary text already say, and the 26px it took was the
          // difference between "Producer Dashboard" fitting and reading
          // "Producer Dashbo…" on the one row that is always selected.
          <span className="flex-1 truncate text-base">{item.label}</span>
        )}
      </Link>
    </RailTooltip>
  );
}

interface SidebarBodyProps {
  /** Icon-rail mode. Always `false` inside the mobile sheet. */
  collapsed?: boolean;
  /** Called after any navigation — the mobile sheet closes itself on it. */
  onNavigate?: () => void;
}

/**
 * Everything below the sidebar's own header: the permission-filtered nav, the
 * user chip, the theme switch and log out.
 *
 * Shared verbatim by the desktop rail (`AppSidebar`) and the mobile drawer
 * (`MobileNav`) so the two can't drift — the drawer is the same sidebar, just
 * always expanded and rendered in a `Sheet`.
 */
export function SidebarBody({
  collapsed = false,
  onNavigate,
}: SidebarBodyProps) {
  const { user, logout } = useAuth();
  const { canRead, can } = usePermissions();
  const navigate = useNavigate();

  const isVisible = (item: NavItem) => {
    if (item.permission) return can(item.permission);
    if (item.module) return canRead(item.module);
    return true;
  };

  const visibleSections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter(isVisible),
  })).filter((section) => section.items.length > 0);

  const displayName = user?.name?.trim() || nameFromEmail(user?.email);
  const roleLabel = user?.roles?.[0] ?? "Member";

  const handleLogout = () => {
    onNavigate?.();
    logout();
    navigate("/login", { replace: true });
  };

  return (
    <>
      <nav
        className={cn(
          "flex flex-1 flex-col gap-3 overflow-x-hidden overflow-y-auto py-4",
          collapsed ? "px-2" : "px-2.5",
        )}
      >
        {visibleSections.map((section, sectionIndex) => (
          <div key={section.title} className="flex flex-col gap-0.5">
            {collapsed ? (
              // A rule instead of a heading: the section titles don't fit on the
              // rail, and truncating them to "Sal…" is worse than nothing. The
              // grouping is what carries meaning here, not the word.
              sectionIndex > 0 && (
                <div className="mx-2 mb-1 h-px bg-sidebar-border" />
              )
            ) : (
              <p className="mb-1 px-2.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {section.title}
              </p>
            )}
            {section.items.map((item) => (
              <SidebarNavItem
                key={item.to}
                item={item}
                collapsed={collapsed}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        ))}
      </nav>

      <div
        className={cn(
          "border-t border-sidebar-border py-3",
          collapsed ? "px-2" : "px-2.5",
        )}
      >
        <RailTooltip
          collapsed={collapsed}
          label={`${displayName} · ${roleLabel}`}
        >
          <div
            className={cn(
              "mb-1 flex items-center gap-2.5 py-1.5",
              collapsed ? "justify-center px-0" : "px-2.5",
            )}
          >
            <Avatar className="size-8">
              {/* The whole chip needs a light variant, not just the text: on the
                  light theme `text-foreground` is near-black, and blue-900 stays
                  dark whatever the theme, so recolouring only the text just
                  trades dark-on-dark for blue-on-blue. The `dark:` pair restores
                  the original treatment exactly. */}
              <AvatarFallback className="bg-sidebar-accent text-xs font-bold text-sidebar-accent-foreground dark:bg-blue-900 dark:text-foreground">
                {initialsFromName(displayName)}
              </AvatarFallback>
            </Avatar>
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-sidebar-accent-foreground">
                  {displayName}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {roleLabel}
                </p>
              </div>
            )}
          </div>
        </RailTooltip>

        <ThemeToggle collapsed={collapsed} />

        <RailTooltip collapsed={collapsed} label="Log out">
          <button
            onClick={handleLogout}
            aria-label="Log out"
            className={cn(
              "flex w-full items-center gap-2.5 rounded-md py-2 text-sm text-muted-foreground outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring",
              collapsed ? "justify-center px-0" : "px-2.5",
            )}
          >
            <LogOut className="size-4 shrink-0" />
            {!collapsed && "Log out"}
          </button>
        </RailTooltip>
      </div>
    </>
  );
}
