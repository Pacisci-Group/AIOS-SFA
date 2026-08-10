import { Car, Home, Package, Clock, AlertCircle } from "lucide-react";
import { useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePermissions } from "@/hooks/usePermissions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  listDealAudits,
  type DealAuditListResponse,
  type DealAuditRow,
  type DealAuditType,
} from "@/lib/deal-audits-api";
import { ResolvePanel } from "./ResolvePanel";

const PAGE_SIZE = 8;
const GRID_COLS = "1fr 1.3fr 90px 80px";

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
  const [selectedDeal, setSelectedDeal] = useState<DealAuditRow | null>(null);
  const { canWrite } = usePermissions();
  const canResolve = canWrite("deal_audits");
  const queryClient = useQueryClient();

  const { data, isPending, isError, isFetching, refetch } = useQuery({
    queryKey: ["deal-audits", page],
    queryFn: () => listDealAudits({ page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;

  const handleResolved = (id: string) => {
    // The item was persisted as resolved by the API and now drops off the board.
    // Optimistically remove the row for instant feedback, then invalidate so the
    // list (and pagination/counts) reconciles with the server.
    queryClient.setQueryData<DealAuditListResponse>(
      ["deal-audits", page],
      (prev) =>
        prev
          ? {
              ...prev,
              items: prev.items.filter((d) => d.id !== id),
              total: Math.max(0, prev.total - 1),
            }
          : prev,
    );
    void queryClient.invalidateQueries({ queryKey: ["deal-audits"] });
  };

  return (
    <>
      <Card className="flex flex-col rounded-xl overflow-hidden p-0 gap-0 bg-card border-border">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-5 rounded-full bg-amber-500" />
            <h2 className="text-sm text-foreground font-semibold">
              Deals Pending Service Hand-off
            </h2>
          </div>
          {!isPending && !isError && (
            <Badge className="bg-amber-500/15 text-amber-500 border-transparent rounded-full text-xs font-bold">
              {total} Outstanding
            </Badge>
          )}
        </div>

        {/* Column Headers */}
        <div
          className="grid px-5 py-2.5 gap-3 border-b border-white/[0.04]"
          style={{ gridTemplateColumns: GRID_COLS }}
        >
          {["Client", "Missing Requirement", "Days Open", "Action"].map((h) => (
            <span
              key={h}
              className="text-[10px] uppercase tracking-widest text-slate-600"
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
                className="grid px-5 py-3.5 gap-3 items-center border-b border-white/[0.04]"
                style={{ gridTemplateColumns: GRID_COLS }}
              >
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-40" />
                <Skeleton className="h-5 w-12 rounded-full" />
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
                    "grid px-5 py-3.5 gap-3 items-center transition-all hover:bg-white/[0.02] group",
                    i < items.length - 1 && "border-b border-white/[0.04]",
                  )}
                  style={{ gridTemplateColumns: GRID_COLS }}
                >
                  {/* Client */}
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={cn(
                        "flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] shrink-0",
                        typeStyles[deal.type],
                      )}
                    >
                      <TypeIcon type={deal.type} />
                    </span>
                    <div className="min-w-0">
                      <span className="block text-sm text-foreground truncate font-medium">
                        {deal.client}
                      </span>
                      <span className="block text-[10px] text-slate-600 tracking-wide">
                        {deal.ref}
                      </span>
                    </div>
                  </div>

                  {/* Missing */}
                  <span className="text-xs text-slate-400 truncate">
                    {deal.missing}
                  </span>

                  {/* Days */}
                  <div className="flex items-center gap-1.5">
                    <Clock
                      size={11}
                      className={cn(
                        "shrink-0",
                        urgent
                          ? "text-amber-500"
                          : warning
                            ? "text-amber-300"
                            : "text-slate-600",
                      )}
                    />
                    <span
                      className={cn(
                        "text-xs px-2 py-0.5 rounded-full",
                        urgent
                          ? "bg-amber-500/15 text-amber-500 font-bold"
                          : warning
                            ? "bg-amber-300/10 text-amber-300 font-medium"
                            : "bg-slate-600/30 text-slate-500 font-medium",
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
                          ? "bg-amber-500/12 text-amber-500 border-amber-500/20 hover:bg-amber-500/12"
                          : "bg-sky-400/10 text-sky-400 border-sky-400/20 hover:bg-sky-400/10",
                      )}
                    >
                      Resolve
                    </Button>
                  ) : (
                    <span className="text-xs text-slate-600">—</span>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Pagination */}
        {!isPending && !isError && totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-border">
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
