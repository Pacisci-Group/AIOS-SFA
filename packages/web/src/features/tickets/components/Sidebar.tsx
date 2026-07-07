import {
  LayoutDashboard,
  Ticket,
  Users,
  FileText,
  Settings,
  Bell,
  LogOut,
  ChevronRight,
} from "lucide-react";

interface SidebarProps {
  activeSection: string;
  onNav: (s: string) => void;
}

const NAV = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "tickets", label: "Tickets", icon: Ticket, active: true },
  { id: "clients", label: "Clients", icon: Users },
  { id: "policies", label: "Policies", icon: FileText },
];

export function Sidebar({ activeSection, onNav }: SidebarProps) {
  return (
    <div className="w-52 shrink-0 flex flex-col h-full bg-[var(--sidebar)] border-r border-[var(--sidebar-border)]">
      {/* Brand */}
      <div className="px-4 py-4 border-b border-[var(--sidebar-border)]">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-[var(--kpi-blue)] flex items-center justify-center">
            <span className="text-white text-xs font-bold">IQ</span>
          </div>
          <div>
            <p className="text-xs font-semibold text-[var(--sidebar-accent-foreground)] leading-tight">
              InsureQ Agency
            </p>
            <p className="text-[10px] text-[var(--sidebar-foreground)] opacity-60 leading-tight">
              Service Portal
            </p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 space-y-0.5">
        {NAV.map(({ id, label, icon: Icon }) => {
          const isActive = activeSection === id;
          return (
            <button
              key={id}
              onClick={() => onNav(id)}
              className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-left transition-colors group ${
                isActive
                  ? "bg-[var(--sidebar-primary)] text-[var(--sidebar-primary-foreground)]"
                  : "text-[var(--sidebar-foreground)] hover:bg-[var(--sidebar-accent)] hover:text-[var(--sidebar-accent-foreground)]"
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="text-sm">{label}</span>
              {isActive && <ChevronRight className="w-3.5 h-3.5 ml-auto opacity-70" />}
            </button>
          );
        })}
      </nav>

      {/* Bottom */}
      <div className="px-2 py-3 border-t border-[var(--sidebar-border)] space-y-0.5">
        <button className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[var(--sidebar-foreground)] hover:bg-[var(--sidebar-accent)] hover:text-[var(--sidebar-accent-foreground)] transition-colors">
          <Bell className="w-4 h-4 shrink-0" />
          <span className="text-sm">Notifications</span>
          <span className="ml-auto w-4 h-4 rounded-full bg-[var(--kpi-amber)] text-white text-[10px] font-bold flex items-center justify-center">
            3
          </span>
        </button>
        <button className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[var(--sidebar-foreground)] hover:bg-[var(--sidebar-accent)] hover:text-[var(--sidebar-accent-foreground)] transition-colors">
          <Settings className="w-4 h-4 shrink-0" />
          <span className="text-sm">Settings</span>
        </button>

        {/* Rep badge */}
        <div className="mt-2 flex items-center gap-2 px-2.5 py-2 rounded-md bg-[var(--sidebar-accent)]">
          <div className="w-6 h-6 rounded-full bg-[var(--kpi-blue)] flex items-center justify-center shrink-0">
            <span className="text-white text-[10px] font-semibold">AM</span>
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-[var(--sidebar-accent-foreground)] truncate">
              Ashley Medina
            </p>
            <p className="text-[10px] text-[var(--sidebar-foreground)] opacity-60 truncate">
              Service Rep
            </p>
          </div>
          <button className="ml-auto text-[var(--sidebar-foreground)] opacity-50 hover:opacity-100 transition-opacity shrink-0">
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
