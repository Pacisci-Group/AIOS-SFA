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
  getOwnerLeadSources,
  ownerDashboardKey,
} from "@/lib/owner-dashboard-api";
import type {
  OwnerDashboardParams,
  OwnerLeadSourceRow,
} from "@/lib/owner-dashboard-api";
import { cn } from "@/lib/utils";
import { formatCount, formatMoney, formatPct } from "../owner-format";
import { OwnerPanel } from "./OwnerPanel";

const SKELETON_ROWS = 6;

type Conversion = Pick<OwnerLeadSourceRow, "convPct" | "convGap">;

const GAP_COPY: Record<NonNullable<OwnerLeadSourceRow["convGap"]>, string> = {
  no_quotes: "No quotes recorded for this source in this period.",
  too_few_quotes:
    "Too few quotes recorded against these sales to give a meaningful rate.",
};

/** A rate, or a dash that says why there isn't one. */
function ConversionCell({ convPct, convGap }: Conversion) {
  if (convPct !== null || convGap === null) {
    return <span className="tabular-nums">{formatPct(convPct)}</span>;
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-help text-muted-foreground">—</span>
      </TooltipTrigger>
      <TooltipContent>{GAP_COPY[convGap]}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Conv % · Vol · Premium per lead source (PAC-135).
 *
 * The mockup titles this an "ROI matrix". Nothing in the system records what a
 * lead source *costs*, so there is no return to compute — this is lead-source
 * performance, and the title says so rather than promising a number we cannot
 * produce.
 *
 * - **Conv %** is premium-based, sold ÷ quoted, the same rule as the closing
 *   ratio card — and refuses a rate on the same grounds that card does.
 * - **Vol** is leads received. The line-of-business filter cannot apply to it: a
 *   lead is not a policy. The sub heading says so whenever that filter is on,
 *   because a column that silently ignores a filter looks like a bug.
 * - **No source** is kept, last. On migrated data it is large — about two thirds
 *   of historic deals carry no source — and hiding it would make this table's
 *   total disagree with the card above.
 *
 * The mockup's relative premium bar per row is dropped: next to a "No source"
 * row that dwarfs every real channel, it would draw every channel as a sliver.
 */
export function LeadSourceMatrix({
  params,
  className,
}: {
  params: OwnerDashboardParams;
  className?: string;
}) {
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: [...ownerDashboardKey, "lead-sources", params],
    queryFn: () => getOwnerLeadSources(params),
    placeholderData: keepPreviousData,
  });

  return (
    <OwnerPanel
      title="Lead source performance"
      subheading={
        params.policyTypes.length > 0 && (
          <p className="mt-1 text-xs text-muted-foreground">
            Vol counts every lead received — a lead has no line of business.
          </p>
        )
      }
      isPending={isPending}
      isError={isError}
      isEmpty={data?.rows.length === 0}
      emptyMessage="No leads, quotes or sales in this period."
      errorMessage="Couldn’t load the lead sources."
      onRetry={() => void refetch()}
      skeletonRows={SKELETON_ROWS}
      className={className}
    >
      {data && (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-5">Source</TableHead>
              <TableHead className="text-right">Conv %</TableHead>
              <TableHead className="text-right">Vol</TableHead>
              <TableHead className="pr-5 text-right">Premium</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.rows.map((row) => (
              <TableRow key={row.leadSourceId ?? "none"}>
                <TableCell
                  className={cn(
                    "pl-5 font-medium",
                    row.leadSourceId === null
                      ? "text-muted-foreground"
                      : "text-foreground",
                  )}
                >
                  {row.name}
                </TableCell>
                <TableCell className="text-right">
                  <ConversionCell {...row} />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCount(row.volume)}
                </TableCell>
                <TableCell className="pr-5 text-right font-semibold tabular-nums">
                  {formatMoney(row.premium)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow className="hover:bg-transparent">
              <TableCell className="pl-5 font-medium">
                Total across all sources
              </TableCell>
              <TableCell className="text-right">
                <ConversionCell {...data.totals} />
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatCount(data.totals.volume)}
              </TableCell>
              <TableCell className="pr-5 text-right font-semibold tabular-nums">
                {formatMoney(data.totals.premium)}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      )}
    </OwnerPanel>
  );
}
