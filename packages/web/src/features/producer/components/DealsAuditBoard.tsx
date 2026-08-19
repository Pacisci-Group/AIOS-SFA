import { Car, Home, Package, Clock, AlertCircle, Paperclip } from "lucide-react";
import { useEffect, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePermissions } from "@/hooks/usePermissions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  listDealAudits,
  type DealAuditDueFilter,
  type DealAuditListResponse,
  type DealAuditRow,
  type DealAuditType,
} from "@/lib/deal-audits-api";
import { ResolvePanel } from "./ResolvePanel";

const PAGE_SIZE = 8;
/**
 * Four columns from `lg` up; below that a row collapses to "who + what to do
 * about it", with the requirement and the age folded in under the client name.
 * A 90px "Days Open" column and a Resolve button cannot both sit beside a
 * client name on a phone — or on a tablet, once the sidebar has taken 224px.
 */
const GRID_COLS =
  "grid-cols-[minmax(0,1fr)_auto] lg:grid-cols-[1fr_1.3fr_90px_80px]";

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

export function DealsAuditBoard() {
  const [page, setPage] = useState(1);
  const [due, setDue] = useState<DealAuditDueFilter>("all");
  const [selectedDeal, setSelectedDeal] = useState<DealAuditRow | null>(null);
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

  const handleResolved = (id: string) => {
    // The item was persisted as resolved by the API and now drops off the board.
    // Optimistically remove the row for instant feedback, then invalidate so the
    // list (and pagination/counts) reconciles with the server.
    queryClient.setQueryData<DealAuditListResponse>(listKey, (prev) => {
      if (!prev) return prev;
      const remaining = prev.items.filter((d) => d.id !== id);
      const nextTotal = Math.max(0, prev.total - 1);
      return {
        ...prev,
        items: remaining,
        total: nextTotal,
        // Recomputed with `total`, not left behind: the footer reads this, and
        // a stale value showed "Page 1 of 2" for a set that now fits on one.
        totalPages: Math.max(1, Math.ceil(nextTotal / prev.pageSize)),
      };
    });
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
            {!isPending && !isError && (
              <Badge className="bg-amber-500/15 text-amber-500 border-transparent rounded-full text-xs font-bold">
                {total} Outstanding
              </Badge>
            )}
          </div>
        </div>

        {/* Column Headers */}
        <div className="hidden grid-cols-[1fr_1.3fr_90px_80px] gap-3 border-b border-border px-5 py-2.5 lg:grid dark:border-white/[0.04]">
          {["Client", "Missing Requirement", "Days Open", "Action"].map((h) => (
            <span
              key={h}
              className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
            >
              {h}
            </span>
          ))}
        </div>

        {/* Body */}
        <div
          className="flex flex-col overflow-y-auto"
          style={{ maxHeight: "360px" }}
        >
          {isPending ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className={cn(
                  "grid items-center gap-3 border-b border-border px-4 py-3.5 lg:px-5 dark:border-white/[0.04]",
                  GRID_COLS,
                )}
              >
                <Skeleton className="h-4 w-32" />
                <Skeleton className="hidden h-3 w-40 lg:block" />
                <Skeleton className="hidden h-5 w-12 rounded-full lg:block" />
                <Skeleton className="h-7 w-16 rounded-lg" />
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
            items.map((deal, i) => {
              const urgent = deal.daysOpen >= 30;
              const warning = deal.daysOpen >= 14 && deal.daysOpen < 30;

              return (
                <div
                  key={deal.id}
                  className={cn(
                    "group grid items-center gap-3 px-4 py-3.5 transition-all hover:bg-muted/40 lg:px-5",
                    GRID_COLS,
                    i < items.length - 1 &&
                      "border-b border-border dark:border-white/[0.04]",
                  )}
                >
                  {/* Client */}
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
                      {/* The two columns that don't fit on a phone, folded in
                          under the name rather than dropped. */}
                      <span className="mt-1 block truncate text-xs text-muted-foreground lg:hidden">
                        {deal.missing} · {deal.daysOpen}d open
                        {deal.attachments.length > 0 ? " · has evidence" : ""}
                      </span>
                    </div>
                  </div>

                  {/* Missing */}
                  <span className="hidden items-center gap-1.5 truncate text-xs text-muted-foreground lg:flex">
                    <span className="truncate">{deal.missing}</span>
                    {/*
                      * A proof uploaded at sale time is already on the item
                      * (PAC-56 #21b) — the clip says the auditor is verifying,
                      * not chasing. Folded in here rather than given a column:
                      * `GRID_COLS`, the header and the mobile collapse are all
                      * tuned to four.
                      */}
                    {deal.attachments.length > 0 && (
                      <Paperclip
                        size={11}
                        className="shrink-0 text-muted-foreground"
                        aria-label={`${deal.attachments.length} document${deal.attachments.length === 1 ? "" : "s"} on file`}
                      />
                    )}
                  </span>

                  {/* Days */}
                  <div className="hidden items-center gap-1.5 lg:flex">
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
                      {deal.daysOpen}d
                    </span>
                  </div>

                  {/* Resolve */}
                  {canResolve ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedDeal(deal)}
                      className={cn(
                        "rounded-lg font-semibold hover:brightness-110 active:scale-95",
                        urgent
                          ? "border-amber-500/20 bg-amber-500/12 text-amber-500 hover:bg-amber-500/12"
                          : "border-sky-400/20 bg-sky-400/10 text-sky-400 hover:bg-sky-400/10",
                      )}
                    >
                      Resolve
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </div>
              );
            })
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
