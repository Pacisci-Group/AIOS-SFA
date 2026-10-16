import { PRODUCER_NONE } from "@sfa/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { DataPanel } from "@/components/common/DataPanel";
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
import {
  getOwnerProducerQuotes,
  ownerDashboardKey,
} from "@/lib/owner-dashboard-api";
import type {
  OwnerDashboardParams,
  OwnerProducerQuotesRow,
} from "@/lib/owner-dashboard-api";
import { cn } from "@/lib/utils";
import { formatCount, formatMoney, formatPct } from "../owner-format";
import { ColumnHead } from "./ColumnHead";
import { ProducerAvatar } from "./ProducerLeaderboard";

/** Pinned so the loading state is the height of a typical team. */
const SKELETON_ROWS = 5;

/** What the drawer needs to open for a row. */
export interface QuotesProducer {
  /** A user id, or `PRODUCER_NONE` for the Unassigned row. */
  id: string;
  name: string;
}

/**
 * Quotes by producer (David, 15 Oct 2026): "quotes per producer and how many
 * they sold. Then when you click their name you see the open quotes for that
 * time frame." The open premium is the uncaptured revenue he wants to show.
 *
 * Every quote written in the period is **sold**, **open** or **lost**, and the
 * three columns add up to Quotes written on every row. Lost is shown so they do:
 * a quote on a lead marked Not Qualified, Lost or Closed is not uncaptured
 * revenue, and folding it into Open would overstate what is still there to win.
 *
 * Quotes written is the leaderboard's column of the same name, from the same
 * rows — the API asserts the totals agree — so the two cards cannot disagree
 * on a screen-share. The quote close % is the per-producer form of the quote
 * side of the Agency Closing Ratio card.
 *
 * Ordered by open quotes, most first: the card exists to say who is holding the
 * most unclosed business. Unassigned sits last, as on the leaderboard.
 *
 * Row and name both open the drawer; the name is the keyboard's way in, as on
 * the Manager view's Team Activity table. Below ~736px of panel width it lists
 * one producer per row instead, like the leaderboard.
 */
export function ProducerQuotesTable({
  params,
  onSelect,
}: {
  params: OwnerDashboardParams;
  onSelect: (producer: QuotesProducer) => void;
}) {
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: [...ownerDashboardKey, "producer-quotes", params],
    queryFn: () => getOwnerProducerQuotes(params),
    placeholderData: keepPreviousData,
  });

  const select = (row: OwnerProducerQuotesRow) =>
    onSelect({ id: row.producerId ?? PRODUCER_NONE, name: row.name });

  return (
    <DataPanel
      title="Quotes by producer"
      titleHint="Quotes written this period, how many have sold, and what is still open. Click a producer to see their open quotes."
      isPending={isPending}
      isError={isError}
      isEmpty={data?.rows.length === 0}
      emptyMessage="No quotes were written in this period."
      errorMessage="Couldn’t load the quotes."
      onRetry={() => void refetch()}
      skeletonRows={SKELETON_ROWS}
    >
      {data && (
        <div className="@container">
          <div className="hidden @min-[46rem]:block">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <ColumnHead label="Producer" className="pl-5" />
                  <ColumnHead
                    label="Quotes written"
                    hint="Quote recaps this producer wrote in this period. The same count as the leaderboard's Quotes written column."
                    align="right"
                  />
                  <ColumnHead
                    label="Quotes sold"
                    hint="Of those, how many have turned into a sale — even if it sold after the period ended. Company transfers don't count."
                    align="right"
                  />
                  <ColumnHead
                    label="Open quotes"
                    hint="Not sold yet, and the lead isn't marked Not Qualified, Lost or Closed. This is the business still there to win."
                    align="right"
                  />
                  <ColumnHead
                    label="Lost"
                    hint="Not sold, and the lead is marked Not Qualified, Lost or Closed."
                    align="right"
                  />
                  <ColumnHead
                    label="Open quoted premium"
                    hint="Premium quoted on the open quotes."
                    align="right"
                  />
                  <ColumnHead
                    label="Quote close %"
                    hint="Quotes sold ÷ quotes written."
                    align="right"
                  />
                  <TableHead className="w-10 pr-5" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map((row) => (
                  <QuotesRow
                    key={row.producerId ?? "unassigned"}
                    row={row}
                    onSelect={() => select(row)}
                  />
                ))}
              </TableBody>
              <TableFooter>
                <TableRow className="hover:bg-transparent">
                  <TableCell className="pl-5 font-medium">Total</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCount(data.totals.written)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCount(data.totals.sold)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCount(data.totals.open)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCount(data.totals.lost)}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {formatMoney(data.totals.openPremium)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatPct(data.totals.closePct)}
                  </TableCell>
                  <TableCell className="pr-5" />
                </TableRow>
              </TableFooter>
            </Table>
          </div>

          <ul className="divide-y divide-border @min-[46rem]:hidden">
            {data.rows.map((row) => (
              <li key={row.producerId ?? "unassigned"}>
                <button
                  type="button"
                  onClick={() => select(row)}
                  className="flex w-full gap-3 px-5 py-3 text-left text-sm transition-colors hover:bg-muted/50"
                >
                  <ProducerAvatar row={row} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <span
                        className={cn(
                          "truncate font-medium",
                          row.producerId === null
                            ? "text-muted-foreground"
                            : "text-foreground",
                        )}
                      >
                        {row.name}
                      </span>
                      <span className="shrink-0 font-semibold tabular-nums">
                        {formatMoney(row.openPremium)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                      {quoteStats(row)}
                    </p>
                  </div>
                  <ChevronRight
                    aria-hidden
                    className="size-4 shrink-0 self-center text-muted-foreground"
                  />
                </button>
              </li>
            ))}
            <li className="flex items-baseline justify-between gap-3 rounded-b-xl bg-muted/50 px-5 py-3 text-sm">
              <div className="min-w-0">
                <p className="font-medium">Total</p>
                <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                  {quoteStats(data.totals)}
                </p>
              </div>
              <span className="shrink-0 font-semibold tabular-nums">
                {formatMoney(data.totals.openPremium)}
              </span>
            </li>
          </ul>
        </div>
      )}
    </DataPanel>
  );
}

/** "12 written · 5 sold · 6 open · 1 lost" — the columns, as prose. */
function quoteStats({
  written,
  sold,
  open,
  lost,
}: Pick<OwnerProducerQuotesRow, "written" | "sold" | "open" | "lost">) {
  return [
    `${formatCount(written)} written`,
    `${formatCount(sold)} sold`,
    `${formatCount(open)} open`,
    `${formatCount(lost)} lost`,
  ].join(" · ");
}

function QuotesRow({
  row,
  onSelect,
}: {
  row: OwnerProducerQuotesRow;
  onSelect: () => void;
}) {
  const unassigned = row.producerId === null;

  return (
    <TableRow className="cursor-pointer" onClick={onSelect}>
      <TableCell className="pl-5">
        <div className="flex items-center gap-2.5">
          <ProducerAvatar row={row} />
          {/* The row's one real control: the name opens the drawer, and so
              does the row, but the button is what a keyboard reaches. */}
          <Button
            type="button"
            variant="link"
            className={cn(
              "h-auto p-0 font-medium",
              unassigned ? "text-muted-foreground" : "text-foreground",
            )}
            onClick={(event) => {
              event.stopPropagation();
              onSelect();
            }}
          >
            {row.name}
          </Button>
        </div>
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {formatCount(row.written)}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {formatCount(row.sold)}
      </TableCell>
      <TableCell className="text-right font-medium tabular-nums">
        {formatCount(row.open)}
      </TableCell>
      <TableCell className="text-right text-muted-foreground tabular-nums">
        {formatCount(row.lost)}
      </TableCell>
      <TableCell className="text-right font-semibold tabular-nums">
        {formatMoney(row.openPremium)}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {formatPct(row.closePct)}
      </TableCell>
      <TableCell className="pr-5 text-right">
        <ChevronRight
          aria-hidden
          className="ml-auto size-4 text-muted-foreground"
        />
      </TableCell>
    </TableRow>
  );
}
