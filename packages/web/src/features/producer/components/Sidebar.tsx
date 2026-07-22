import {
  LayoutDashboard,
  Users,
  Mail,
  TrendingUp,
  ChevronRight,
  Shield,
  LogOut,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { ModuleKey } from "@sfa/shared";
import { useAuth } from "@/contexts/auth-context";
import { usePermissions } from "@/hooks/usePermissions";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

const navItems: { icon: LucideIcon; label: string; module: ModuleKey }[] = [
  { icon: LayoutDashboard, label: "Dashboard", module: ModuleKey.Dashboard },
  { icon: Users, label: "Leads", module: ModuleKey.Leads },
  { icon: Mail, label: "Mailers", module: ModuleKey.Mailers },
  { icon: TrendingUp, label: "My Performance", module: ModuleKey.Performance },
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

export function Sidebar() {
  const [activeItem, setActiveItem] = useState("Dashboard");
  const { user, logout } = useAuth();
  const { canRead, can } = usePermissions();

  const visibleNavItems = navItems.filter((item) => canRead(item.module));

  const displayName = user?.name?.trim() || nameFromEmail(user?.email);
  const roleLabel = user?.roles?.[0] ?? "Member";
  const canManageUsers = can("agency:users:read");

  return (
    <aside className="w-[260px] min-h-screen flex flex-col shrink-0 bg-sidebar border-r border-sidebar-border">
      {/* Logo */}
      <div className="px-6 py-5 flex items-center gap-3 border-b border-sidebar-border">
        <div className="w-8 h-8 rounded flex items-center justify-center shrink-0 bg-primary">
          <Shield size={16} className="text-primary-foreground" />
        </div>
        <div>
          <p className="text-foreground text-sm leading-tight font-bold tracking-[0.01em]">
            ALLSTATE
          </p>
          <p className="text-[10px] text-muted-foreground leading-tight uppercase tracking-widest">
            Agency Portal
          </p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-5 flex flex-col gap-1">
        <p className="text-[10px] text-muted-foreground uppercase tracking-widest px-3 mb-2">
          Sales Tools
        </p>
        {visibleNavItems.map(({ icon: Icon, label }) => {
          const isActive = activeItem === label;
          return (
            <button
              key={label}
              onClick={() => setActiveItem(label)}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left transition-all duration-150 group",
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-slate-400 hover:text-slate-200 hover:bg-white/5",
              )}
            >
              <Icon
                size={16}
                className={cn(
                  "shrink-0 transition-colors",
                  isActive
                    ? "text-primary"
                    : "text-muted-foreground group-hover:text-slate-300",
                )}
              />
              <span className="text-sm flex-1">{label}</span>
              {isActive && <ChevronRight size={12} className="text-primary" />}
            </button>
          );
        })}
      </nav>

      {/* Bottom */}
      <div className="px-3 py-4 border-t border-sidebar-border">
        <div className="flex items-center gap-3 px-3 py-2 mb-2">
          <Avatar className="w-8 h-8">
            <AvatarFallback className="bg-blue-900 text-foreground text-xs font-bold">
              {initialsFromName(displayName)}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-foreground truncate font-medium">
              {displayName}
            </p>
            <p className="text-xs text-muted-foreground truncate">{roleLabel}</p>
          </div>
        </div>
        <div className="flex gap-1">
          {canManageUsers ? (
            <Link
              to="/settings/users"
              className="flex-1 flex items-center gap-2 px-3 py-2 rounded-md text-muted-foreground hover:text-slate-300 hover:bg-white/5 transition-all text-xs"
            >
              <Settings size={13} />
              Settings
            </Link>
          ) : (
            <button className="flex-1 flex items-center gap-2 px-3 py-2 rounded-md text-muted-foreground hover:text-slate-300 hover:bg-white/5 transition-all text-xs">
              <Settings size={13} />
              Settings
            </button>
          )}
          <button
            onClick={logout}
            className="flex items-center gap-2 px-3 py-2 rounded-md text-muted-foreground hover:text-slate-300 hover:bg-white/5 transition-all text-xs"
          >
            <LogOut size={13} />
          </button>
        </div>
      </div>
    </aside>
  );
}
