import { ModuleKey, PRODUCER_NONE } from "@sfa/shared";
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
import { usePermissions } from "@/hooks/usePermissions";
import {
  getOwnerOpenQuotes,
  ownerDashboardKey,
} from "@/lib/owner-dashboard-api";
import type {
  OwnerDashboardParams,
  OwnerOpenQuoteRow,
} from "@/lib/owner-dashboard-api";
import { NOT_AVAILABLE } from "@/lib/not-available";
import { cn } from "@/lib/utils";
import { formatCount, formatMoney } from "../owner-format";
import { ProducerAvatar } from "./ProducerLeaderboard";

const OPEN_QUOTES_HINT =
  "Quotes written this period that have not sold, on leads that are still live.";

/**
 * One producer's open quotes for the period (David, 15 Oct 2026: "when you
 * click their name you see the open quotes for that time frame … this can open
 * in a side drawer").
 *
 * Open means not sold and not on a lead marked Not Qualified, Lost or Closed —
 * the same rule as the card's Open quotes column, so the badge count here is
 * that cell. A lead badge reading **Sold** marks a lead someone set to Sold with
 * no deal behind it: still an open quote by the numbers, and worth a look.
 *
 * Newest first, 50 to a page. The page is local state, reset whenever the
 * producer or the filter changes, as in the Manager view's alert drawers.
 */
export function OpenQuotesDrawer({
  producer,
  fallbackName,
  params,
  onClose,
}: {
  /** A user id, `PRODUCER_NONE`, or `null` when closed. */
  producer: string | null;
  /** The row's name, shown while the first page loads. */
  fallbackName?: string;
  params: OwnerDashboardParams;
  onClose: () => void;
}) {
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [producer, params]);

  const query = useQuery({
    queryKey: [...ownerDashboardKey, "open-quotes", producer, params, page],
    queryFn: () => getOwnerOpenQuotes(params, producer!, page),
    enabled: producer !== null,
    placeholderData: keepPreviousData,
  });
  const data = query.data;
  const name =
    data?.producer.name ??
    fallbackName ??
    (producer === PRODUCER_NONE ? "Unassigned" : "Producer");

  return (
    <Sheet open={producer !== null} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 border-l border-border p-0 sm:w-[480px] sm:max-w-[480px]"
      >
        <SheetHeader className="shrink-0 border-b border-border px-5 py-4">
          <div className="flex items-center gap-3">
            <ProducerAvatar
              row={{
                producerId: producer === PRODUCER_NONE ? null : producer,
                initials: data?.producer.initials ?? "…",
              }}
            />
            <div className="min-w-0">
              <SheetTitle className="flex items-center gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    {/* Focusable so a keyboard reaches the hint too; the
                        dotted underline is the cue that there is one. */}
                    <span
                      tabIndex={0}
                      className="cursor-help truncate underline decoration-muted-foreground/50 decoration-dotted underline-offset-4"
                    >
                      Open quotes · {name}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-72">
                    {OPEN_QUOTES_HINT}
                  </TooltipContent>
                </Tooltip>
                {data && (
                  <Badge variant="secondary" size="sm" className="tabular-nums">
                    {formatCount(data.total)}
                  </Badge>
                )}
              </SheetTitle>
              {/* Kept for screen readers: the dialog is described by it. */}
              <SheetDescription className="sr-only">
                {OPEN_QUOTES_HINT}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {query.isPending && <DrawerSkeleton />}
          {query.isError && (
            <div className="space-y-3">
              <DrawerError message="Couldn't load the open quotes." />
              <Button
                variant="outline"
                size="sm"
                onClick={() => void query.refetch()}
              >
                Try again
              </Button>
            </div>
          )}
          {data && data.items.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No open quotes in this period.
            </p>
          )}
          {data && data.items.length > 0 && (
            <ul className="divide-y divide-border">
              {data.items.map((row) => (
                <OpenQuoteItem key={row.quoteRecapId} row={row} />
              ))}
            </ul>
          )}
        </div>

        {data && data.totalPages > 1 && (
          <div className="flex shrink-0 items-center justify-between border-t border-border px-5 py-3 text-sm text-muted-foreground">
            <span className="tabular-nums">
              Page {data.page} of {data.totalPages}
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
                disabled={page >= data.totalPages}
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

function ClientName({ row }: { row: OwnerOpenQuoteRow }) {
  const { canRead } = usePermissions();
  const className = "truncate font-medium text-foreground";

  if (row.leadId && canRead(ModuleKey.Leads)) {
    return (
      <Link
        to={`/leads/${row.leadId}`}
        className={cn(className, "underline-offset-4 hover:underline")}
      >
        {row.clientName}
      </Link>
    );
  }
  if (!row.leadId) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={className}>{row.clientName}</span>
        </TooltipTrigger>
        <TooltipContent>This quote has no lead on record.</TooltipContent>
      </Tooltip>
    );
  }
  return <span className={className}>{row.clientName}</span>;
}

function OpenQuoteItem({ row }: { row: OwnerOpenQuoteRow }) {
  const products = row.productsQuoted.length
    ? row.productsQuoted.join(" · ")
    : NOT_AVAILABLE;

  return (
    <li className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <ClientName row={row} />
        <p className="truncate text-xs text-muted-foreground">
          {products} · quoted {shortDate(row.quoteDate)} ·{" "}
          {row.daysOpen === 1 ? "1 day" : `${formatCount(row.daysOpen)} days`}{" "}
          open
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="text-sm font-semibold tabular-nums">
          {formatMoney(row.quotedPremium)}
        </span>
        <Badge
          size="sm"
          className={cn("border-transparent", statusBadgeClass(row.leadStatus))}
        >
          {row.leadStatus}
        </Badge>
      </div>
    </li>
  );
}
