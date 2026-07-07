import { useState } from "react";
import {
  FileText, CheckCircle, Send, Phone, Mail, MapPin, Calendar,
  Shield, Clock, ChevronRight, Bell, Search, LayoutDashboard,
  Users, Settings, BarChart2, X
} from "lucide-react";
import { QuoteWorkspace } from "./components/QuoteWorkspace";
import { ActivityTimeline } from "./components/ActivityTimeline";
import { HouseholdCard } from "./components/HouseholdCard";

{/* MARKER-MAKE-KIT-INVOKED */}

const lead = {
  name: "Anurodh Vaidya",
  status: "New",
  temperature: "Hot",
  address: "4821 Maple Grove Dr, Austin TX 78745",
  dob: "04/12/1978",
  email: "anurodh.vaidya@gmail.com",
  phone: "(512) 884-3920",
  source: "Referred — David Chen",
  assignedTo: "Marcus Reid",
};

const priorInsurance = {
  carrier: "State Farm",
  policyNumber: "SF-4491-TX-22",
  limits: "100/300/100",
  deductible: "$1,000 Collision / $500 Comp",
  expiration: "07/15/2026",
  premium: "$2,340/yr · $195/mo",
  continuousCoverage: "6 years",
};

const navItems = [
  { icon: LayoutDashboard, label: "Dashboard" },
  { icon: Users, label: "Leads" },
  { icon: BarChart2, label: "Reports" },
  { icon: Settings, label: "Settings" },
];

export default function App() {
  const [soldModal, setSoldModal] = useState(false);
  const [activeNav, setActiveNav] = useState("Leads");

  return (
    <div className="flex size-full min-h-screen" style={{ background: "var(--background)", fontFamily: "'Inter', 'DM Sans', system-ui, sans-serif" }}>

      {/* Sidebar */}
      <aside className="flex flex-col w-14 shrink-0 items-center py-5 gap-6" style={{ background: "var(--sidebar)", borderRight: "1px solid var(--sidebar-border)" }}>
        <div className="size-8 rounded-lg flex items-center justify-center" style={{ background: "var(--sky)" }}>
          <Shield size={16} color="#fff" />
        </div>
        <div className="flex flex-col gap-1 flex-1">
          {navItems.map(({ icon: Icon, label }) => (
            <button
              key={label}
              onClick={() => setActiveNav(label)}
              title={label}
              className="size-9 rounded-lg flex items-center justify-center transition-colors"
              style={{
                background: activeNav === label ? "var(--sidebar-accent)" : "transparent",
                color: activeNav === label ? "var(--sky)" : "rgba(232,237,245,0.5)",
              }}
            >
              <Icon size={17} />
            </button>
          ))}
        </div>
        <div
          className="size-8 rounded-full flex items-center justify-center text-white shrink-0"
          style={{ background: "var(--sky)", fontSize: 11, fontWeight: 700 }}
        >
          MR
        </div>
      </aside>

      {/* Main content */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">

        {/* Master Pipeline Header */}
        <header className="px-6 py-4 flex items-center justify-between shrink-0" style={{ background: "var(--card)", borderBottom: "1px solid var(--border)" }}>
          <div className="flex items-center gap-3 min-w-0">
            {/* Breadcrumb */}
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span>Leads</span>
              <ChevronRight size={12} />
              <span className="text-card-foreground" style={{ fontWeight: 500 }}>Anurodh Vaidya</span>
            </div>
            <div className="w-px h-4 bg-border" />
            {/* Client name */}
            <h1 className="text-card-foreground truncate" style={{ fontWeight: 600 }}>{lead.name}</h1>
            {/* Status badge */}
            <span
              className="px-2 py-0.5 rounded-full text-xs"
              style={{ background: "rgba(14,165,233,0.12)", color: "var(--sky)", fontWeight: 600 }}
            >
              {lead.status}
            </span>
            {/* Temperature badge */}
            <span
              className="px-2 py-0.5 rounded-full text-xs flex items-center gap-1"
              style={{ background: "rgba(249,115,22,0.12)", color: "var(--coral)", fontWeight: 600 }}
            >
              🔥 {lead.temperature}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Quote Recap */}
            <button
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-white text-xs transition-opacity hover:opacity-90"
              style={{ background: "var(--sky)", fontWeight: 600 }}
            >
              <FileText size={13} />
              Quote Recap
            </button>
            {/* Mark as Sold */}
            <button
              onClick={() => setSoldModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-white text-xs transition-opacity hover:opacity-90"
              style={{ background: "var(--emerald)", fontWeight: 600 }}
            >
              <CheckCircle size={13} />
              Mark as Sold
            </button>
            {/* Send to Independent */}
            <button
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-colors hover:bg-muted/70 border border-border"
              style={{ color: "var(--foreground)", fontWeight: 600 }}
            >
              <Send size={13} />
              Send to Independent
            </button>
            <div className="w-px h-5 bg-border ml-1" />
            <button className="size-7 flex items-center justify-center rounded-md hover:bg-muted transition-colors text-muted-foreground">
              <Bell size={15} />
            </button>
            <button className="size-7 flex items-center justify-center rounded-md hover:bg-muted transition-colors text-muted-foreground">
              <Search size={15} />
            </button>
          </div>
        </header>

        {/* Body — 60/40 split */}
        <div className="flex flex-1 min-h-0 overflow-hidden">

          {/* LEFT CANVAS — 60% */}
          <main className="flex flex-col gap-4 p-5 overflow-y-auto" style={{ width: "60%", scrollbarWidth: "none" }}>

            {/* Block A: Lead & Contact Summary */}
            <div className="bg-card rounded-lg border border-border">
              <div className="px-5 py-3 border-b border-border flex items-center justify-between">
                <h2 className="text-xs text-muted-foreground uppercase tracking-wider" style={{ fontWeight: 600 }}>Lead & Contact</h2>
                <span className="text-xs text-muted-foreground">{lead.source}</span>
              </div>
              <div className="grid grid-cols-2 gap-x-8 gap-y-3 px-5 py-4">
                {[
                  { icon: MapPin, label: "Address", value: lead.address },
                  { icon: Calendar, label: "Date of Birth", value: lead.dob },
                  { icon: Mail, label: "Email", value: lead.email },
                  { icon: Phone, label: "Phone", value: lead.phone },
                ].map(({ icon: Icon, label, value }) => (
                  <div key={label} className="flex gap-2.5 items-start">
                    <Icon size={13} className="text-muted-foreground mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground" style={{ fontWeight: 500 }}>{label}</p>
                      <p className="text-sm text-card-foreground">{value}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Block B: Prior Insurance */}
            <div className="bg-card rounded-lg border border-border">
              <div className="px-5 py-3 border-b border-border flex items-center justify-between">
                <h2 className="text-xs text-muted-foreground uppercase tracking-wider" style={{ fontWeight: 600 }}>Prior Insurance</h2>
                <span
                  className="text-xs px-2 py-0.5 rounded-full"
                  style={{ background: "rgba(245,158,11,0.12)", color: "var(--amber)", fontWeight: 600 }}
                >
                  Expires {priorInsurance.expiration}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-x-6 gap-y-3 px-5 py-4">
                {[
                  { label: "Carrier", value: priorInsurance.carrier },
                  { label: "Policy #", value: priorInsurance.policyNumber },
                  { label: "Coverage", value: priorInsurance.continuousCoverage },
                  { label: "Limits", value: priorInsurance.limits },
                  { label: "Deductibles", value: priorInsurance.deductible },
                  { label: "Current Premium", value: priorInsurance.premium },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <p className="text-xs text-muted-foreground" style={{ fontWeight: 500 }}>{label}</p>
                    <p className="text-sm text-card-foreground mt-0.5">{value}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Block C: Active Quote Workspace */}
            <QuoteWorkspace />
          </main>

          {/* RIGHT CANVAS — 40% */}
          <aside
            className="flex flex-col gap-4 p-5 overflow-y-auto shrink-0"
            style={{ width: "40%", borderLeft: "1px solid var(--border)", scrollbarWidth: "none" }}
          >
            <HouseholdCard />
            <div className="flex-1 min-h-0" style={{ minHeight: 400 }}>
              <ActivityTimeline />
            </div>
          </aside>
        </div>
      </div>

      {/* Mark as Sold modal */}
      {soldModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }}>
          <div className="bg-card rounded-xl border border-border w-96 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div className="flex items-center gap-2">
                <CheckCircle size={16} style={{ color: "var(--emerald)" }} />
                <h2 className="text-sm text-card-foreground" style={{ fontWeight: 600 }}>Confirm — Mark as Sold</h2>
              </div>
              <button onClick={() => setSoldModal(false)} className="text-muted-foreground hover:text-card-foreground transition-colors">
                <X size={16} />
              </button>
            </div>
            <div className="px-5 py-5 space-y-4">
              <p className="text-sm text-muted-foreground">
                You're marking <span className="text-card-foreground" style={{ fontWeight: 500 }}>Anurodh Vaidya</span> as a closed sale. This will:
              </p>
              <ul className="space-y-2">
                {["Move lead to Sold pipeline", "Trigger welcome email to client", "Notify underwriting team", "Log close date & agent commission"].map((item) => (
                  <li key={item} className="flex items-center gap-2 text-sm text-muted-foreground">
                    <div className="size-1.5 rounded-full shrink-0" style={{ background: "var(--emerald)" }} />
                    {item}
                  </li>
                ))}
              </ul>
              <div className="space-y-2 pt-1">
                <label className="text-xs text-muted-foreground" style={{ fontWeight: 500 }}>Bound carrier</label>
                <input
                  defaultValue="Progressive"
                  className="w-full text-sm px-3 py-2 rounded-md border border-border bg-muted/40 outline-none focus:border-ring"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground" style={{ fontWeight: 500 }}>Effective date</label>
                <input
                  type="date"
                  defaultValue="2026-06-15"
                  className="w-full text-sm px-3 py-2 rounded-md border border-border bg-muted/40 outline-none focus:border-ring"
                />
              </div>
            </div>
            <div className="flex gap-3 px-5 py-4 border-t border-border">
              <button
                onClick={() => setSoldModal(false)}
                className="flex-1 py-2 rounded-md text-sm border border-border hover:bg-muted/50 transition-colors"
                style={{ fontWeight: 500 }}
              >
                Cancel
              </button>
              <button
                onClick={() => setSoldModal(false)}
                className="flex-1 py-2 rounded-md text-sm text-white transition-opacity hover:opacity-90"
                style={{ background: "var(--emerald)", fontWeight: 600 }}
              >
                Confirm Sale
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
