import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Lightbulb, PhoneCall, ChevronRight, Loader2 } from "lucide-react";
import { getRenewalDesk, type RenewalDeskRow } from "@/lib/service-tickets-api";

interface RenewalOutreachDeskProps {
  /** Opens the call's ticket in the workspace. */
  onOpenTicket: (ticketId: string) => void;
}

const priorityConfig = {
  high: { ring: "border-[#F59E0B]/30", badge: "bg-[#F59E0B]/10 text-[#F59E0B]", label: "High Priority" },
  medium: { ring: "border-[#0076A8]/30", badge: "bg-[#0076A8]/10 text-[#0076A8]", label: "Review Soon" },
  low: { ring: "border-white/8", badge: "bg-white/5 text-muted-foreground", label: "Monitor" },
};

/**
 * Urgency band for a row. Derived from the server's `isOverdue` and
 * `daysUntilRenewal` — never from the browser clock.
 */
function priorityOf(row: RenewalDeskRow): keyof typeof priorityConfig {
  if (row.isOverdue || row.daysUntilRenewal <= 14) return "high";
  if (row.daysUntilRenewal <= 30) return "medium";
  return "low";
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
  // Reading the desk is also what materializes renewal cycles — there is no
  // cron, so this request is what makes newly-due renewals appear.
  const deskQuery = useQuery({
    queryKey: ["renewal-desk"],
    queryFn: getRenewalDesk,
  });

  const rows = deskQuery.data ?? [];

  return (
    <div className="flex flex-col rounded-xl border border-white/8 bg-card overflow-hidden h-full">
      {/* Header */}
      <div className="px-5 pt-5 pb-4 border-b border-white/8">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground tracking-tight">Proactive Renewal Outreach</h2>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#0076A8]/10 border border-[#0076A8]/20">
            <div className="w-1.5 h-1.5 rounded-full bg-[#0076A8] animate-pulse" />
            <span className="text-[10px] font-semibold text-[#0076A8]">{rows.length} Active</span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-1">Policies renewing soon — act before they call you</p>
      </div>

      {/* Client stack */}
      <div className="flex-1 overflow-y-auto divide-y divide-white/5 px-4 py-2">
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

        {rows.map((row) => {
          const cfg = priorityConfig[priorityOf(row)];
          const isMerged = row.mergedFrom.length > 0;

          return (
            <div key={row.cycleId} className="py-4 group">
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
                  <div className="text-xs font-semibold text-[#0076A8]">Renews {shortDate(row.renewalDate)}</div>
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

              {/* Which call this is, and what it covers. */}
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#0076A8]/8 border border-[#0076A8]/15 mb-3">
                <Lightbulb size={12} className="text-[#0076A8] flex-shrink-0" />
                <span className="text-[10px] font-semibold text-[#0076A8]">{row.label}</span>
                {isMerged && (
                  <span className="text-[10px] text-[#0076A8]/80">· annual review merged in</span>
                )}
              </div>

              {/* CTA */}
              <button
                onClick={() => row.ticketId && onOpenTicket(row.ticketId)}
                disabled={!row.ticketId}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-[#0076A8]/15 border border-[#0076A8]/25 text-xs font-semibold text-[#0076A8] hover:bg-[#0076A8]/25 hover:border-[#0076A8]/40 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-150 group-hover:shadow-sm"
              >
                <PhoneCall size={12} />
                Start {row.label}
                <ChevronRight size={12} className="ml-auto opacity-50" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
