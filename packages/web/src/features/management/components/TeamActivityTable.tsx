import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { AvailabilityBadge } from "@/components/common/AvailabilityBadge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { OwnerPanel } from "@/features/owner-dashboard/components/OwnerPanel";
import { formatCount, formatPct } from "@/features/owner-dashboard/owner-format";
import type { DashboardFilterParams } from "@/lib/dashboard-filter-params";
import {
  getTeamActivity,
  managementDashboardKey,
} from "@/lib/management-dashboard-api";
import type { TeamActivityRow } from "@/lib/management-dashboard-api";
import { cn } from "@/lib/utils";

/** Pinned so the loading state is the height of a typical team. */
const SKELETON_ROWS = 5;

/**
 * The Team Activity table (PAC-139 §3): one row per producer, every column
 * named for what it counts — **households**, David's explicit choice for this
 * page (00:24:04) — and a Team Total.
 *
 * What changed from the mockup, and why:
 * - **Calls Today is gone.** Nothing tracks calls ("we don't have a way to set
 *   in RingCentral to mark the calls"), and David will not rely on producers
 *   logging them.
 * - **Status** is the producer's own availability switch (§6), not "logged in".
 * - **Quotes Issued / Deals Closed / Close Rate** became Households Quoted /
 *   Households Sold / Household Close Ratio — the last named so it cannot be
 *   read as the Owner view's *premium* closing ratio.
 * - **Pending Items** became Open Audit Items: the producer's outstanding
 *   deal-audit items, an all-time backlog — the one figure on the page the
 *   period chips do not move, which the sub-heading says.
 *
 * The producer filter does not reach this table: "how many producers have
 * stalled leads" is a question about the cards, and the table is the team.
 */
export function TeamActivityTable({
  params,
  onSelect,
}: {
  params: DashboardFilterParams;
  onSelect: (producerId: string) => void;
}) {
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: [...managementDashboardKey, "team", params],
    queryFn: () => getTeamActivity(params),
    placeholderData: keepPreviousData,
  });

  return (
    <OwnerPanel
      title="Team activity"
      subheading="Households quoted and sold this period. Open audit items are all-time. Click a producer to open their pipeline."
      isPending={isPending}
      isError={isError}
      isEmpty={data?.rows.length === 0}
      emptyMessage="Nobody on the team holds the producer role, and nobody sold or quoted anything in this period."
      errorMessage="Couldn’t load the team."
      onRetry={() => void refetch()}
      skeletonRows={SKELETON_ROWS}
    >
      {data && (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-5">Producer</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Households quoted</TableHead>
              <TableHead className="text-right">Households sold</TableHead>
              <TableHead className="text-right">Household close ratio</TableHead>
              <TableHead className="text-right">Open audit items</TableHead>
              <TableHead className="w-10 pr-5" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.rows.map((row) => (
              <ProducerRow key={row.producerId} row={row} onSelect={onSelect} />
            ))}
          </TableBody>
          <TableFooter>
            <TableRow className="hover:bg-transparent">
              <TableCell className="pl-5 font-medium">Team total</TableCell>
              <TableCell />
              <TableCell className="text-right tabular-nums">
                {formatCount(data.totals.householdsQuoted)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatCount(data.totals.householdsSold)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatPct(data.totals.householdCloseRatio)}
              </TableCell>
              <TableCell className="text-right font-semibold tabular-nums">
                {formatCount(data.totals.openAuditItems)}
              </TableCell>
              <TableCell className="pr-5" />
            </TableRow>
          </TableFooter>
        </Table>
      )}
    </OwnerPanel>
  );
}

function ProducerRow({
  row,
  onSelect,
}: {
  row: TeamActivityRow;
  onSelect: (producerId: string) => void;
}) {
  return (
    <TableRow
      className="cursor-pointer"
      onClick={() => onSelect(row.producerId)}
    >
      <TableCell className="pl-5">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/12 text-xs font-semibold text-primary"
          >
            {row.initials}
          </span>
          {/* The row's one real control: the name opens the drawer, and so
              does the row, but the button is what a keyboard reaches. */}
          <Button
            type="button"
            variant="link"
            className="h-auto p-0 font-medium text-foreground"
            onClick={(event) => {
              event.stopPropagation();
              onSelect(row.producerId);
            }}
          >
            {row.name}
          </Button>
        </div>
      </TableCell>
      <TableCell>
        <AvailabilityBadge value={row.availability} />
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {formatCount(row.householdsQuoted)}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {formatCount(row.householdsSold)}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {formatPct(row.householdCloseRatio)}
      </TableCell>
      <TableCell
        className={cn(
          "text-right font-semibold tabular-nums",
          row.openAuditItems > 0 ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {formatCount(row.openAuditItems)}
      </TableCell>
      <TableCell className="pr-5 text-right">
        <ChevronRight aria-hidden className="ml-auto size-4 text-muted-foreground" />
      </TableCell>
    </TableRow>
  );
}
