import { ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatPhone, type LeadRow } from "@/lib/leads-api";
import {
  statusBadgeClass,
  temperatureDot,
  temperatureText,
} from "./lead-display";

/** Name · Source · Status · Temperature · Phone · Email · Actions */
const GRID_COLS = "1.4fr 1fr 100px 110px 130px 1.2fr 80px";

const HEADERS = [
  "Name",
  "Lead Source",
  "Status",
  "Temperature",
  "Phone",
  "Email",
  "",
];

interface LeadsTableProps {
  leads: LeadRow[];
  isPending: boolean;
  pageSize: number;
}

/**
 * Desktop Leads table. CSS-grid rows rather than the `Table` primitive, matching
 * the list pattern already established on the Users page and the hand-off board.
 */
export function LeadsTable({ leads, isPending, pageSize }: LeadsTableProps) {
  return (
    <div className="rounded-xl overflow-hidden bg-card border border-border">
      <div
        className="grid px-5 py-2.5 gap-3 text-[10px] uppercase tracking-widest text-slate-600 border-b border-border"
        style={{ gridTemplateColumns: GRID_COLS }}
      >
        {HEADERS.map((header, i) => (
          <span key={header || `spacer-${i}`}>{header}</span>
        ))}
      </div>

      {isPending
        ? Array.from({ length: Math.min(pageSize, 8) }).map((_, i) => (
            <div
              key={i}
              className="grid px-5 py-3.5 gap-3 items-center border-b border-border"
              style={{ gridTemplateColumns: GRID_COLS }}
            >
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-3 w-36" />
              <Skeleton className="h-3 w-4 justify-self-end" />
            </div>
          ))
        : leads.map((lead, i) => (
            <Link
              key={lead.id}
              to={`/leads/${lead.id}`}
              className={cn(
                "grid px-5 py-3.5 gap-3 items-center transition-colors hover:bg-white/[0.03]",
                i < leads.length - 1 && "border-b border-border",
              )}
              style={{ gridTemplateColumns: GRID_COLS }}
            >
              <span className="text-sm text-foreground font-medium truncate">
                {lead.name}
              </span>

              <span className="text-xs text-muted-foreground truncate">
                {lead.leadSource}
              </span>

              <Badge
                className={cn(
                  "rounded-full text-[10px] px-2 py-0.5 w-fit border-transparent font-semibold",
                  statusBadgeClass(lead.status),
                )}
              >
                {lead.status}
              </Badge>

              <span
                className="flex items-center gap-1.5 min-w-0"
                title={`Temperature: ${lead.temperature}`}
              >
                <span
                  className={cn(
                    "w-2.5 h-2.5 rounded-full shrink-0",
                    temperatureDot[lead.temperature],
                  )}
                />
                <span className={cn("text-xs", temperatureText[lead.temperature])}>
                  {lead.temperature}
                </span>
              </span>

              <span className="text-xs text-muted-foreground truncate">
                {formatPhone(lead.phone)}
              </span>

              <span className="text-xs text-muted-foreground truncate">
                {lead.email ?? "—"}
              </span>

              <span className="flex items-center gap-1 justify-self-end text-xs text-primary">
                Open
                <ChevronRight size={14} className="text-slate-600" />
              </span>
            </Link>
          ))}
    </div>
  );
}
