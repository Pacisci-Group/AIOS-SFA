import { useMemo, useState } from "react";
import { MessageSquarePlus, ExternalLink, Clock, ChevronRight, ChevronDown, CheckCircle2 } from "lucide-react";
import {
  SERVICE_TICKET_PICKER_STATUSES,
  isTerminalTicketStatus,
  type ServiceTicketStatus,
} from "@sfa/shared";
import { TICKET_STATUS_CONFIG } from "@/features/tickets/components/ticket-data";
import type { ServiceTicketView } from "@/lib/service-tickets-api";
import { sortByUrgency } from "@/lib/ticket-urgency";

type SlaStatus = "critical" | "warning" | "normal";
type FilterTab = "all" | "overdue" | "waiting";

interface PriorityTicketQueueProps {
  tickets: ServiceTicketView[];
  onOpen: (id: string) => void;
  onAddNote: (id: string, content: string) => void;
  onChangeStatus: (id: string, status: ServiceTicketStatus) => void;
}

interface QueueTicket {
  id: string;
  clientName: string;
  ticketType: string;
  lastTouch: string;
  lastTouchTime: string;
  status: ServiceTicketStatus;
  slaStatus: SlaStatus;
  daysOpen: number;
  policyNumber: string;
  isWaiting: boolean;
}

/** Every flavour of "blocked on someone else" feeds the Waiting filter. */
const WAITING_STATUSES: ServiceTicketStatus[] = [
  "waiting",
  "waiting_on_client",
  "waiting_on_carrier",
];

function toQueueTicket(t: ServiceTicketView): QueueTicket {
  const lastEntry = t.timeline[t.timeline.length - 1];
  const isWaiting = WAITING_STATUSES.includes(t.status);
  const slaStatus: SlaStatus =
    t.status === "overdue"
      ? "critical"
      : isWaiting || t.daysOpen > 10
        ? "warning"
        : "normal";
  return {
    id: t.id,
    clientName: t.clientName,
    ticketType: t.category,
    lastTouch: lastEntry?.content ?? "No activity yet",
    lastTouchTime: t.lastActivity,
    status: t.status,
    slaStatus,
    daysOpen: t.daysOpen,
    policyNumber: t.policyNumber,
    isWaiting,
  };
}

const slaConfig: Record<SlaStatus, { color: string; label: string; bg: string; text: string }> = {
  critical: { color: "#EF4444", label: "Overdue", bg: "bg-[#EF4444]/10", text: "text-[#EF4444]" },
  warning: { color: "#F59E0B", label: "Due Soon", bg: "bg-[#F59E0B]/10", text: "text-[#F59E0B]" },
  normal: { color: "#4B5D71", label: "On Track", bg: "bg-white/5", text: "text-muted-foreground" },
};

export function PriorityTicketQueue({
  tickets,
  onOpen,
  onAddNote,
  onChangeStatus,
}: PriorityTicketQueueProps) {
  const [activeFilter, setActiveFilter] = useState<FilterTab>("all");
  const [actionMenu, setActionMenu] = useState<string | null>(null);
  const [statusMenu, setStatusMenu] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");

  // Most urgent first: overdue leads, and within overdue the ticket that has
  // been late the longest is at the top. Sorted before mapping so the ranking
  // can use the due date, which the flattened row shape drops.
  const queueTickets = useMemo(
    () =>
      sortByUrgency(tickets.filter((t) => !isTerminalTicketStatus(t.status)))
        .map(toQueueTicket),
    [tickets],
  );

  const filtered = queueTickets.filter((t) => {
    if (activeFilter === "all") return true;
    if (activeFilter === "overdue") return t.slaStatus === "critical";
    if (activeFilter === "waiting") return t.isWaiting;
    return true;
  });

  const tabs: { key: FilterTab; label: string; count: number }[] = [
    { key: "all", label: "All Assigned", count: queueTickets.length },
    { key: "overdue", label: "Overdue", count: queueTickets.filter((t) => t.slaStatus === "critical").length },
    { key: "waiting", label: "Waiting on Others", count: queueTickets.filter((t) => t.isWaiting).length },
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
        {filtered.length === 0 && (
          <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
            No tickets in this view.
          </div>
        )}
        {filtered.map((ticket, index) => {
          const sla = slaConfig[ticket.slaStatus];
          const statusCfg = TICKET_STATUS_CONFIG[ticket.status];
          const menuOpen = statusMenu === ticket.id || actionMenu === ticket.id;
          // Rows near the bottom of the scroll area open their menu upward so
          // it isn't clipped by the list container.
          const dropUp = filtered.length > 3 && index >= filtered.length - 2;
          return (
            <div
              key={ticket.id}
              role="button"
              tabIndex={0}
              aria-label={`Open ticket for ${ticket.clientName}`}
              onClick={() => onOpen(ticket.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onOpen(ticket.id);
                }
              }}
              className="relative flex items-stretch group cursor-pointer hover:bg-white/[0.02] transition-colors duration-150 outline-none focus-visible:bg-white/[0.04] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[#0076A8]/60"
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
                      <span className="text-xs text-muted-foreground font-mono">{ticket.policyNumber || ticket.id.slice(-6)}</span>
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
                  <div
                    className={`flex items-center gap-1 transition-opacity duration-150 flex-shrink-0 ${
                      menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                    }`}
                  >
                    <button
                      className="flex items-center gap-1 px-2 py-1 rounded-md bg-secondary text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/80 transition-colors"
                      onClick={(e) => {
                        e.stopPropagation();
                        setActionMenu(actionMenu === ticket.id ? null : ticket.id);
                        setStatusMenu(null);
                        setNoteDraft("");
                      }}
                    >
                      <MessageSquarePlus size={11} />
                      <span>Note</span>
                    </button>
                    {/* Status picker — same options as the ticket workspace */}
                    <div className="relative">
                      <button
                        aria-haspopup="listbox"
                        aria-expanded={statusMenu === ticket.id}
                        className={`flex items-center gap-1.5 px-2 py-1 rounded-md border border-current/20 text-xs font-medium hover:opacity-80 transition-opacity ${statusCfg.bg} ${statusCfg.text}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setStatusMenu(statusMenu === ticket.id ? null : ticket.id);
                          setActionMenu(null);
                        }}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${statusCfg.dot}`} />
                        <span>{statusCfg.label}</span>
                        <ChevronDown size={11} className="opacity-60" />
                      </button>

                      {statusMenu === ticket.id && (
                        <div
                          role="listbox"
                          className={`absolute right-0 ${dropUp ? "bottom-full mb-1" : "top-full mt-1"} bg-popover border border-border rounded-md shadow-lg z-50 min-w-[130px] py-0.5`}
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => e.stopPropagation()}
                        >
                          {SERVICE_TICKET_PICKER_STATUSES.map((s) => {
                            const c = TICKET_STATUS_CONFIG[s];
                            return (
                              <button
                                key={s}
                                role="option"
                                aria-selected={s === ticket.status}
                                onClick={() => {
                                  setStatusMenu(null);
                                  if (s !== ticket.status) {
                                    onChangeStatus(ticket.id, s);
                                  }
                                }}
                                className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted transition-colors text-left ${
                                  s === ticket.status ? "font-semibold" : ""
                                }`}
                              >
                                <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
                                {c.label}
                                {s === ticket.status && (
                                  <CheckCircle2 className="w-3 h-3 ml-auto text-[var(--kpi-green)]" />
                                )}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    <button
                      className="flex items-center gap-1 px-2 py-1 rounded-md bg-[#0076A8]/20 text-xs text-[#0076A8] hover:bg-[#0076A8]/30 transition-colors"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpen(ticket.id);
                      }}
                    >
                      <ExternalLink size={11} />
                      <span>Open</span>
                    </button>
                  </div>
                  <ChevronRight size={14} className="text-white/20 group-hover:text-white/40 transition-colors flex-shrink-0 mt-0.5" />
                </div>

                {/* Inline note input */}
                {actionMenu === ticket.id && (
                  <div
                    className="mt-3 flex gap-2"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    <input
                      autoFocus
                      value={noteDraft}
                      onChange={(e) => setNoteDraft(e.target.value)}
                      placeholder="Add a note..."
                      className="flex-1 text-xs bg-secondary border border-white/10 rounded-lg px-3 py-2 text-foreground placeholder-muted-foreground outline-none focus:border-[#0076A8]/50"
                    />
                    <button
                      disabled={!noteDraft.trim()}
                      onClick={() => {
                        if (noteDraft.trim()) {
                          onAddNote(ticket.id, noteDraft.trim());
                        }
                        setActionMenu(null);
                        setNoteDraft("");
                      }}
                      className="px-3 py-2 rounded-lg bg-[#0076A8] text-white text-xs font-medium hover:bg-[#0076A8]/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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

      {/* Click-away for the status picker */}
      {statusMenu && (
        <div
          className="fixed inset-0 z-40"
          onClick={(e) => {
            e.stopPropagation();
            setStatusMenu(null);
          }}
        />
      )}
    </div>
  );
}
