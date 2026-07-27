import { Search, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { Ticket, TicketStatus } from "./ticket-data";

type FilterTab = "all" | "open" | "waiting" | "resolved";

interface TicketFeedProps {
  tickets: Ticket[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const STATUS_COLORS: Record<TicketStatus, { dot: string; text: string }> = {
  open: { dot: "bg-[var(--kpi-blue)]", text: "text-[var(--kpi-blue)]" },
  waiting: { dot: "bg-[var(--kpi-purple)]", text: "text-[var(--kpi-purple)]" },
  resolved: { dot: "bg-[var(--kpi-green)]", text: "text-[var(--kpi-green)]" },
  overdue: { dot: "bg-[var(--kpi-amber)]", text: "text-[var(--kpi-amber)]" },
};

const CATEGORY_SHORT: Record<string, string> = {
  "Renewal Review": "Renewal",
  "Claims Inquiry": "Claims",
  "Premium Dispute": "Premium",
  "Policy Change": "Pol. Change",
  "Billing Issue": "Billing",
  "Coverage Question": "Coverage",
  "Cancellation Request": "Cancel",
  "New Business": "New Biz",
};

const PRIORITY_COLOR: Record<string, string> = {
  high: "bg-red-500/15 text-red-400",
  medium: "bg-amber-500/15 text-amber-400",
  low: "bg-slate-500/15 text-slate-300",
};

export function TicketFeed({ tickets, selectedId, onSelect }: TicketFeedProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterTab>("all");

  const filtered = tickets.filter((t) => {
    const matchesFilter =
      filter === "all" ||
      (filter === "open" && (t.status === "open" || t.status === "overdue")) ||
      (filter === "waiting" && t.status === "waiting") ||
      (filter === "resolved" && t.status === "resolved");

    const q = query.toLowerCase();
    const matchesQuery =
      !q ||
      t.clientName.toLowerCase().includes(q) ||
      t.ticketNumber.toLowerCase().includes(q) ||
      t.policyNumber.includes(q) ||
      t.phone.includes(q);

    return matchesFilter && matchesQuery;
  });

  const tabs: { label: string; value: FilterTab }[] = [
    { label: "All", value: "all" },
    { label: "Open", value: "open" },
    { label: "Waiting", value: "waiting" },
    { label: "Resolved", value: "resolved" },
  ];

  return (
    <div className="flex flex-col h-full bg-card border-r border-border overflow-hidden">
      {/* Search + filter */}
      <div className="px-3 pt-3 pb-2 border-b border-border space-y-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Search name, policy, phone, ID…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-sm bg-[var(--input-background)] border border-border rounded-md outline-none focus:ring-2 focus:ring-[var(--ring)] placeholder:text-muted-foreground"
          />
        </div>
        <div className="flex items-center bg-muted rounded-md p-0.5 gap-0.5">
          {tabs.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setFilter(tab.value)}
              className={`flex-1 text-xs py-1 rounded transition-all ${
                filter === tab.value
                  ? "bg-secondary text-foreground shadow-sm font-medium"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Count */}
      <div className="px-3 py-1.5 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{filtered.length} ticket{filtered.length !== 1 ? "s" : ""}</span>
        <button className="text-muted-foreground hover:text-foreground transition-colors">
          <SlidersHorizontal className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        {filtered.length === 0 && (
          <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
            No tickets match your search.
          </div>
        )}
        {filtered.map((ticket) => {
          const sc = STATUS_COLORS[ticket.status];
          const isSelected = selectedId === ticket.id;
          const isOverdue = ticket.daysOpen > 10 && ticket.status !== "resolved";

          return (
            <button
              key={ticket.id}
              onClick={() => onSelect(ticket.id)}
              className={`w-full text-left px-3 py-2.5 border-b border-border transition-colors group ${
                isSelected
                  ? "bg-[var(--kpi-blue-bg)] border-l-2 border-l-[var(--kpi-blue)]"
                  : "hover:bg-muted/50 border-l-2 border-l-transparent"
              }`}
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <span className={`text-sm font-semibold leading-tight ${isSelected ? "text-[var(--kpi-blue)]" : "text-foreground"}`}>
                  {ticket.clientName}
                </span>
                <span
                  className={`shrink-0 text-xs font-mono px-1.5 py-0.5 rounded ${
                    isOverdue
                      ? "bg-[var(--kpi-amber-bg)] text-[var(--kpi-amber)] font-semibold"
                      : "bg-muted text-muted-foreground"
                  } ${isOverdue ? "animate-pulse" : ""}`}
                >
                  {ticket.status === "resolved" ? "✓ Done" : `${ticket.daysOpen}d open`}
                </span>
              </div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className={`inline-block w-1.5 h-1.5 rounded-full ${sc.dot} shrink-0`} />
                <span className="text-xs text-muted-foreground font-mono">{ticket.ticketNumber}</span>
                <span className="text-xs text-muted-foreground">·</span>
                <span className="text-xs text-muted-foreground">{CATEGORY_SHORT[ticket.category]}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className={`text-xs px-1.5 py-0.5 rounded-sm ${PRIORITY_COLOR[ticket.priority]}`}>
                  {ticket.priority}
                </span>
                <span className="text-xs text-muted-foreground">{ticket.lastActivity}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
