import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, Lightbulb, PhoneCall, ChevronRight, Loader2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { useUrlState } from "@/hooks/useUrlState";
import { getRenewalDesk, type RenewalDeskRow } from "@/lib/service-tickets-api";

interface RenewalOutreachDeskProps {
  /** Opens the call's ticket in the workspace. */
  onOpenTicket: (ticketId: string) => void;
}

/**
 * Rows per page.
 *
 * Paginated in the browser, not on the server, for the same reason the ticket
 * queue is: everything around the rows needs the whole set. The header counts
 * Active and Opening-soon across the desk, and the rows arrive pre-ranked by
 * `compareRenewalDeskRows`. Paging on the server would mean porting that
 * ranking into Mongo and recounting per badge — and the set is already bounded
 * by the 90-day renewal horizon.
 *
 * Four, not the queue's eight: a renewal row is a client header, an optional
 * overdue banner, the call band and a full-width CTA — roughly three times the
 * height of a ticket row — and this card sits in the narrower 40% column at the
 * same height as the queue.
 */
const PAGE_SIZE = 4;

/**
 * The page lives in the URL, like the queue's — but under **its own key**.
 *
 * `PriorityTicketQueue` already owns `?page=` on this very route, so reusing it
 * would wire the two boxes together: paging the renewals would silently page
 * the ticket queue beside it, and vice versa.
 *
 * Frozen at module scope so `useUrlState`'s memo dependencies stay stable
 * across renders. The default is `''`, so `?renewalPage=1` never appears.
 */
const URL_DEFAULTS = { renewalPage: "" };

const URL_ALLOWED = {
  renewalPage: (value: string) => /^[1-9]\d*$/.test(value),
} as const;

const priorityConfig = {
  high: { ring: "border-[#F59E0B]/30", badge: "bg-[#F59E0B]/10 text-[#F59E0B]", label: "High Priority" },
  medium: { ring: "border-[#0076A8]/30", badge: "bg-[#0076A8]/10 text-[#0076A8]", label: "Review Soon" },
  low: { ring: "border-white/8", badge: "bg-white/5 text-muted-foreground", label: "Monitor" },
  scheduled: { ring: "border-white/8", badge: "bg-white/5 text-muted-foreground", label: "Scheduled" },
};

/** A call the server is previewing — it has not opened yet, so it cannot be made. */
function isScheduled(row: RenewalDeskRow): boolean {
  return row.daysUntilAvailable !== null;
}

/**
 * Urgency band for a row. Derived from the server's `isOverdue`,
 * `daysUntilAvailable` and `daysUntilRenewal` — never from the browser clock.
 *
 * A previewed call gets its own band rather than one of the three urgency
 * tiers: its renewal may well be inside 14 days, and badging it "High Priority"
 * beside calls a rep can actually make today is how a desk stops being
 * skimmable.
 */
function priorityOf(row: RenewalDeskRow): keyof typeof priorityConfig {
  if (isScheduled(row)) return "scheduled";
  if (row.isOverdue || row.daysUntilRenewal <= 14) return "high";
  if (row.daysUntilRenewal <= 30) return "medium";
  return "low";
}

function opensLabel(days: number): string {
  if (days <= 0) return "opens today";
  return `opens in ${days} day${days === 1 ? "" : "s"}`;
}

/** "Jul 1" — display only; every decision already came from the server. */
function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function daysLabel(days: number): string {
  if (days < 0) return `renewed ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ago`;
  if (days === 0) return "renews today";
  return `${days} day${days === 1 ? "" : "s"} away`;
}

export function RenewalOutreachDesk({ onOpenTicket }: RenewalOutreachDeskProps) {
  const [urlState, setUrlState] = useUrlState({
    defaults: URL_DEFAULTS,
    allowed: URL_ALLOWED,
  });
  const page = Number(urlState.renewalPage) || 1;
  const listRef = useRef<HTMLDivElement>(null);

  // Reading the desk is also what materializes renewal cycles — there is no
  // cron, so this request is what makes newly-due renewals appear.
  const deskQuery = useQuery({
    queryKey: ["renewal-desk"],
    queryFn: getRenewalDesk,
  });

  const rows = deskQuery.data ?? [];
  // The badge counts work, not rows — and they count the whole desk, not the
  // page. Previewed calls are listed but cannot be made, so folding them into
  // "Active" would overstate the desk.
  const activeCount = rows.filter((row) => !isScheduled(row)).length;
  const scheduledCount = rows.length - activeCount;

  /*
   * Clamped while rendering, so the desk never paints a frame of "No policies
   * renewing" — completing the last call on the last page shrinks `rows` out
   * from under `page`, and correcting that in an effect alone would show the
   * empty state for one frame before fixing it.
   */
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pageRows = rows.slice(pageStart, pageStart + PAGE_SIZE);

  /*
   * Where the previewed run starts **on this page**, not across the whole desk.
   *
   * Rows arrive actionable-first, so computed globally this would label only
   * the page holding the transition: a later page made entirely of previewed
   * calls would render a run of disabled rows with no explanation, which is the
   * exact confusion the divider exists to prevent.
   */
  const firstScheduledId = pageRows.find(isScheduled)?.cycleId;

  const goToPage = (next: number) => {
    setUrlState({ renewalPage: next <= 1 ? "" : String(next) });
    // Rows are tall enough that a page can still scroll on a short viewport, so
    // land at the top of the new one rather than wherever the last was left.
    listRef.current?.scrollTo({ top: 0 });
  };

  /*
   * Reconcile the URL with the clamp above.
   *
   * The render already shows the right page, so this only fixes the address
   * bar — but leaving `?renewalPage=3` on a two-page desk is both a lie in a
   * URL somebody might paste and a trap: one new cycle materializing on the
   * next refetch would grow `totalPages` and silently jump the rep to page 3.
   */
  useEffect(() => {
    if (page !== currentPage) {
      setUrlState({ renewalPage: currentPage <= 1 ? "" : String(currentPage) });
    }
  }, [page, currentPage, setUrlState]);

  return (
    <div className="flex flex-col rounded-xl border border-white/8 bg-card overflow-hidden h-full">
      {/* Header */}
      <div className="px-5 pt-5 pb-4 border-b border-white/8">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground tracking-tight">Proactive Renewal Outreach</h2>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#0076A8]/10 border border-[#0076A8]/20">
            <div className="w-1.5 h-1.5 rounded-full bg-[#0076A8] animate-pulse" />
            <span className="text-[10px] font-semibold text-[#0076A8]">{activeCount} Active</span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Policies renewing soon — act before they call you
          {scheduledCount > 0 && ` · ${scheduledCount} opening soon`}
        </p>
      </div>

      {/* Client stack */}
      <div ref={listRef} className="flex-1 overflow-y-auto divide-y divide-white/5 px-4 py-2">
        {deskQuery.isPending && (
          <div className="flex items-center justify-center gap-2 h-32 text-sm text-muted-foreground">
            <Loader2 size={14} className="animate-spin" />
            Loading renewals…
          </div>
        )}

        {deskQuery.isError && (
          <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
            Could not load renewals.
          </div>
        )}

        {!deskQuery.isPending && !deskQuery.isError && rows.length === 0 && (
          <div className="flex items-center justify-center h-32 text-sm text-muted-foreground text-center px-6">
            No policies renewing in the next 90 days.
          </div>
        )}

        {pageRows.map((row) => {
          const cfg = priorityConfig[priorityOf(row)];
          const isMerged = row.mergedFrom.length > 0;
          const scheduled = isScheduled(row);

          return (
            <div
              key={row.cycleId}
              className={`py-4 group ${scheduled ? "opacity-70" : ""}`}
            >
              {/* One divider where the previewed calls begin, so the run of
                  disabled rows reads as a section rather than as rows that
                  mysteriously cannot be started. */}
              {row.cycleId === firstScheduledId && (
                <div className="flex items-center gap-2 mb-3 -mt-1">
                  <CalendarClock size={11} className="text-muted-foreground flex-shrink-0" />
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Opening soon
                  </span>
                  <span className="h-px flex-1 bg-white/8" />
                </div>
              )}
              {/* Top: client + renewal date */}
              <div className="flex items-start justify-between mb-2.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-semibold text-foreground truncate">{row.clientName}</span>
                    <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0 ${cfg.badge}`}>
                      {cfg.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground font-mono truncate">
                      {row.policies[0]?.policyNumber ?? row.ticketNumber}
                    </span>
                    <span className="text-white/20">·</span>
                    <span className="text-xs text-muted-foreground flex-shrink-0">
                      {row.policyCount} polic{row.policyCount === 1 ? "y" : "ies"}
                    </span>
                  </div>
                </div>
                <div className="text-right flex-shrink-0 ml-3">
                  <div className={`text-xs font-semibold ${scheduled ? "text-muted-foreground" : "text-[#0076A8]"}`}>
                    Renews {shortDate(row.renewalDate)}
                  </div>
                  <div className="text-[10px] text-muted-foreground">{daysLabel(row.daysUntilRenewal)}</div>
                </div>
              </div>

              {/* Overdue warning. Replaces the old premium-increase block: the
                  system holds no premium history, so nothing could populate it. */}
              {row.isOverdue && (
                <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-[#F59E0B]/8 border border-[#F59E0B]/15 mb-2.5">
                  <AlertTriangle size={13} className="text-[#F59E0B] flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="text-xs font-semibold text-[#F59E0B]">{row.label} overdue</span>
                    <div className="text-[10px] text-[#F59E0B]/60 mt-0.5">
                      {row.daysUntilRenewal >= 0
                        ? `Policy renews in ${row.daysUntilRenewal} days`
                        : "Policy has already renewed"}
                    </div>
                  </div>
                </div>
              )}

              {/* Which call this is, what it covers, and — when previewed —
                  when it opens. */}
              <div
                className={`flex items-center gap-2 px-3 py-2 rounded-lg mb-3 ${
                  scheduled
                    ? "bg-white/[0.03] border border-white/8"
                    : "bg-[#0076A8]/8 border border-[#0076A8]/15"
                }`}
              >
                {scheduled ? (
                  <CalendarClock size={12} className="text-muted-foreground flex-shrink-0" />
                ) : (
                  <Lightbulb size={12} className="text-[#0076A8] flex-shrink-0" />
                )}
                <span className={`text-[10px] font-semibold ${scheduled ? "text-muted-foreground" : "text-[#0076A8]"}`}>
                  {row.label}
                </span>
                {isMerged && (
                  <span className={`text-[10px] ${scheduled ? "text-muted-foreground/80" : "text-[#0076A8]/80"}`}>
                    · annual review merged in
                  </span>
                )}
                {scheduled && (
                  <span className="ml-auto text-[10px] font-semibold text-muted-foreground">
                    {opensLabel(row.daysUntilAvailable ?? 0)}
                  </span>
                )}
              </div>

              {/* CTA. Disabled while the call is only previewed — the API
                  refuses to complete a step before its `availableAt`, so an
                  enabled button here would be a promise the server breaks. */}
              <button
                onClick={() => row.ticketId && onOpenTicket(row.ticketId)}
                disabled={!row.ticketId || scheduled}
                title={
                  scheduled
                    ? `This call opens ${shortDate(row.availableAt ?? row.renewalDate)} — it can't be started yet.`
                    : undefined
                }
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-[#0076A8]/15 border border-[#0076A8]/25 text-xs font-semibold text-[#0076A8] hover:bg-[#0076A8]/25 hover:border-[#0076A8]/40 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-[#0076A8]/15 disabled:hover:border-[#0076A8]/25 transition-all duration-150 group-hover:shadow-sm"
              >
                <PhoneCall size={12} />
                {scheduled ? `${row.label} — ${opensLabel(row.daysUntilAvailable ?? 0)}` : `Start ${row.label}`}
                <ChevronRight size={12} className="ml-auto opacity-50" />
              </button>
            </div>
          );
        })}
      </div>

      {/* Pagination. Hidden on a single page: a footer that can only say "1 / 1"
          is chrome, and this card is short on vertical room.

          Markup mirrors `PriorityTicketQueue`'s footer deliberately — the two
          sit side by side in the same row, and two different paginators on one
          screen reads as an inconsistency rather than a distinction. That also
          means the same `white/8` + `bg-secondary` values: this whole card is
          written in them, so reaching for theme tokens here alone would leave a
          footer that does not match the box above it. The Service Dashboard is
          slated for a light-theme pass as a unit. */}
      {totalPages > 1 && (
        <nav
          aria-label="Renewal outreach pagination"
          className="flex-shrink-0 flex items-center justify-between gap-3 px-5 py-3 border-t border-white/8"
        >
          <span className="text-[11px] text-muted-foreground tabular-nums">
            Showing {pageStart + 1}–{pageStart + pageRows.length} of {rows.length}
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
    </div>
  );
}
