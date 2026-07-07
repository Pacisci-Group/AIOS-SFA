import {
  LayoutDashboard,
  Users,
  Mail,
  TrendingUp,
  ChevronRight,
  Shield,
  LogOut,
  Settings,
} from "lucide-react";
import { useState } from "react";

const navItems = [
  { icon: LayoutDashboard, label: "Dashboard", active: true },
  { icon: Users, label: "Leads", active: false },
  { icon: Mail, label: "Mailers", active: false },
  { icon: TrendingUp, label: "My Performance", active: false },
];

export function Sidebar() {
  const [activeItem, setActiveItem] = useState("Dashboard");

  return (
    <aside
      style={{ background: "#0D1B3E", borderRight: "1px solid rgba(255,255,255,0.06)" }}
      className="w-[260px] min-h-screen flex flex-col shrink-0"
    >
      {/* Logo */}
      <div className="px-6 py-5 flex items-center gap-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div
          className="w-8 h-8 rounded flex items-center justify-center shrink-0"
          style={{ background: "#38BDF8" }}
        >
          <Shield size={16} className="text-[#0B0F19]" />
        </div>
        <div>
          <p className="text-[#E2E8F0] text-sm leading-tight" style={{ fontWeight: 700, letterSpacing: "0.01em" }}>
            ALLSTATE
          </p>
          <p className="text-[10px] text-[#64748B] leading-tight uppercase tracking-widest">
            Agency Portal
          </p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-5 flex flex-col gap-1">
        <p className="text-[10px] text-[#64748B] uppercase tracking-widest px-3 mb-2">
          Sales Tools
        </p>
        {navItems.map(({ icon: Icon, label }) => {
          const isActive = activeItem === label;
          return (
            <button
              key={label}
              onClick={() => setActiveItem(label)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left transition-all duration-150 group"
              style={{
                background: isActive ? "rgba(56,189,248,0.12)" : "transparent",
                color: isActive ? "#38BDF8" : "#94A3B8",
              }}
            >
              <Icon
                size={16}
                style={{ color: isActive ? "#38BDF8" : "#64748B" }}
                className="shrink-0 transition-colors"
              />
              <span className="text-sm flex-1">{label}</span>
              {isActive && (
                <ChevronRight size={12} style={{ color: "#38BDF8" }} />
              )}
            </button>
          );
        })}
      </nav>

      {/* Bottom */}
      <div className="px-3 py-4" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="flex items-center gap-3 px-3 py-2 mb-2">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs"
            style={{ background: "#1A3A8F", color: "#E2E8F0", fontWeight: 700 }}
          >
            JL
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-[#E2E8F0] truncate" style={{ fontWeight: 500 }}>
              Justin L.
            </p>
            <p className="text-xs text-[#64748B] truncate">Producer</p>
          </div>
        </div>
        <div className="flex gap-1">
          <button className="flex-1 flex items-center gap-2 px-3 py-2 rounded-md text-[#64748B] hover:text-[#94A3B8] hover:bg-white/5 transition-all text-xs">
            <Settings size={13} />
            Settings
          </button>
          <button className="flex items-center gap-2 px-3 py-2 rounded-md text-[#64748B] hover:text-[#94A3B8] hover:bg-white/5 transition-all text-xs">
            <LogOut size={13} />
          </button>
        </div>
      </div>
    </aside>
  );
}
