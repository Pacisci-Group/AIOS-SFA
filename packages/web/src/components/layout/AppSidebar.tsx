import {
  LayoutDashboard,
  Users,
  Ticket,
  Building2,
  BarChart3,
  LogOut,
  Shield,
  KeyRound,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { ModuleKey } from "@sfa/shared";
import { useAuth } from "@/contexts/auth-context";
import { usePermissions } from "@/hooks/usePermissions";
import { useSidebarCollapsed } from "@/hooks/useSidebarCollapsed";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { cn } from "@/lib/utils";

type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Module read permission required to see the item. */
  module?: ModuleKey;
  /** Exact permission string required (for `agency:*` admin capabilities). */
  permission?: string;
};

type NavSection = {
  title: string;
  items: NavItem[];
};

const NAV_SECTIONS: NavSection[] = [
  {
    title: "Sales",
    items: [
      {
        to: "/dashboard/producer",
        label: "Producer Dashboard",
        icon: LayoutDashboard,
        module: ModuleKey.Dashboard,
      },
      {
        to: "/leads",
        label: "Leads",
        icon: Users,
        module: ModuleKey.Leads,
      },
    ],
  },
  {
    title: "Management",
    items: [
      {
        to: "/dashboard/management",
        label: "Management Dashboard",
        icon: BarChart3,
        module: ModuleKey.Management,
      },
      {
        to: "/dashboard/management-alt",
        label: "Management (Alt)",
        icon: BarChart3,
        module: ModuleKey.Management,
      },
    ],
  },
  {
    title: "Service & CRM",
    items: [
      {
        to: "/crm/service",
        label: "Service Dashboard",
        icon: Ticket,
        module: ModuleKey.CrmService,
      },
      {
        to: "/crm/tickets",
        label: "Ticket Workspace",
        icon: Ticket,
        module: ModuleKey.CrmService,
      },
      {
        to: "/clients/demo",
        label: "Households",
        icon: Building2,
        /*
         * Gated on `crm_service`, not `clients` (PAC-38).
         *
         * `/clients/demo` is still the unwired Household Details mockup. PAC-38
         * added `clients:write` to the Producer template so a producer can edit
         * their own lead's contact — which, under the original `clients` gate,
         * would have put a fake "Cobb Household" page in every producer's
         * sidebar as a side effect of an unrelated grant.
         *
         * `crm_service` preserves exactly today's audience: Agency Owner (via
         * `grantsAllEnabledModules`), Branch Manager and CRM all hold it, and no
         * producer does. Move this back to `ModuleKey.Clients` once the page is
         * real (PAC-19).
         */
        module: ModuleKey.CrmService,
      },
    ],
  },
  {
    title: "Administration",
    items: [
      {
        to: "/settings/users",
        label: "Agency Users",
        icon: Users,
        permission: "agency:users:read",
      },
      {
        to: "/settings/roles",
        label: "Roles & Permissions",
        icon: KeyRound,
        permission: "agency:users:permissions",
      },
    ],
  },
];

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
 */
function RailTooltip({
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

export function AppSidebar() {
  const { user, logout } = useAuth();
  const { canRead, can } = usePermissions();
  const { collapsed, toggle } = useSidebarCollapsed();
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
    logout();
    navigate("/login", { replace: true });
  };

  return (
    /*
     * Collapsing is just this element's own width.
     *
     * Every page composes its own shell as `<div className="flex min-h-screen">
     * <AppSidebar/><main/></div>` — there is no shared layout route — so a
     * narrower `<aside>` reflows all eight host pages for free and none of them
     * needs to know this control exists.
     */
    <aside
      data-collapsed={collapsed}
      className={cn(
        "min-h-screen flex flex-col shrink-0 sticky top-0 h-screen bg-sidebar border-r border-sidebar-border transition-[width] duration-200 ease-out",
        collapsed ? "w-[68px]" : "w-[260px]",
      )}
    >
      {/* Logo + collapse toggle. Stacks on the rail, where 68px cannot hold
          the mark and the button side by side. */}
      <div
        className={cn(
          "flex border-b border-sidebar-border py-5",
          collapsed
            ? "flex-col items-center gap-3 px-2"
            : "flex-row items-center gap-3 px-5",
        )}
      >
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="size-8 rounded-md flex items-center justify-center shrink-0 bg-primary">
            <Shield className="size-4 text-primary-foreground" />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <p className="text-sidebar-accent-foreground text-base leading-tight font-bold tracking-[0.01em]">
                AgencyOps
              </p>
              <p className="text-xs text-muted-foreground leading-tight uppercase tracking-wide">
                Agency Portal
              </p>
            </div>
          )}
        </div>
        <RailTooltip
          collapsed={collapsed}
          label="Expand sidebar (⌘B)"
        >
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={toggle}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="shrink-0 text-muted-foreground hover:text-sidebar-accent-foreground"
          >
            {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </Button>
        </RailTooltip>
      </div>

      {/* Nav */}
      <nav
        className={cn(
          "flex-1 py-5 flex flex-col gap-4 overflow-y-auto overflow-x-hidden",
          collapsed ? "px-2" : "px-3",
        )}
      >
        {visibleSections.map((section, sectionIndex) => (
          <div key={section.title} className="flex flex-col gap-1">
            {collapsed ? (
              // A rule instead of a heading: the section titles don't fit on a
              // 68px rail, and truncating them to "Sal…" is worse than nothing.
              // The grouping is what carries meaning here, not the word.
              sectionIndex > 0 && (
                <div className="mx-2 mb-1 h-px bg-sidebar-border" />
              )
            ) : (
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-3 mb-1">
                {section.title}
              </p>
            )}
            {section.items.map(({ to, label, icon: Icon }) => (
              <RailTooltip key={to} collapsed={collapsed} label={label}>
                <NavLink
                  to={to}
                  end
                  className={({ isActive }) =>
                    cn(
                      "w-full flex items-center gap-3 py-2.5 rounded-md text-left transition-colors duration-150 group outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                      collapsed ? "justify-center px-0" : "px-3",
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "text-sidebar-foreground hover:text-sidebar-accent-foreground hover:bg-sidebar-accent",
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <Icon
                        className={cn(
                          "size-5 shrink-0 transition-colors",
                          isActive ? "text-primary" : "text-muted-foreground",
                        )}
                      />
                      {collapsed ? (
                        // The tooltip is not an accessible name — without this
                        // the rail is a column of unlabelled links.
                        <span className="sr-only">{label}</span>
                      ) : (
                        <>
                          <span className="text-base flex-1 truncate">
                            {label}
                          </span>
                          {isActive && (
                            <ChevronRight className="size-4 text-primary" />
                          )}
                        </>
                      )}
                    </>
                  )}
                </NavLink>
              </RailTooltip>
            ))}
          </div>
        ))}
      </nav>

      {/* Bottom */}
      <div
        className={cn(
          "py-4 border-t border-sidebar-border",
          collapsed ? "px-2" : "px-3",
        )}
      >
        <RailTooltip collapsed={collapsed} label={`${displayName} · ${roleLabel}`}>
          <div
            className={cn(
              "flex items-center gap-3 py-2 mb-2",
              collapsed ? "justify-center px-0" : "px-3",
            )}
          >
            <Avatar className="size-8">
              {/* The whole chip needs a light variant, not just the text: on the
                  light theme `text-foreground` is near-black, and blue-900 stays
                  dark whatever the theme, so recolouring only the text just
                  trades dark-on-dark for blue-on-blue. The `dark:` pair restores
                  the original treatment exactly. */}
              <AvatarFallback className="bg-sidebar-accent text-sidebar-accent-foreground dark:bg-blue-900 dark:text-foreground text-xs font-bold">
                {initialsFromName(displayName)}
              </AvatarFallback>
            </Avatar>
            {!collapsed && (
              <div className="flex-1 min-w-0">
                <p className="text-base text-sidebar-accent-foreground truncate font-medium">
                  {displayName}
                </p>
                <p className="text-sm text-muted-foreground truncate">
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
              "w-full flex items-center gap-2 py-2 rounded-md text-muted-foreground hover:text-sidebar-accent-foreground hover:bg-sidebar-accent transition-colors text-sm outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
              collapsed ? "justify-center px-0" : "px-3",
            )}
          >
            <LogOut className="size-4 shrink-0" />
            {!collapsed && "Log out"}
          </button>
        </RailTooltip>
      </div>
    </aside>
  );
}
