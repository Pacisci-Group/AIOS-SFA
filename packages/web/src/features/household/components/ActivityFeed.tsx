import { useState } from "react";
import {
  MessageSquare,
  CreditCard,
  FileCheck,
  AlertCircle,
  Phone,
  Mail,
  Clock,
  CheckCircle2,
  Circle,
  Filter,
  type LucideIcon,
} from "lucide-react";

interface Activity {
  id: string;
  type: "call" | "email" | "payment" | "claim" | "ticket" | "endorsement" | "note";
  title: string;
  description: string;
  date: string;
  time: string;
  status?: "Open" | "Resolved" | "Pending" | "Closed";
  agent?: string;
  priority?: "High" | "Medium" | "Low";
}

const activities: Activity[] = [
  {
    id: "a1",
    type: "ticket",
    title: "Billing Inquiry — Late Fee Dispute",
    description: "Jessica called regarding $18 late fee on Auto policy. Agreed to one-time waiver pending supervisor approval.",
    date: "Jun 9, 2026",
    time: "10:14 AM",
    status: "Open",
    agent: "M. Torres",
    priority: "High",
  },
  {
    id: "a2",
    type: "endorsement",
    title: "Driver Token Added — Excluded Status",
    description: "Teen driver added to household roster. Excluded from Auto policy per Jessica's request. Signed exclusion form on file.",
    date: "Jun 6, 2026",
    time: "2:30 PM",
    status: "Closed",
    agent: "M. Torres",
  },
  {
    id: "a3",
    type: "payment",
    title: "Auto Premium Payment Received",
    description: "Monthly ACH payment of $184.00 processed successfully. Next due: Jul 15.",
    date: "Jun 3, 2026",
    time: "8:00 AM",
    status: "Resolved",
    agent: "System",
  },
  {
    id: "a4",
    type: "call",
    title: "Renewal Review Call",
    description: "Outbound call to review Home policy renewal. Discussed roof inspection results. No changes to coverage requested.",
    date: "May 28, 2026",
    time: "11:45 AM",
    status: "Closed",
    agent: "R. Kim",
  },
  {
    id: "a5",
    type: "claim",
    title: "Hail Damage Claim — 412 Magnolia",
    description: "Claim #CLM-2024-0882 filed. Adjuster inspected May 14. Settlement of $6,200 issued for roof replacement.",
    date: "May 10, 2026",
    time: "9:00 AM",
    status: "Resolved",
    agent: "Allstate Claims",
    priority: "High",
  },
  {
    id: "a6",
    type: "email",
    title: "Policy Documents Sent",
    description: "Umbrella policy renewal documents emailed to jessica.cobb@email.com. Read receipt confirmed.",
    date: "May 5, 2026",
    time: "4:12 PM",
    status: "Closed",
    agent: "System",
  },
  {
    id: "a7",
    type: "ticket",
    title: "Address Verification — Rental Property",
    description: "Agent requested updated property address for Landlord policy. Awaiting documentation from client.",
    date: "Apr 28, 2026",
    time: "1:00 PM",
    status: "Pending",
    agent: "R. Kim",
    priority: "Medium",
  },
];

const typeConfig: Record<Activity["type"], { icon: LucideIcon; color: string; bg: string }> = {
  ticket: { icon: AlertCircle, color: "#f59e0b", bg: "#1c1002" },
  call: { icon: Phone, color: "#3b82f6", bg: "#1e3a5f" },
  email: { icon: Mail, color: "#8b5cf6", bg: "#1e1b4b" },
  payment: { icon: CreditCard, color: "#10b981", bg: "#052e16" },
  claim: { icon: FileCheck, color: "#ef4444", bg: "#2d0a0a" },
  endorsement: { icon: FileCheck, color: "#06b6d4", bg: "#0a1628" },
  note: { icon: MessageSquare, color: "#94a3b8", bg: "#1e293b" },
};

const statusConfig: Record<string, { color: string; bg: string; border: string; icon: LucideIcon }> = {
  Open: { color: "#fbbf24", bg: "#1c1002", border: "#78350f", icon: Circle },
  Pending: { color: "#60a5fa", bg: "#1e3a5f", border: "#1d4ed8", icon: Clock },
  Resolved: { color: "#4ade80", bg: "#052e16", border: "#166534", icon: CheckCircle2 },
  Closed: { color: "#64748b", bg: "#1e293b", border: "#334155", icon: CheckCircle2 },
};

type FilterType = "All" | "Open" | "Tickets" | "Claims";

export function ActivityFeed() {
  const [filter, setFilter] = useState<FilterType>("All");

  const filtered = activities.filter((a) => {
    if (filter === "All") return true;
    if (filter === "Open") return a.status === "Open" || a.status === "Pending";
    if (filter === "Tickets") return a.type === "ticket";
    if (filter === "Claims") return a.type === "claim";
    return true;
  });

  const openCount = activities.filter((a) => a.status === "Open" || a.status === "Pending").length;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b shrink-0" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-xs uppercase tracking-widest" style={{ color: "var(--muted-foreground)", fontFamily: "'JetBrains Mono', monospace" }}>
              Activity & Tickets
            </p>
          </div>
          {openCount > 0 && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs" style={{ background: "#2d0a0a", color: "#f87171", border: "1px solid #7f1d1d" }}>
              {openCount} open
            </span>
          )}
        </div>

        {/* Filter pills */}
        <div className="flex items-center gap-1.5">
          <Filter size={11} style={{ color: "var(--muted-foreground)" }} />
          {(["All", "Open", "Tickets", "Claims"] as FilterType[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className="px-2.5 py-1 rounded text-xs transition-all"
              style={
                filter === f
                  ? { background: "#1d4ed8", color: "#fff" }
                  : { background: "var(--muted)", color: "var(--muted-foreground)", border: "1px solid var(--border)" }
              }
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Timeline */}
      <div className="flex-1 overflow-y-auto px-4 py-3" style={{ scrollbarWidth: "none" }}>
        <div className="flex flex-col gap-0 relative">
          {/* Vertical line */}
          <div className="absolute left-[18px] top-2 bottom-2 w-px" style={{ background: "var(--border)" }} />

          {filtered.map((activity, idx) => {
            const tc = typeConfig[activity.type];
            const sc = activity.status ? statusConfig[activity.status] : null;
            const Icon = tc.icon;
            const StatusIcon = sc?.icon;
            return (
              <div key={activity.id} className="relative flex gap-3 pb-4 group">
                {/* Icon node */}
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 z-10 transition-transform group-hover:scale-105"
                  style={{ background: tc.bg, border: `1px solid ${tc.color}30` }}
                >
                  <Icon size={15} style={{ color: tc.color }} />
                </div>

                {/* Content */}
                <div
                  className="flex-1 rounded-lg p-3 transition-all group-hover:border-white/10"
                  style={{ background: "var(--card)", border: "1px solid var(--border)" }}
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <p className="text-xs font-semibold leading-tight" style={{ color: "var(--foreground)" }}>{activity.title}</p>
                    {sc && StatusIcon && (
                      <span
                        className="flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs shrink-0"
                        style={{ background: sc.bg, color: sc.color, border: `1px solid ${sc.border}` }}
                      >
                        <StatusIcon size={9} style={{ color: sc.color }} />
                        {activity.status}
                      </span>
                    )}
                  </div>
                  <p className="text-xs leading-relaxed mb-2" style={{ color: "var(--muted-foreground)" }}>{activity.description}</p>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-mono" style={{ color: "var(--muted-foreground)", fontFamily: "'JetBrains Mono', monospace", opacity: 0.7 }}>
                        {activity.date} · {activity.time}
                      </span>
                    </div>
                    {activity.agent && (
                      <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}>
                        {activity.agent}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {filtered.length === 0 && (
          <div className="flex items-center justify-center h-32">
            <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>No matching activity</p>
          </div>
        )}
      </div>

      {/* Add note */}
      <div className="px-4 pb-4 shrink-0">
        <textarea
          placeholder="Add a note or log an interaction…"
          rows={2}
          className="w-full px-3 py-2 rounded-lg text-xs resize-none outline-none transition-all"
          style={{
            background: "var(--input-background)",
            color: "var(--foreground)",
            border: "1px solid var(--border)",
          }}
        />
        <button className="mt-1.5 w-full py-1.5 rounded text-xs font-medium transition-colors hover:bg-blue-600" style={{ background: "#1d4ed8", color: "#fff" }}>
          Log Interaction
        </button>
      </div>
    </div>
  );
}
