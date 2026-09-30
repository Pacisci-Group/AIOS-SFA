import { useQuery } from "@tanstack/react-query";
import { CalendarClock, ChevronRight, Loader2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { RENEWAL_DESK_PREVIEW_DAYS } from "@sfa/shared";
import { useAuth } from "@/contexts/auth-context";
import { useUrlState } from "@/hooks/useUrlState";
import { getRenewalDesk, type RenewalDeskRow } from "@/lib/service-tickets-api";

interface RenewalOutreachDeskProps {
  /**
   * Opens the call's ticket in the workspace — to read ahead, not to make the
   * call: every row is one that has not opened, and the API refuses to
   * complete a call before its `availableAt`.
   *
   * `isMine` is whether the viewer is the call's assignee. An owner or branch
   * manager sees other people's renewals here (PAC-146), and the workspace
   * list beside a colleague's ticket should be one that contains it.
   */
  onOpenTicket: (ticketId: string, isMine: boolean) => void;
}

/**
 * Rows per page.
 *
 * Paginated in the browser, not on the server, for the same reason the ticket
 * queue is: everything around the rows needs the whole set. The header counts
 * Active and Opening-soon across the desk, and the rows arrive pre-ranked by
 * `compareRenewalDeskRows`. Paging on the server would mean porting that
 * ranking into Mongo — and the set is already bounded by the two-week preview
 * window.
 *
 * Four, not the queue's eight: a renewal row is a client header, the call band
 * and a full-width CTA — roughly three times the
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

/**
 * Since PAC-143 every row on the desk is a renewal whose first call has not
 * opened — the two weeks before its renewal period starts. Once the call
 * opens it leaves the desk and is worked from the ticket queue, so there is
 * no "start the call", "overdue" or "active" state here to render.
 */
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
  const { user } = useAuth();
  const listRef = useRef<HTMLDivElement>(null);

  // Cycles are materialized by the worker's scan (PAC-99); this is a read.
  const deskQuery = useQuery({
    queryKey: ["renewal-desk"],
    queryFn: getRenewalDesk,
  });

  const rows = deskQuery.data ?? [];

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
            <CalendarClock size={10} className="text-[#0076A8]" />
            <span className="text-[10px] font-semibold text-[#0076A8]">{rows.length} Upcoming</span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Renewals starting in the next {RENEWAL_DESK_PREVIEW_DAYS} days — plan
          ahead before the call opens
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
            No renewals starting in the next {RENEWAL_DESK_PREVIEW_DAYS} days.
          </div>
        )}

        {pageRows.map((row) => {
          const isMerged = row.mergedFrom.length > 0;
          const isMine = row.assignedUserId === user?.id;

          return (
            <div key={row.cycleId} className="py-4 group">
              {/* Top: client + renewal date */}
              <div className="flex items-start justify-between mb-2.5">
                <div className="min-w-0">
                  <div className="mb-0.5">
                    <span className="block text-sm font-semibold text-foreground truncate">{row.clientName}</span>
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
                  {/* Only when it is someone else's: on a rep's own desk every
                      row is theirs, and saying so each time is noise. */}
                  {!isMine && (
                    <div className="mt-0.5 text-[10px] text-muted-foreground truncate">
                      Assigned to {row.assignedRep || "nobody"}
                    </div>
                  )}
                </div>
                <div className="text-right flex-shrink-0 ml-3">
                  <div className="text-xs font-semibold text-[#0076A8]">
                    Renews {shortDate(row.renewalDate)}
                  </div>
                  <div className="text-[10px] text-muted-foreground">{daysLabel(row.daysUntilRenewal)}</div>
                </div>
              </div>

              {/* Which call this is, what it covers, and when it opens. */}
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg mb-3 bg-[#0076A8]/8 border border-[#0076A8]/15">
                <CalendarClock size={12} className="text-[#0076A8] flex-shrink-0" />
                <span className="text-[10px] font-semibold text-[#0076A8]">{row.label}</span>
                {isMerged && (
                  <span className="text-[10px] text-[#0076A8]/80">· annual review merged in</span>
                )}
                <span
                  className="ml-auto text-[10px] font-semibold text-muted-foreground"
                  title={row.availableAt ? `Opens ${shortDate(row.availableAt)}` : undefined}
                >
                  {opensLabel(row.daysUntilAvailable)}
                </span>
              </div>

              {/* CTA. Opens the ticket to read ahead; the call itself can only
                  be completed once it opens, which the API enforces. */}
              <button
                onClick={() => row.ticketId && onOpenTicket(row.ticketId, isMine)}
                disabled={!row.ticketId}
                className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg bg-[#0076A8]/15 border border-[#0076A8]/25 text-xs font-semibold text-[#0076A8] hover:bg-[#0076A8]/25 hover:border-[#0076A8]/40 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-150 group-hover:shadow-sm"
              >
                View ticket
                <ChevronRight size={12} className="opacity-50" />
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
