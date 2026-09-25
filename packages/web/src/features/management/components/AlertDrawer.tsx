import { ModuleKey } from "@sfa/shared";
import type { ManagementDrawerKey } from "@sfa/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DrawerError,
  DrawerSkeleton,
  shortDate,
} from "@/features/clients/components/drawer-primitives";
import { statusBadgeClass } from "@/features/lead/components/lead-display";
import { formatCount } from "@/features/owner-dashboard/owner-format";
import { usePermissions } from "@/hooks/usePermissions";
import type { DashboardFilterParams } from "@/lib/dashboard-filter-params";
import {
  getManagementDrawer,
  managementDashboardKey,
} from "@/lib/management-dashboard-api";
import type {
  AgingAuditRow,
  OverdueTicketRow,
  StalledLeadRow,
} from "@/lib/management-dashboard-api";
import { NOT_AVAILABLE } from "@/lib/not-available";
import { cn } from "@/lib/utils";
import { ALERT_CARDS } from "./AlertCards";

/**
 * The drawer behind an alert card (PAC-139 §2): the records the number
 * counts, one row each, each opening the record.
 *
 * Not a redirect to a filtered Leads page — Asad offered, David said later
 * ("I don't want to go update this page until we get … the manager page and
 * the owner page with everything flowing properly"). The rows link where a
 * record already has a page: a lead to `/leads/:id`, a ticket to the ticket
 * workspace, and an audit to its **household** until the Deal Audit page
 * ships (PAC-106) — a deal with no household is plain text with a tooltip
 * saying so, rather than a link to nowhere.
 *
 * The page number is local: a fresh drawer starts on page 1, and the usual
 * drawer is one page (the API's default page size is 50).
 */
export function AlertDrawer({
  open,
  params,
  onClose,
}: {
  open: ManagementDrawerKey | null;
  params: DashboardFilterParams;
  onClose: () => void;
}) {
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [open, params]);

  const card = ALERT_CARDS.find((entry) => entry.key === open);

  const query = useQuery({
    queryKey: [...managementDashboardKey, "drawer", open, params, page],
    queryFn: () => getManagementDrawer(open!, params, page),
    enabled: open !== null,
    placeholderData: keepPreviousData,
  });

  return (
    <Sheet open={open !== null} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 border-l border-border p-0 sm:w-[480px] sm:max-w-[480px]"
      >
        <SheetHeader className="shrink-0 border-b border-border px-5 py-4">
          <SheetTitle className="flex items-center gap-2">
            {card?.label ?? "Alerts"}
            {query.data && (
              <Badge variant="secondary" size="sm" className="tabular-nums">
                {formatCount(query.data.total)}
              </Badge>
            )}
          </SheetTitle>
          <SheetDescription>{card?.detail}</SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {query.isPending && <DrawerSkeleton />}
          {query.isError && (
            <div className="space-y-3">
              <DrawerError message={`Couldn't load the ${card?.noun ?? "list"}.`} />
              <Button
                variant="outline"
                size="sm"
                onClick={() => void query.refetch()}
              >
                Try again
              </Button>
            </div>
          )}
          {query.data && query.data.items.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No {card?.noun} in this period.
            </p>
          )}
          {query.data && query.data.items.length > 0 && open && (
            <ul className="divide-y divide-border">
              {open === "stalled" &&
                (query.data.items as StalledLeadRow[]).map((row) => (
                  <StalledLeadItem key={row.leadId} row={row} />
                ))}
              {open === "aging" &&
                (query.data.items as AgingAuditRow[]).map((row) => (
                  <AgingAuditItem key={row.dealAuditId} row={row} />
                ))}
              {open === "overdue" &&
                (query.data.items as OverdueTicketRow[]).map((row) => (
                  <OverdueTicketItem key={row.ticketId} row={row} />
                ))}
            </ul>
          )}
        </div>

        {query.data && query.data.totalPages > 1 && (
          <div className="flex shrink-0 items-center justify-between border-t border-border px-5 py-3 text-sm text-muted-foreground">
            <span className="tabular-nums">
              Page {query.data.page} of {query.data.totalPages}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Previous page"
                disabled={page <= 1}
                onClick={() => setPage((current) => current - 1)}
              >
                <ChevronLeft />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Next page"
                disabled={page >= query.data.totalPages}
                onClick={() => setPage((current) => current + 1)}
              >
                <ChevronRight />
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/* ── Rows ────────────────────────────────────────────────────────────────── */

/** A row's headline: a link when the record has a page the caller may open. */
function RecordName({
  to,
  children,
  reason,
}: {
  to: string | null;
  children: string;
  /** Why there is no link, when there is none. */
  reason?: string;
}) {
  if (to) {
    return (
      <Link
        to={to}
        className="truncate font-medium text-foreground underline-offset-4 hover:underline"
      >
        {children}
      </Link>
    );
  }
  if (reason) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="truncate font-medium text-foreground">{children}</span>
        </TooltipTrigger>
        <TooltipContent>{reason}</TooltipContent>
      </Tooltip>
    );
  }
  return <span className="truncate font-medium text-foreground">{children}</span>;
}

function Meta({ children }: { children: React.ReactNode }) {
  return <p className="truncate text-xs text-muted-foreground">{children}</p>;
}

function hoursLabel(hours: number | null): string {
  if (hours === null) return "Never updated";
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function StalledLeadItem({ row }: { row: StalledLeadRow }) {
  const { canRead } = usePermissions();
  return (
    <li className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <RecordName to={canRead(ModuleKey.Leads) ? `/leads/${row.leadId}` : null}>
          {row.name}
        </RecordName>
        <Meta>
          {row.producerName ?? "Unassigned"}
          {row.leadSourceName ? ` · ${row.leadSourceName}` : ""}
        </Meta>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <Badge
          size="sm"
          className={cn("border-transparent", statusBadgeClass(row.status))}
        >
          {row.status}
        </Badge>
        <span className="text-xs text-muted-foreground tabular-nums">
          {hoursLabel(row.hoursSinceActivity)}
        </span>
      </div>
    </li>
  );
}

function AgingAuditItem({ row }: { row: AgingAuditRow }) {
  const { canRead } = usePermissions();
  const to =
    row.householdId && canRead(ModuleKey.Clients)
      ? `/clients/${row.householdId}`
      : null;
  return (
    <li className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <RecordName
          to={to}
          reason={
            row.householdId
              ? undefined
              : "This deal has no household on record; the Deal Audit page is coming with PAC-106."
          }
        >
          {row.clientName}
        </RecordName>
        <Meta>
          {row.producerName ?? "Unassigned"} · sold {shortDate(row.soldDate)}
        </Meta>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <Badge variant="outline" size="sm">
          {row.auditStatus}
        </Badge>
        <span className="text-xs text-muted-foreground tabular-nums">
          {row.businessDaysOpen} business days
          {row.openFailedCount > 0
            ? ` · ${row.openFailedCount} open item${row.openFailedCount === 1 ? "" : "s"}`
            : ""}
        </span>
      </div>
    </li>
  );
}

function OverdueTicketItem({ row }: { row: OverdueTicketRow }) {
  const { canRead } = usePermissions();
  const to = canRead(ModuleKey.CrmService)
    ? `/crm/tickets?ticket=${row.ticketId}`
    : null;
  return (
    <li className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <RecordName to={to}>{row.clientName}</RecordName>
        <Meta>
          {row.ticketNumber} · {row.category} ·{" "}
          {row.assignedRep || "Unassigned"}
        </Meta>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <Badge variant="destructive" size="sm">
          Overdue
        </Badge>
        <span className="text-xs text-muted-foreground tabular-nums">
          {row.daysOverdue === null
            ? `opened ${shortDate(row.openedAt)}`
            : `due ${shortDate(row.dueAt)} · ${row.daysOverdue}d over`}
          {row.dueAt === null && row.daysOverdue === null ? "" : ""}
        </span>
      </div>
      <span className="sr-only">{NOT_AVAILABLE}</span>
    </li>
  );
}
