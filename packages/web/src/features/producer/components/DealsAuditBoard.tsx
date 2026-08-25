import { Car, Home, Package, Clock, AlertCircle, Paperclip } from "lucide-react";
import { useEffect, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePermissions } from "@/hooks/usePermissions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  listDealAudits,
  type DealAuditDealRow,
  type DealAuditDueFilter,
  type DealAuditListResponse,
  type DealAuditType,
} from "@/lib/deal-audits-api";
import { ResolvePanel } from "./ResolvePanel";

const PAGE_SIZE = 8;

const DUE_FILTERS: { value: DealAuditDueFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "due_soon", label: "Due soon" },
  { value: "overdue", label: "Overdue" },
];

const typeStyles: Record<DealAuditType, string> = {
  Auto: "bg-sky-400/10 text-sky-400",
  Home: "bg-emerald-500/10 text-emerald-500",
  Bundle: "bg-indigo-400/10 text-indigo-400",
  Other: "bg-slate-500/10 text-slate-400",
};

const TypeIcon = ({ type }: { type: DealAuditType }) => {
  if (type === "Auto") return <Car size={12} />;
  if (type === "Home") return <Home size={12} />;
  return <Package size={12} />;
};

/**
 * One deal, one card (PAC-72 section A item 1).
 *
 * Replaces a four-column grid where one row was one audit *item* — a bundled
 * Auto + Home sale with six open requirements rendered as six rows with six
 * Resolve buttons and could fill the board by itself. The header badge counted
 * requirements, not deals, so "12 Outstanding" never meant twelve clients.
 *
 * The completion percentage is what David asked for **instead of** per-item
 * checkmarks (items 3 and 4), so there is deliberately no tick anywhere here.
 */
function DealCard({
  deal,
  canResolve,
  onOpen,
}: {
  deal: DealAuditDealRow;
  canResolve: boolean;
  onOpen: () => void;
}) {
  const urgent = deal.oldestDaysOpen >= 30;
  const warning = deal.oldestDaysOpen >= 14 && deal.oldestDaysOpen < 30;
  const withEvidence = deal.items.filter(
    (item) => item.open && item.attachments.length > 0,
  ).length;

  return (
    <div
      className={cn(
        "group flex flex-col gap-3 border-b border-border px-4 py-4 transition-all last:border-b-0 lg:px-5",
        "dark:border-white/[0.04]",
        canResolve && "cursor-pointer hover:bg-muted/40",
      )}
      onClick={canResolve ? onOpen : undefined}
      role={canResolve ? "button" : undefined}
      tabIndex={canResolve ? 0 : undefined}
      onKeyDown={
        canResolve
          ? (event) => {
              // The whole card is the target (item 2: "click the deal → drawer"),
              // so it has to answer the keyboard like the button it now is.
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onOpen();
              }
            }
          : undefined
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs",
              typeStyles[deal.type],
            )}
          >
            <TypeIcon type={deal.type} />
          </span>
          <div className="min-w-0">
            <span className="block truncate text-sm font-medium text-foreground">
              {deal.client}
            </span>
            <span className="block truncate text-xs tracking-wide text-muted-foreground">
              {deal.ref}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <Clock
            size={11}
            className={cn(
              "shrink-0",
              urgent
                ? "text-amber-500"
                : warning
                  ? "text-amber-300"
                  : "text-muted-foreground",
            )}
          />
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-xs",
              urgent
                ? "bg-amber-500/15 font-bold text-amber-500"
                : warning
                  ? "bg-amber-300/10 font-medium text-amber-300"
                  : "bg-muted font-medium text-muted-foreground",
            )}
          >
            {deal.oldestDaysOpen}d
          </span>
        </div>
      </div>

      {/* Completion — the figure that replaced the checkmarks. */}
      <div className="flex items-center gap-3">
        <Progress
          value={deal.completionPct}
          className="h-1.5 flex-1"
          aria-label={`${deal.completionPct}% of requirements resolved`}
        />
        <span className="shrink-0 text-xs font-medium text-muted-foreground tabular-nums">
          {deal.completionPct}%
        </span>
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-1.5 truncate text-xs text-muted-foreground">
          <span className="truncate">
            {deal.openCount} of {deal.itemCount} outstanding
          </span>
          {/*
            * A proof uploaded at sale time is already on the item (PAC-56 #21b)
            * — the clip says the auditor is verifying, not chasing.
            */}
          {withEvidence > 0 && (
            <Paperclip
              size={11}
              className="shrink-0 text-muted-foreground"
              aria-label={`${withEvidence} outstanding requirement${withEvidence === 1 ? "" : "s"} with a document on file`}
            />
          )}
        </span>

        {canResolve ? (
          <Button
            variant="outline"
            size="sm"
            onClick={(event) => {
              // The card already handles the click; without this the drawer
              // would open twice on the button.
              event.stopPropagation();
              onOpen();
            }}
            className={cn(
              "shrink-0 rounded-lg font-semibold hover:brightness-110 active:scale-95",
              urgent
                ? "border-amber-500/20 bg-amber-500/12 text-amber-500 hover:bg-amber-500/12"
                : "border-sky-400/20 bg-sky-400/10 text-sky-400 hover:bg-sky-400/10",
            )}
          >
            Review
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </div>
    </div>
  );
}

export function DealsAuditBoard() {
  const [page, setPage] = useState(1);
  const [due, setDue] = useState<DealAuditDueFilter>("all");
  const [selectedDeal, setSelectedDeal] = useState<DealAuditDealRow | null>(
    null,
  );
  const { canWrite } = usePermissions();
  const canResolve = canWrite("deal_audits");
  const queryClient = useQueryClient();

  /*
   * ⚠ `due` belongs in the key, and in `handleResolved`'s `setQueryData` key
   * below. Miss the second and the optimistic removal writes to a cache entry
   * nothing is reading — no error, no test, just a row that stays on screen
   * until the refetch lands.
   */
  const listKey = ["deal-audits", page, due] as const;

  const { data, isPending, isError, isFetching, refetch } = useQuery({
    queryKey: listKey,
    queryFn: () => listDealAudits({ page, pageSize: PAGE_SIZE, due }),
    placeholderData: keepPreviousData,
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;

  /*
   * Resolving the last row of the last page used to strand the user: `items`
   * emptied, the server returned `totalPages: 1` for a `page=2` request, the
   * board rendered "No deals pending hand-off" over a set that still had a full
   * page 1 — and the pagination footer is gated on `totalPages > 1`, so Prev
   * was gone too. Clamp instead of trusting `page` to stay in range.
   */
  useEffect(() => {
    if (!data) return;
    if (page > data.totalPages) setPage(data.totalPages);
  }, [data, page]);

  const changeDue = (next: DealAuditDueFilter) => {
    setDue(next);
    // A narrower set almost never has the page the wider one was on.
    setPage(1);
  };

  /**
   * One requirement was resolved inside a deal.
   *
   * ⚠ This used to remove a **row** by item id, which is no longer what
   * happens: a row is a deal now, so the item has to be marked settled *within*
   * its card and the card dropped only when its last outstanding requirement
   * goes. The completion percentage moves with it, because the drawer is still
   * open and reading from this cache entry.
   */
  const handleResolved = (dealRowId: string, itemId: string) => {
    let nextSelected: DealAuditDealRow | null = null;

    queryClient.setQueryData<DealAuditListResponse>(listKey, (prev) => {
      if (!prev) return prev;

      const rows: DealAuditDealRow[] = [];
      for (const row of prev.items) {
        if (row.id !== dealRowId) {
          rows.push(row);
          continue;
        }

        // Settled, not removed: the drawer keeps listing it below the
        // outstanding ones, which is what "sorted to the top" is relative to.
        const nextItems = row.items.map((item) =>
          item.id === itemId ? { ...item, open: false } : item,
        );
        const openCount = nextItems.filter((item) => item.open).length;
        if (openCount === 0) continue; // last one cleared — the card leaves

        const resolved = row.itemCount - openCount;
        const updated: DealAuditDealRow = {
          ...row,
          items: nextItems,
          openCount,
          completionPct: row.itemCount
            ? Math.round((resolved / row.itemCount) * 100)
            : 100,
        };
        nextSelected = updated;
        rows.push(updated);
      }

      const nextTotal = Math.max(0, rows.length ? prev.total : prev.total - 1);
      return {
        ...prev,
        items: rows,
        total: rows.length === prev.items.length ? prev.total : nextTotal,
        // Recomputed with `total`, not left behind: the footer reads this, and
        // a stale value showed "Page 1 of 2" for a set that now fits on one.
        totalPages: Math.max(1, Math.ceil(nextTotal / prev.pageSize)),
      };
    });

    // Keep the open drawer in step with the cache, or close it when its deal
    // just cleared entirely.
    setSelectedDeal(nextSelected);
    void queryClient.invalidateQueries({ queryKey: ["deal-audits"] });
  };

  return (
    <>
      <Card className="flex flex-col rounded-xl overflow-hidden p-0 gap-0 bg-card border-border">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-4 md:px-5">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-5 rounded-full bg-amber-500" />
            <h2 className="text-sm text-foreground font-semibold">
              Deals Pending Service Hand-off
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {/*
              * The soft deadline, as a filter and nothing more (PAC-65). The
              * team pulls an overdue list; no status changes on its own at day
              * 7, and nothing here should suggest it does.
              */}
            {!isPending && !isError && (
              <div className="flex items-center rounded-full border border-border p-0.5">
                {DUE_FILTERS.map(({ value, label }) => (
                  <Button
                    key={value}
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => changeDue(value)}
                    aria-pressed={due === value}
                    className={cn(
                      "h-6 rounded-full px-2.5 text-xs font-medium",
                      due === value
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            )}
            {/*
              * "Deals", not "Outstanding". `total` counts deals now, and the
              * old wording read as a requirement count — which it no longer is.
              */}
            {!isPending && !isError && (
              <Badge className="bg-amber-500/15 text-amber-500 border-transparent rounded-full text-xs font-bold">
                {total} {total === 1 ? "Deal" : "Deals"}
              </Badge>
            )}
          </div>
        </div>

        {/* Body */}
        <div
          className="flex flex-col overflow-y-auto"
          style={{ maxHeight: "420px" }}
        >
          {isPending ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="flex flex-col gap-3 border-b border-border px-4 py-4 lg:px-5 dark:border-white/[0.04]"
              >
                <div className="flex items-center justify-between gap-3">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-5 w-12 rounded-full" />
                </div>
                <Skeleton className="h-1.5 w-full rounded-full" />
                <div className="flex items-center justify-between gap-3">
                  <Skeleton className="h-3 w-28" />
                  <Skeleton className="h-7 w-16 rounded-lg" />
                </div>
              </div>
            ))
          ) : isError ? (
            <div className="flex flex-col items-center justify-center gap-3 py-14 text-center">
              <AlertCircle size={22} className="text-amber-500" />
              <p className="text-sm text-muted-foreground">
                Couldn't load pending hand-offs.
              </p>
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                Retry
              </Button>
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 text-center">
              <p className="text-sm text-muted-foreground">
                No deals pending hand-off.
              </p>
            </div>
          ) : (
            items.map((deal) => (
              <DealCard
                key={deal.id}
                deal={deal}
                canResolve={canResolve}
                onOpen={() => setSelectedDeal(deal)}
              />
            ))
          )}
        </div>

        {/* Pagination */}
        {!isPending && !isError && totalPages > 1 && (
          <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 md:px-5">
            <span className="text-xs text-muted-foreground">
              Page {page} of {totalPages}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1 || isFetching}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Prev
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages || isFetching}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>

      <ResolvePanel
        deal={selectedDeal}
        onClose={() => setSelectedDeal(null)}
        onResolved={handleResolved}
      />
    </>
  );
}
