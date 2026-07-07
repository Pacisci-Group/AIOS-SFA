import { useState } from "react";
import { MessageSquarePlus, RefreshCw, ExternalLink, Clock, ChevronRight } from "lucide-react";

type SlaStatus = "critical" | "warning" | "normal";
type FilterTab = "all" | "overdue" | "waiting";

interface Ticket {
  id: string;
  clientName: string;
  ticketType: string;
  lastTouch: string;
  lastTouchTime: string;
  slaStatus: SlaStatus;
  category: FilterTab | "all";
  daysOpen: number;
  policyNumber: string;
}

const tickets: Ticket[] = [
  { id: "T-4821", clientName: "Meredith Dunning", ticketType: "Renewal Review", lastTouch: "Client emailed updated mileage logs", lastTouchTime: "2 hours ago", slaStatus: "critical", category: "overdue", daysOpen: 8, policyNumber: "AL-2291847" },
  { id: "T-4798", clientName: "Robert Callahan", ticketType: "Claim Follow-up", lastTouch: "Adjuster requested supplemental photos", lastTouchTime: "4 hours ago", slaStatus: "critical", category: "overdue", daysOpen: 5, policyNumber: "HO-8847231" },
  { id: "T-4815", clientName: "Sandra Okafor", ticketType: "Premium Dispute", lastTouch: "Awaiting underwriting response", lastTouchTime: "Yesterday 3:12 PM", slaStatus: "warning", category: "waiting", daysOpen: 3, policyNumber: "AL-5519032" },
  { id: "T-4807", clientName: "James Thornberry", ticketType: "Coverage Add-on", lastTouch: "Client signed umbrella app, pending bind", lastTouchTime: "Yesterday 11:40 AM", slaStatus: "warning", category: "waiting", daysOpen: 2, policyNumber: "AL-3384710" },
  { id: "T-4833", clientName: "Angela Ferreira", ticketType: "Address Update", lastTouch: "DMV records confirmed, processing", lastTouchTime: "Today 9:05 AM", slaStatus: "normal", category: "all", daysOpen: 1, policyNumber: "AL-7732019" },
  { id: "T-4829", clientName: "David Nkemdirim", ticketType: "Life Policy Inquiry", lastTouch: "Left voicemail, awaiting callback", lastTouchTime: "Today 8:30 AM", slaStatus: "normal", category: "all", daysOpen: 1, policyNumber: "LI-4410022" },
  { id: "T-4801", clientName: "Priya Nair", ticketType: "Multi-Car Discount Review", lastTouch: "VIN verification needed for 2023 Honda CR-V", lastTouchTime: "3 hours ago", slaStatus: "warning", category: "waiting", daysOpen: 2, policyNumber: "AL-9921004" },
  { id: "T-4844", clientName: "Marcus Webb", ticketType: "Homeowners Renewal", lastTouch: "Inspection report received, needs review", lastTouchTime: "30 min ago", slaStatus: "normal", category: "all", daysOpen: 1, policyNumber: "HO-2210847" },
];

const slaConfig: Record<SlaStatus, { color: string; label: string; bg: string; text: string }> = {
  critical: { color: "#EF4444", label: "Overdue", bg: "bg-[#EF4444]/10", text: "text-[#EF4444]" },
  warning: { color: "#F59E0B", label: "Due Soon", bg: "bg-[#F59E0B]/10", text: "text-[#F59E0B]" },
  normal: { color: "#4B5D71", label: "On Track", bg: "bg-white/5", text: "text-muted-foreground" },
};

export function PriorityTicketQueue() {
  const [activeFilter, setActiveFilter] = useState<FilterTab>("all");
  const [actionMenu, setActionMenu] = useState<string | null>(null);

  const filtered = tickets.filter((t) => {
    if (activeFilter === "all") return true;
    if (activeFilter === "overdue") return t.slaStatus === "critical";
    if (activeFilter === "waiting") return t.category === "waiting";
    return true;
  });

  const tabs: { key: FilterTab; label: string; count: number }[] = [
    { key: "all", label: "All Assigned", count: tickets.length },
    { key: "overdue", label: "Overdue", count: tickets.filter((t) => t.slaStatus === "critical").length },
    { key: "waiting", label: "Waiting on Others", count: tickets.filter((t) => t.category === "waiting").length },
  ];

  return (
    <div className="flex flex-col rounded-xl border border-white/8 bg-card overflow-hidden h-full">
      {/* Header */}
      <div className="px-5 pt-5 pb-4 border-b border-white/8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-foreground tracking-tight">My Priority Tickets</h2>
          <span className="text-xs text-muted-foreground">{filtered.length} tickets</span>
        </div>
        <div className="flex gap-1 p-1 rounded-lg bg-secondary/60">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveFilter(tab.key)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-150 ${
                activeFilter === tab.key
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
              <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${
                activeFilter === tab.key ? "bg-primary/20 text-primary" : "bg-white/5"
              }`}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Ticket list */}
      <div className="flex-1 overflow-y-auto divide-y divide-white/5">
        {filtered.map((ticket) => {
          const sla = slaConfig[ticket.slaStatus];
          return (
            <div
              key={ticket.id}
              className="relative flex items-stretch group hover:bg-white/[0.02] transition-colors duration-150"
            >
              {/* SLA indicator strip */}
              <div
                className="w-1 flex-shrink-0"
                style={{ backgroundColor: sla.color }}
              />

              <div className="flex-1 px-4 py-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs text-muted-foreground font-mono">{ticket.id}</span>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${sla.bg} ${sla.text}`}>
                        {sla.label}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {ticket.daysOpen}d open
                      </span>
                    </div>
                    <div className="text-sm font-semibold text-foreground mb-0.5 truncate">
                      {ticket.clientName}
                      <span className="text-muted-foreground font-normal mx-1.5">·</span>
                      <span className="text-muted-foreground font-normal">{ticket.ticketType}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Clock size={10} />
                      <span className="truncate">{ticket.lastTouch}</span>
                      <span className="text-white/20 flex-shrink-0">—</span>
                      <span className="flex-shrink-0">{ticket.lastTouchTime}</span>
                    </div>
                  </div>

                  {/* Quick actions */}
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150 flex-shrink-0">
                    <button
                      className="flex items-center gap-1 px-2 py-1 rounded-md bg-secondary text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/80 transition-colors"
                      onClick={() => setActionMenu(actionMenu === ticket.id ? null : ticket.id)}
                    >
                      <MessageSquarePlus size={11} />
                      <span>Note</span>
                    </button>
                    <button className="flex items-center gap-1 px-2 py-1 rounded-md bg-secondary text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/80 transition-colors">
                      <RefreshCw size={11} />
                      <span>Status</span>
                    </button>
                    <button className="flex items-center gap-1 px-2 py-1 rounded-md bg-[#0076A8]/20 text-xs text-[#0076A8] hover:bg-[#0076A8]/30 transition-colors">
                      <ExternalLink size={11} />
                      <span>Open</span>
                    </button>
                  </div>
                  <ChevronRight size={14} className="text-white/20 group-hover:text-white/40 transition-colors flex-shrink-0 mt-0.5" />
                </div>

                {/* Inline note input */}
                {actionMenu === ticket.id && (
                  <div className="mt-3 flex gap-2">
                    <input
                      autoFocus
                      placeholder="Add a note..."
                      className="flex-1 text-xs bg-secondary border border-white/10 rounded-lg px-3 py-2 text-foreground placeholder-muted-foreground outline-none focus:border-[#0076A8]/50"
                    />
                    <button
                      onClick={() => setActionMenu(null)}
                      className="px-3 py-2 rounded-lg bg-[#0076A8] text-white text-xs font-medium hover:bg-[#0076A8]/80 transition-colors"
                    >
                      Save
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
