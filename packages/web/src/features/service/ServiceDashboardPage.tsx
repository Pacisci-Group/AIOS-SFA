import { useState } from "react";
import {
  LayoutDashboard, Ticket, Users, BarChart3, Settings, Bell,
  Search, ChevronDown, Shield, TrendingUp, Phone, FileText,
  LogOut, HelpCircle, Menu, X,
} from "lucide-react";
import { ScorecardRow } from "./components/ScorecardRow";
import { PriorityTicketQueue } from "./components/PriorityTicketQueue";
import { RenewalOutreachDesk } from "./components/RenewalOutreachDesk";

const navItems = [
  { icon: LayoutDashboard, label: "CRM Service" },
  { icon: TrendingUp, label: "Sales Pipeline" },
  { icon: Ticket, label: "All Tickets" },
  { icon: Users, label: "My Book" },
  { icon: Phone, label: "Outreach" },
  { icon: FileText, label: "Reports" },
  { icon: BarChart3, label: "Analytics" },
];

const scorecardStats = {
  openTickets: 14,
  needsActionToday: 4,
  upcomingRenewals: 28,
  premiumIncreases: 12,
  resolvedToday: 9,
  dailyTarget: 15,
  totalHouseholds: 412,
  avgLobDensity: 2.3,
};

export default function App() {
  const [activeNav, setActiveNav] = useState("CRM Service");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      {/* Sidebar */}
      <aside
        className={`flex-shrink-0 flex flex-col bg-sidebar border-r border-sidebar-border transition-all duration-300 ${
          sidebarOpen ? "w-56" : "w-16"
        }`}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 py-5 border-b border-sidebar-border">
          <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-[#0076A8] flex items-center justify-center">
            <Shield size={16} className="text-white" />
          </div>
          {sidebarOpen && (
            <div className="overflow-hidden">
              <div className="text-sm font-bold text-foreground tracking-tight leading-tight">Allstate</div>
              <div className="text-[10px] text-muted-foreground tracking-widest uppercase">Producer Hub</div>
            </div>
          )}
        </div>

        {/* Rep info */}
        {sidebarOpen && (
          <div className="mx-3 mt-4 mb-2 px-3 py-3 rounded-xl bg-secondary/40 border border-white/5">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#0076A8] to-[#10B981] flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                RL
              </div>
              <div className="min-w-0">
                <div className="text-xs font-semibold text-foreground truncate">Ryan Lassiter</div>
                <div className="text-[10px] text-muted-foreground truncate">Service Rep · Tier 3</div>
              </div>
            </div>
          </div>
        )}

        {/* Nav */}
        <nav className="flex-1 px-2 pt-2 pb-4 space-y-0.5 overflow-y-auto">
          {navItems.map((item) => (
            <button
              key={item.label}
              onClick={() => setActiveNav(item.label)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-150 ${
                activeNav === item.label
                  ? "bg-[#0076A8]/15 text-[#0076A8] border border-[#0076A8]/20"
                  : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              }`}
            >
              <item.icon size={16} className="flex-shrink-0" />
              {sidebarOpen && <span className="truncate font-medium">{item.label}</span>}
              {sidebarOpen && activeNav === item.label && (
                <div className="ml-auto w-1.5 h-1.5 rounded-full bg-[#0076A8]" />
              )}
            </button>
          ))}
        </nav>

        {/* Bottom */}
        <div className="px-2 pb-4 space-y-0.5 border-t border-sidebar-border pt-3">
          <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors">
            <HelpCircle size={16} />
            {sidebarOpen && <span className="font-medium">Help</span>}
          </button>
          <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors">
            <Settings size={16} />
            {sidebarOpen && <span className="font-medium">Settings</span>}
          </button>
          <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-[#EF4444]/70 hover:bg-[#EF4444]/10 hover:text-[#EF4444] transition-colors">
            <LogOut size={16} />
            {sidebarOpen && <span className="font-medium">Sign Out</span>}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Topbar */}
        <header className="flex-shrink-0 flex items-center gap-4 px-6 py-3.5 border-b border-border bg-background/95 backdrop-blur-sm">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            {sidebarOpen ? <X size={16} /> : <Menu size={16} />}
          </button>

          <div className="flex items-center gap-1.5 text-sm">
            <span className="text-muted-foreground">Dashboard</span>
            <ChevronDown size={13} className="text-muted-foreground -rotate-90" />
            <span className="font-semibold text-foreground">CRM Service</span>
          </div>

          <div className="flex-1 max-w-sm ml-4">
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                placeholder="Search clients, tickets, policies..."
                className="w-full pl-8 pr-4 py-2 text-xs bg-secondary border border-white/8 rounded-lg text-foreground placeholder-muted-foreground outline-none focus:border-[#0076A8]/40 transition-colors"
              />
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#F59E0B]/10 border border-[#F59E0B]/20">
              <div className="w-1.5 h-1.5 rounded-full bg-[#F59E0B] animate-pulse" />
              <span className="text-[11px] font-semibold text-[#F59E0B]">2 Critical SLAs</span>
            </div>

            <div className="relative">
              <button
                onClick={() => setNotificationsOpen(!notificationsOpen)}
                className="relative p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              >
                <Bell size={16} />
                <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-[#F59E0B] border-2 border-background" />
              </button>

              {notificationsOpen && (
                <div className="absolute right-0 top-full mt-2 w-80 rounded-xl border border-white/10 bg-card shadow-2xl z-50 overflow-hidden">
                  <div className="px-4 py-3 border-b border-white/8 flex items-center justify-between">
                    <span className="text-sm font-semibold text-foreground">Notifications</span>
                    <span className="text-[10px] text-muted-foreground">3 unread</span>
                  </div>
                  {[
                    { title: "SLA Breach: Meredith Dunning", desc: "Renewal ticket T-4821 is now 8 days overdue", time: "2h ago", color: "#EF4444" },
                    { title: "Premium Alert: 12 renewals flagged", desc: "Premium increases >10% need review this week", time: "4h ago", color: "#F59E0B" },
                    { title: "Ticket Resolved: Angela Ferreira", desc: "Address update T-4833 successfully closed", time: "Today 9:15 AM", color: "#10B981" },
                  ].map((n, i) => (
                    <div key={i} className="flex items-start gap-3 px-4 py-3 hover:bg-secondary/50 transition-colors border-b border-white/5 last:border-0 cursor-pointer">
                      <div className="w-2 h-2 rounded-full flex-shrink-0 mt-1.5" style={{ backgroundColor: n.color }} />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-foreground">{n.title}</div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">{n.desc}</div>
                        <div className="text-[10px] text-muted-foreground/60 mt-1">{n.time}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <button className="w-8 h-8 rounded-full bg-gradient-to-br from-[#0076A8] to-[#10B981] flex items-center justify-center text-white text-xs font-bold">
              RL
            </button>
          </div>
        </header>

        {/* Dashboard body */}
        <main className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-foreground tracking-tight">Service Dashboard</h1>
              <p className="text-xs text-muted-foreground mt-0.5">Monday, June 9 · Week 23 · Q2 Sprint 6</p>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#10B981]/10 border border-[#10B981]/20">
              <div className="w-1.5 h-1.5 rounded-full bg-[#10B981]" />
              <span className="text-[11px] font-semibold text-[#10B981]">Service Rep View</span>
            </div>
          </div>

          {/* Row 1: Scorecard */}
          <ScorecardRow stats={scorecardStats} />

          {/* Row 2: 60/40 Workspace */}
          <div className="grid gap-5" style={{ gridTemplateColumns: "3fr 2fr", minHeight: "560px" }}>
            <PriorityTicketQueue />
            <RenewalOutreachDesk />
          </div>
        </main>
      </div>

      {notificationsOpen && (
        <div className="fixed inset-0 z-40" onClick={() => setNotificationsOpen(false)} />
      )}
    </div>
  );
}
