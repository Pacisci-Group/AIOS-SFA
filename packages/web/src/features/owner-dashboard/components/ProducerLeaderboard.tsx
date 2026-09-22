import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  getOwnerProducers,
  ownerDashboardKey,
} from "@/lib/owner-dashboard-api";
import type {
  OwnerDashboardParams,
  OwnerProducerRow,
} from "@/lib/owner-dashboard-api";
import { UserX } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCount, formatMoney } from "../owner-format";
import { OwnerPanel } from "./OwnerPanel";
import { NOT_AVAILABLE } from "@/lib/not-available";

/** Pinned so the loading state is the height of a typical board. */
const SKELETON_ROWS = 6;

/**
 * The owner's producer leaderboard (PAC-135): quotes, items bound and premium,
 * ranked by premium, reacting to every filter.
 *
 * Not the Motivation Hub's `GET /leaderboard`. That one shows a producer their
 * rank and deliberately **never a colleague's dollars**; this is the view that
 * does, which is what `owner_dashboard:read` is for.
 *
 * Two things the mockup had that this does not. **Goal Progress** reads `N/A`
 * on every row: goals are not set anywhere yet (PAC-116), and a progress bar fed
 * by nothing would read as "everyone is at 0%". **On track / Lagging** is gone
 * for the same reason — it was a judgement against a goal that does not exist.
 *
 * "Unassigned" is sales with no producer attached. It is kept, last and
 * unranked, because without it this table's total would fall short of the Total
 * Bound Premium card above it.
 */
export function ProducerLeaderboard({
  params,
  className,
}: {
  params: OwnerDashboardParams;
  className?: string;
}) {
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: [...ownerDashboardKey, "producers", params],
    queryFn: () => getOwnerProducers(params),
    placeholderData: keepPreviousData,
  });

  return (
    <OwnerPanel
      title="Producer leaderboard"
      isPending={isPending}
      isError={isError}
      isEmpty={data?.rows.length === 0}
      emptyMessage="No producer sold or quoted anything in this period."
      errorMessage="Couldn’t load the leaderboard."
      onRetry={() => void refetch()}
      skeletonRows={SKELETON_ROWS}
      className={className}
    >
      {data && (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-12 pl-5">#</TableHead>
              <TableHead>Producer</TableHead>
              <TableHead className="text-right">Quotes</TableHead>
              <TableHead className="text-right">Bound</TableHead>
              <TableHead className="text-right">Total premium</TableHead>
              <TableHead className="pr-5 text-right">Goal progress</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.rows.map((row) => (
              <LeaderboardRow key={row.producerId ?? "unassigned"} row={row} />
            ))}
          </TableBody>
          <TableFooter>
            <TableRow className="hover:bg-transparent">
              <TableCell className="pl-5" />
              <TableCell className="font-medium">Total</TableCell>
              <TableCell className="text-right tabular-nums">
                {formatCount(data.totals.quotes)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatCount(data.totals.bound)}
              </TableCell>
              <TableCell className="text-right font-semibold tabular-nums">
                {formatMoney(data.totals.premium)}
              </TableCell>
              <TableCell className="pr-5" />
            </TableRow>
          </TableFooter>
        </Table>
      )}
    </OwnerPanel>
  );
}

function LeaderboardRow({ row }: { row: OwnerProducerRow }) {
  const unassigned = row.producerId === null;

  return (
    <TableRow>
      <TableCell className="pl-5 text-muted-foreground tabular-nums">
        {/* Not a competitor, so it carries no rank. */}
        {unassigned ? NOT_AVAILABLE : row.rank}
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
              unassigned
                ? "bg-muted text-muted-foreground"
                : "bg-primary/12 text-primary",
            )}
          >
            {/* Nobody to take initials from — an icon, not a glyph standing in
                for a name. */}
            {unassigned ? <UserX className="size-4" /> : row.initials}
          </span>
          <span
            className={cn(
              "truncate font-medium",
              unassigned ? "text-muted-foreground" : "text-foreground",
            )}
          >
            {row.name}
          </span>
        </div>
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {formatCount(row.quotes)}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {formatCount(row.bound)}
      </TableCell>
      <TableCell className="text-right font-semibold tabular-nums">
        {formatMoney(row.premium)}
      </TableCell>
      <TableCell className="pr-5 text-right text-muted-foreground">
        <Tooltip>
          <TooltipTrigger asChild>
            <span aria-label="Goals are not set up yet">{NOT_AVAILABLE}</span>
          </TooltipTrigger>
          <TooltipContent>Goals aren&rsquo;t set up yet.</TooltipContent>
        </Tooltip>
      </TableCell>
    </TableRow>
  );
}
