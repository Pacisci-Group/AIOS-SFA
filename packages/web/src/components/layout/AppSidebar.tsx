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
  type LucideIcon,
} from "lucide-react";
import { NavLink, useNavigate } from "react-router-dom";
import { ModuleKey } from "@sfa/shared";
import { useAuth } from "@/contexts/auth-context";
import { usePermissions } from "@/hooks/usePermissions";

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
        to: "/leads/demo",
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
        module: ModuleKey.Clients,
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

export function AppSidebar() {
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
    logout();
    navigate("/login", { replace: true });
  };

  return (
    <aside
      style={{ background: "#0D1B3E", borderRight: "1px solid rgba(255,255,255,0.06)" }}
      className="w-[260px] min-h-screen flex flex-col shrink-0 sticky top-0 h-screen"
    >
      {/* Logo */}
      <div
        className="px-6 py-5 flex items-center gap-3"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
      >
        <div
          className="w-8 h-8 rounded flex items-center justify-center shrink-0"
          style={{ background: "#38BDF8" }}
        >
          <Shield size={16} className="text-[#0B0F19]" />
        </div>
        <div>
          <p
            className="text-[#E2E8F0] text-sm leading-tight"
            style={{ fontWeight: 700, letterSpacing: "0.01em" }}
          >
            AgencyOps
          </p>
          <p className="text-[10px] text-[#64748B] leading-tight uppercase tracking-widest">
            Agency Portal
          </p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-5 flex flex-col gap-4 overflow-y-auto">
        {visibleSections.map((section) => (
          <div key={section.title} className="flex flex-col gap-1">
            <p className="text-[10px] text-[#64748B] uppercase tracking-widest px-3 mb-1">
              {section.title}
            </p>
            {section.items.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left transition-all duration-150 group"
                style={({ isActive }) => ({
                  background: isActive ? "rgba(56,189,248,0.12)" : "transparent",
                  color: isActive ? "#38BDF8" : "#94A3B8",
                })}
              >
                {({ isActive }) => (
                  <>
                    <Icon
                      size={16}
                      style={{ color: isActive ? "#38BDF8" : "#64748B" }}
                      className="shrink-0 transition-colors"
                    />
                    <span className="text-sm flex-1">{label}</span>
                    {isActive && <ChevronRight size={12} style={{ color: "#38BDF8" }} />}
                  </>
                )}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      {/* Bottom */}
      <div className="px-3 py-4" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="flex items-center gap-3 px-3 py-2 mb-2">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs"
            style={{ background: "#1A3A8F", color: "#E2E8F0", fontWeight: 700 }}
          >
            {initialsFromName(displayName)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-[#E2E8F0] truncate" style={{ fontWeight: 500 }}>
              {displayName}
            </p>
            <p className="text-xs text-[#64748B] truncate">{roleLabel}</p>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-[#64748B] hover:text-[#94A3B8] hover:bg-white/5 transition-all text-xs"
        >
          <LogOut size={13} />
          Log out
        </button>
      </div>
    </aside>
  );
}
