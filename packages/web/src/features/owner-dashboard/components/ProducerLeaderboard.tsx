import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
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
import { DataPanel } from "@/components/common/DataPanel";
import { ColumnHead } from "./ColumnHead";
import { NOT_AVAILABLE } from "@/lib/not-available";

/** Pinned so the loading state is the height of a typical board. */
const SKELETON_ROWS = 6;

/**
 * The owner's producer leaderboard (PAC-135): quotes written, items bound and
 * bound premium, ranked by premium, reacting to every filter.
 *
 * Every header names the thing *and* the unit, and reuses the KPI cards' words
 * ("Items bound", "Bound premium") so a column and the card it sums to share a
 * name. The first cut said "Bound" and "Total premium", and the owner could not
 * tell whether Bound was deals, policies or items — it is items — while "Total"
 * on a per-producer row read as a sum of something.
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
 *
 * The six columns need ~720px. Where the panel is narrower — a phone, a tablet,
 * a laptop with the sidebar open — it lists one producer per row instead, with
 * the premium beside the name where the eye lands first. It switches on the
 * **panel's** width (`@container`), not the screen's, because the same panel is
 * full-width when stacked and 60% wide beside the lead-source table. The list
 * leaves out Goal progress: it is `N/A` on every row until goals exist, and a
 * line of `N/A` per producer on a phone is noise.
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
    <DataPanel
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
        <div className="@container">
          <div className="hidden @min-[46rem]:block">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <ColumnHead
                    label="Rank"
                    hint="Position by bound premium in this period."
                    className="w-16 pl-5"
                  />
                  <ColumnHead label="Producer" />
                  <ColumnHead
                    label="Quotes written"
                    hint="Quote recaps this producer wrote in this period."
                    align="right"
                  />
                  <ColumnHead
                    label="Items bound"
                    hint="Insured items — cars, homes and the like — across every policy this producer sold in this period. The Items Bound card is the sum of this column."
                    align="right"
                  />
                  <ColumnHead
                    label="Bound premium"
                    hint="Premium on new business this producer sold in this period. The Total Bound Premium card is the sum of this column."
                    align="right"
                  />
                  <ColumnHead
                    label="Goal progress"
                    hint="How far this producer is toward their premium goal. Goals aren’t set up yet."
                    align="right"
                    className="pr-5"
                  />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map((row) => (
                  <LeaderboardRow
                    key={row.producerId ?? "unassigned"}
                    row={row}
                  />
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
          </div>

          <ul className="divide-y divide-border @min-[46rem]:hidden">
            {data.rows.map((row) => (
              <LeaderboardItem key={row.producerId ?? "unassigned"} row={row} />
            ))}
            <li className="flex items-baseline justify-between gap-3 rounded-b-xl bg-muted/50 px-5 py-3 text-sm">
              <div className="min-w-0">
                <p className="font-medium">Total</p>
                <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                  {producerStats(data.totals)}
                </p>
              </div>
              <span className="shrink-0 font-semibold tabular-nums">
                {formatMoney(data.totals.premium)}
              </span>
            </li>
          </ul>
        </div>
      )}
    </DataPanel>
  );
}

function countOf(value: number, one: string, many: string): string {
  return `${formatCount(value)} ${value === 1 ? one : many}`;
}

/** "11 quotes written · 21 items bound" — the table's column names, as prose. */
function producerStats({ quotes, bound }: { quotes: number; bound: number }) {
  return [
    countOf(quotes, "quote written", "quotes written"),
    countOf(bound, "item bound", "items bound"),
  ].join(" · ");
}

/** Initials in a circle, or — for Unassigned — an icon. */
function ProducerAvatar({ row }: { row: OwnerProducerRow }) {
  const unassigned = row.producerId === null;

  return (
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
  );
}

/** One producer in the narrow-panel list. */
function LeaderboardItem({ row }: { row: OwnerProducerRow }) {
  const unassigned = row.producerId === null;

  return (
    <li className="flex gap-3 px-5 py-3 text-sm">
      <ProducerAvatar row={row} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <span
            className={cn(
              "truncate font-medium",
              unassigned ? "text-muted-foreground" : "text-foreground",
            )}
          >
            {row.name}
          </span>
          <span className="shrink-0 font-semibold tabular-nums">
            {formatMoney(row.premium)}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
          {/* Not a competitor, so it carries no rank. */}
          {unassigned ? "" : `#${row.rank} · `}
          {producerStats(row)}
        </p>
      </div>
    </li>
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
          <ProducerAvatar row={row} />
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
