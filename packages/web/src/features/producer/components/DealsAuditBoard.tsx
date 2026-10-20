import {
  Car,
  Home,
  Package,
  Clock,
  AlertCircle,
  Paperclip,
  PenLine,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { usePermissions } from "@/hooks/usePermissions";
import { useUrlState } from "@/hooks/useUrlState";
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
import { NOT_AVAILABLE } from "@/lib/not-available";
import {
  SENT_BACK_TEXT,
} from "@/features/deal-audits/components/review-display";

const PAGE_SIZE = 8;

const OBJECT_ID = /^[a-f0-9]{24}$/i;

/**
 * `?audit=<dealId>` — the `audit.sent_back` notification's link (PAC-106).
 * Frozen at module scope so `useUrlState`'s memo dependencies stay stable.
 */
const LINK_DEFAULTS = { audit: "" };
const LINK_ALLOWED = { audit: (value: string) => OBJECT_ID.test(value) };

/**
 * One requirement settled inside a deal's card.
 *
 * Settled, not removed: the drawer keeps listing it below the outstanding
 * ones, which is what "sorted to the top" is relative to. Since PAC-106 the
 * card itself **stays** once nothing is open — it reads "Ready to submit"
 * until the producer submits, rather than vanishing before they can.
 */
function settleItem(row: DealAuditDealRow, itemId: string): DealAuditDealRow {
  const items = row.items.map((item) =>
    item.id === itemId ? { ...item, open: false } : item,
  );
  const openCount = items.filter((item) => item.open).length;
  const resolved = row.itemCount - openCount;
  return {
    ...row,
    items,
    openCount,
    readyToSubmit: openCount === 0,
    completionPct: row.itemCount
      ? Math.round((resolved / row.itemCount) * 100)
      : 100,
  };
}

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
 *
 * A **sent-back** audit is red, with **Fix it** beside Review (B10, PAC-106):
 * a manager looked and said no, and the fix may be the sale itself — a wrong
 * sold date, a missing policy — which is corrected on Edit Sold Deal.
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
  const sentBack = deal.auditStatus === "Fail";
  const withEvidence = deal.items.filter(
    (item) => item.open && item.attachments.length > 0,
  ).length;

  return (
    <div
      className={cn(
        "group flex flex-col gap-3 border-b border-border px-4 py-4 transition-all last:border-b-0 lg:px-5",
        "dark:border-white/[0.04]",
        sentBack && "border-l-2 border-l-red-500 bg-red-500/5",
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
              {sentBack && (
                <span className={cn("font-semibold", SENT_BACK_TEXT)}>
                  {" "}
                  · Sent back
                  {deal.sentBack?.byName ? ` by ${deal.sentBack.byName}` : ""}
                </span>
              )}
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
          <span
            className={cn(
              "truncate",
              deal.readyToSubmit && "font-medium text-success",
            )}
          >
            {deal.readyToSubmit
              ? "Ready to submit"
              : `${deal.openCount} of ${deal.itemCount} outstanding`}
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
          <div className="flex shrink-0 items-center gap-2">
          {sentBack && (
            <Button
              asChild
              variant="outline"
              size="sm"
              className={cn("shrink-0 rounded-lg font-semibold", SENT_BACK_TEXT)}
            >
              <Link
                to={`/sold/${deal.dealId}/edit`}
                // A link inside a clickable card: without this the card's
                // own handler would open the drawer on the way out.
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
              >
                <PenLine />
                Fix it
              </Link>
            </Button>
          )}
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
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">{NOT_AVAILABLE}</span>
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
  const [{ audit: linkedDealId }, setLink] = useUrlState({
    defaults: LINK_DEFAULTS,
    allowed: LINK_ALLOWED,
  });

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

  /*
   * The notification's deep link opens that deal's drawer (PAC-106), fetched
   * on its own: the card may be on any page of the board, or gone from it
   * because the audit was resubmitted since.
   */
  const linked = useQuery({
    queryKey: ["deal-audits", "linked", linkedDealId],
    queryFn: () => listDealAudits({ dealId: linkedDealId, pageSize: 1 }),
    enabled: !!linkedDealId,
  });
  useEffect(() => {
    if (!linkedDealId || !linked.data) return;
    const row = linked.data.items[0];
    if (row) {
      setSelectedDeal(row);
    } else {
      toast.info("That audit isn't waiting on you any more.");
    }
    // Consumed: a refresh should not reopen the drawer the user closed.
    setLink({ audit: "" });
  }, [linkedDealId, linked.data, setLink]);

  const changeDue = (next: DealAuditDueFilter) => {
    setDue(next);
    // A narrower set almost never has the page the wider one was on.
    setPage(1);
  };

  /**
   * One requirement was resolved inside a deal.
   *
   * ⚠ This used to remove a **row** by item id, and later dropped the card
   * when its last requirement cleared. Neither happens now: a row is a deal,
   * and since PAC-106 a deal stays on the board until it is **submitted** —
   * dropping it at zero open items hid the Submit button from the producer
   * who had just earned it. The completion percentage moves with it, because
   * the drawer is still open.
   *
   * The open drawer is updated from its own snapshot, not looked up in the
   * page's cache: a deal opened from the notification link may not be on this
   * page at all.
   */
  const handleResolved = (dealRowId: string, itemId: string) => {
    queryClient.setQueryData<DealAuditListResponse>(listKey, (prev) =>
      prev
        ? {
            ...prev,
            items: prev.items.map((row) =>
              row.id === dealRowId ? settleItem(row, itemId) : row,
            ),
          }
        : prev,
    );
    setSelectedDeal((current) =>
      current?.id === dealRowId ? settleItem(current, itemId) : current,
    );
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
