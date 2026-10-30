import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate } from "@/features/lead/components/lead-display";
import type { DealAuditQueueRow } from "@/lib/deal-audits-api";
import { NOT_AVAILABLE } from "@/lib/not-available";
import { cn } from "@/lib/utils";
import {
  AUDIT_STATUS_LABELS,
  AUDIT_STATUS_STYLES,
  SENT_BACK_TEXT,
  businessDaysLabel,
  waitingHint,
} from "@/components/audit/review-display";

/**
 * The Deal Audits queue's rows (PAC-106): Producer · Client · Days sitting ·
 * Status · the action — the five columns David listed.
 *
 * A table from `lg` up, a stack of cards below it: five columns plus a button
 * do not fit a phone, and a horizontally scrolling table hides the action.
 */
export function DealAuditQueueTable({ rows }: { rows: DealAuditQueueRow[] }) {
  return (
    <>
      <div className="hidden lg:block">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-5">Producer</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Days sitting</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="pr-5 text-right">
                <span className="sr-only">Action</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.dealAuditId}>
                <TableCell className="pl-5">
                  <span className="block font-medium text-foreground">
                    {row.producerName ?? NOT_AVAILABLE}
                  </span>
                  {row.assigneeName && row.assigneeName !== row.producerName && (
                    // The person to chase, once a departed producer's work
                    // has been transferred to someone else.
                    <span className="block text-xs text-muted-foreground">
                      Assigned to {row.assigneeName}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <span className="block font-medium text-foreground">
                    {row.clientName}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    Sold {formatDate(row.soldDate)}
                  </span>
                </TableCell>
                <TableCell>
                  <DaysSitting row={row} />
                </TableCell>
                <TableCell>
                  <StatusCell row={row} />
                </TableCell>
                <TableCell className="pr-5 text-right">
                  <RowAction row={row} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul className="divide-y divide-border lg:hidden">
        {rows.map((row) => (
          <li key={row.dealAuditId} className="flex flex-col gap-2 px-4 py-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <span className="block truncate font-medium text-foreground">
                  {row.clientName}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {row.producerName ?? NOT_AVAILABLE} · sold{" "}
                  {formatDate(row.soldDate)}
                </span>
              </div>
              <DaysSitting row={row} />
            </div>
            <div className="flex items-end justify-between gap-3">
              <StatusCell row={row} />
              <RowAction row={row} />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * Business days since the sale (PAC-139's clock). Past the five-day SLA the
 * figure turns red and says so in words — colour alone is not an answer.
 */
function DaysSitting({ row }: { row: DealAuditQueueRow }) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <span
        className={cn(
          "text-sm tabular-nums",
          row.aging ? cn("font-semibold", SENT_BACK_TEXT) : "text-foreground",
        )}
      >
        {businessDaysLabel(row.businessDaysOpen)}
      </span>
      {row.aging && (
        <Badge
          size="sm"
          className={cn("border-transparent bg-red-500/12", SENT_BACK_TEXT)}
        >
          Aging
        </Badge>
      )}
    </div>
  );
}

function StatusCell({ row }: { row: DealAuditQueueRow }) {
  const hint = waitingHint(row.auditStatus);
  const { passed, failed } = row.counts;
  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      <Badge
        size="sm"
        className={cn("border-transparent", AUDIT_STATUS_STYLES[row.auditStatus])}
      >
        {AUDIT_STATUS_LABELS[row.auditStatus]}
      </Badge>
      <span className="text-xs text-muted-foreground tabular-nums">
        {row.auditStatus === "Pending"
          ? `${passed} of ${row.itemCount} passed${failed ? ` · ${failed} failed` : ""}`
          : hint}
      </span>
    </div>
  );
}

/**
 * **Perform audit** only where the manager can act: the audit is with them
 * and they did not submit it. Everything else still opens — the page is
 * readable in every state — but as a plain view.
 */
function RowAction({ row }: { row: DealAuditQueueRow }) {
  const to = `/deal-audits/${row.dealId}`;
  return row.canReview ? (
    <Button asChild size="sm">
      <Link to={to}>Perform audit</Link>
    </Button>
  ) : (
    <Button asChild size="sm" variant="outline">
      <Link to={to} aria-label={`View the audit for ${row.clientName}`}>
        View
      </Link>
    </Button>
  );
}
