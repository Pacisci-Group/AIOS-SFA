import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MessageSquarePlus, ExternalLink, Clock, ChevronRight, ChevronDown, CheckCircle2, Lock } from "lucide-react";
import {
  SERVICE_TICKET_PICKER_STATUSES,
  isTerminalTicketStatus,
  type ServiceTicketStatus,
} from "@sfa/shared";
import { TICKET_STATUS_CONFIG } from "@/features/tickets/components/ticket-data";
import type { ServiceTicketView } from "@/lib/service-tickets-api";
import { sortByUrgency } from "@/lib/ticket-urgency";
import { useUrlState } from "@/hooks/useUrlState";

type SlaStatus = "critical" | "warning" | "normal";

/**
 * One list, two jobs: the tab strip's vocabulary and the URL guard below. A new
 * tab that the URL would reject is a compile error rather than a filter that
 * silently falls back to "all" when someone shares the link.
 */
const FILTER_TABS = ["all", "overdue", "waiting"] as const;
type FilterTab = (typeof FILTER_TABS)[number];

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
  /** Quote tickets take their status from their lead — no picker on the row. */
  isStatusLocked: boolean;
}

/**
 * Rows per page.
 *
 * The queue is paginated in the browser, not on the server, because everything
 * around the rows needs the whole set: `sortByUrgency` ranks by status, then
 * age, then priority; the three tab counts are over all assigned tickets; and
 * the SLA badge is derived here from `daysOpen`. Paging on the server would
 * mean porting that ranking into Mongo and recounting per tab — a rewrite of
 * `GET /crm/service-tickets`, which two other pages also read. Worth doing if a
 * rep's own queue ever grows past a few hundred; it does not today.
 */
const PAGE_SIZE = 8;

/**
 * The queue's tab and page live in the URL, not in `useState`.
 *
 * Same reasoning as the Leads list (`useLeadsUrlState`): opening a ticket and
 * hitting back restores the view the rep left, a refresh keeps it, and page 3
 * of the Overdue tab is a link somebody can paste into Slack. The tab has to
 * ride along or the page number means nothing — `?page=3` against a different
 * tab is a different set of tickets.
 *
 * Frozen at module scope so `useUrlState`'s memo dependencies stay stable
 * across renders. `page: ''` is the default, so `?page=1` never appears.
 */
const URL_DEFAULTS = {
  tab: "all" as string,
  page: "",
};

const URL_ALLOWED = {
  tab: FILTER_TABS,
  page: (value: string) => /^[1-9]\d*$/.test(value),
} as const;

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
    isStatusLocked: t.isStatusLocked,
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
  const [urlState, setUrlState] = useUrlState({
    defaults: URL_DEFAULTS,
    allowed: URL_ALLOWED,
  });
  const activeFilter = urlState.tab as FilterTab;
  const page = Number(urlState.page) || 1;

  const [actionMenu, setActionMenu] = useState<string | null>(null);
  const [statusMenu, setStatusMenu] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

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

  /*
   * Clamped while rendering, so the list never paints a frame of "No tickets in
   * this view" — resolving the last ticket on the last page shrinks `filtered`
   * out from under `page`, and correcting that in an effect alone would show
   * the empty state for one frame before fixing it.
   */
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pageRows = filtered.slice(pageStart, pageStart + PAGE_SIZE);

  /** Whatever the rows are about to become, this is no longer their view. */
  const resetView = useCallback(() => {
    // A menu belongs to a row that is about to leave the screen.
    setStatusMenu(null);
    setActionMenu(null);
    setNoteDraft("");
    // Rows are tall enough that a page can still scroll on a short viewport,
    // so land at the top of the new one rather than wherever the last was left.
    listRef.current?.scrollTo({ top: 0 });
  }, []);

  const goToPage = (next: number) => {
    setUrlState({ page: next <= 1 ? "" : String(next) });
    resetView();
  };

  const changeFilter = (next: FilterTab) => {
    // One write, not two. `setUrlState` navigates rather than setting state, so
    // a separate `goToPage(1)` in the same tick would compute from a location
    // that has not committed and drop one of the two changes — see `useUrlState`.
    setUrlState({ tab: next, page: "" });
    resetView();
  };

  /*
   * Reconcile the URL with the clamp above.
   *
   * The render already shows the right page, so this only fixes the address
   * bar — but leaving `?page=3` on a two-page queue is both a lie in a URL
   * somebody might copy and a trap: one new ticket arriving on the next
   * refetch would grow `totalPages` and silently jump the rep to page 3.
   */
  useEffect(() => {
    if (page !== currentPage) {
      setUrlState({ page: currentPage <= 1 ? "" : String(currentPage) });
    }
  }, [page, currentPage, setUrlState]);

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
              onClick={() => changeFilter(tab.key)}
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
      <div ref={listRef} className="flex-1 overflow-y-auto divide-y divide-white/5">
        {filtered.length === 0 && (
          <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
            No tickets in this view.
          </div>
        )}
        {pageRows.map((ticket, index) => {
          const sla = slaConfig[ticket.slaStatus];
          const statusCfg = TICKET_STATUS_CONFIG[ticket.status];
          const menuOpen = statusMenu === ticket.id || actionMenu === ticket.id;
          // Rows near the bottom of the scroll area open their menu upward so
          // it isn't clipped by the list container. Measured against the rows
          // on this page — against `filtered` it would point the wrong way on
          // every page but the last.
          const dropUp = pageRows.length > 3 && index >= pageRows.length - 2;
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

              {/*
                `min-w-0` on all three of these, not just the innermost one.
                A flex item's automatic minimum size is content-based unless its
                `overflow` is non-visible, so any one of these left at the
                default `min-width: auto` refuses to shrink and widens the whole
                row past the card — which is what put the last-touch note (and
                the "— 2h ago" after it) outside the clipped edge. The `truncate`
                further down cannot ellipsise against a width that never got
                constrained. `overflow-hidden` on the text column is the backstop:
                the two unshrinkable header spans (policy number, badges) can no
                longer spill either.
              */}
              <div className="min-w-0 flex-1 px-4 py-3.5">
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 overflow-hidden">
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
                      <Clock size={10} className="flex-shrink-0" />
                      <span className="min-w-0 truncate">{ticket.lastTouch}</span>
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
                    {/*
                      Status picker — same options as the ticket workspace, and
                      the same exception: a quote ticket's status is owned by
                      its lead, so the row shows a locked badge instead of a
                      menu. "Open" alongside is the way through to the lead.
                    */}
                    {ticket.isStatusLocked ? (
                      <span
                        className={`flex items-center gap-1.5 px-2 py-1 rounded-md border border-current/20 text-xs font-medium ${statusCfg.bg} ${statusCfg.text}`}
                        title="Status follows the linked lead — it resolves when the lead is marked Sold or Closed."
                      >
                        <Lock size={11} className="opacity-70" />
                        <span>{statusCfg.label}</span>
                      </span>
                    ) : (
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
                    )}
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

      {/* Pagination. Hidden on a single page: a footer that can only say
          "1 / 1" is chrome, and this card is short on vertical room. */}
      {totalPages > 1 && (
        <nav
          aria-label="Ticket queue pagination"
          className="flex-shrink-0 flex items-center justify-between gap-3 px-5 py-3 border-t border-white/8"
        >
          <span className="text-[11px] text-muted-foreground tabular-nums">
            Showing {pageStart + 1}–{pageStart + pageRows.length} of{" "}
            {filtered.length}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              disabled={currentPage <= 1}
              onClick={() => goToPage(currentPage - 1)}
              className="px-2.5 py-1 rounded-md bg-secondary border border-white/8 text-[11px] font-semibold text-muted-foreground transition-colors hover:text-foreground hover:bg-secondary/80 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-muted-foreground disabled:hover:bg-secondary"
            >
              Prev
            </button>
            <span className="px-1 text-[11px] text-muted-foreground tabular-nums">
              {currentPage} / {totalPages}
            </span>
            <button
              disabled={currentPage >= totalPages}
              onClick={() => goToPage(currentPage + 1)}
              className="px-2.5 py-1 rounded-md bg-secondary border border-white/8 text-[11px] font-semibold text-muted-foreground transition-colors hover:text-foreground hover:bg-secondary/80 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-muted-foreground disabled:hover:bg-secondary"
            >
              Next
            </button>
          </div>
        </nav>
      )}

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
