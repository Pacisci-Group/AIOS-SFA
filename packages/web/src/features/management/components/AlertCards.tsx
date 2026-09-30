import {
  MANAGEMENT_AUDIT_SLA_BUSINESS_DAYS,
  MANAGEMENT_STALLED_HOURS,
} from "@sfa/shared";
import type { ManagementDrawerKey } from "@sfa/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertCircle, ChevronRight } from "lucide-react";
import { SectionLabel } from "@/components/common/DetailCard";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { DashboardFilterParams } from "@/lib/dashboard-filter-params";
import {
  getManagementAlerts,
  managementDashboardKey,
} from "@/lib/management-dashboard-api";
import type { ManagementAlerts } from "@/lib/management-dashboard-api";
import { cn } from "@/lib/utils";
import { formatCount } from "@/features/owner-dashboard/owner-format";

/**
 * The three cards, in the mockup's order, with the definitions David gave on
 * 22 Sep as their sub-lines — so the header says exactly what the number
 * counts (his hard rule), not a mood.
 */
export const ALERT_CARDS: readonly {
  key: ManagementDrawerKey;
  field: keyof Omit<ManagementAlerts, "period">;
  label: string;
  detail: string;
  /** The drawer's title and its empty-state sentence. */
  noun: string;
}[] = [
  {
    key: "stalled",
    field: "stalledLeads",
    label: "Stalled leads",
    detail: `No update > ${MANAGEMENT_STALLED_HOURS}h`,
    noun: "stalled leads",
  },
  {
    key: "aging",
    field: "agingAudits",
    label: "Aging audits",
    detail: `Open > ${MANAGEMENT_AUDIT_SLA_BUSINESS_DAYS} business days`,
    noun: "aging audits",
  },
  {
    key: "overdue",
    field: "overdueTickets",
    label: "Overdue tickets",
    detail: "Breached SLA",
    noun: "overdue tickets",
  },
];

/**
 * The Manager view's alert row (PAC-139). Each card is a button that opens the
 * drawer listing the records behind its number — "if you just have it there,
 * how is a user supposed to know what leads are stalled?" (David, 00:27:48).
 *
 * The number is the drawer's row count by construction: the API computes both
 * from one pipeline. A zero is real information ("nothing is stalled"), so
 * there is no empty state — only loading and error.
 *
 * `keepPreviousData`: filtering is instant, so the old figures stay up while
 * the new ones load instead of three cards flashing to skeletons on every
 * click.
 */
export function AlertCards({
  params,
  onOpen,
}: {
  params: DashboardFilterParams;
  onOpen: (key: ManagementDrawerKey) => void;
}) {
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: [...managementDashboardKey, "alerts", params],
    queryFn: () => getManagementAlerts(params),
    placeholderData: keepPreviousData,
  });

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card py-10 text-center">
        <AlertCircle aria-hidden className="size-5 text-destructive" />
        <p className="text-sm text-muted-foreground">
          Couldn&rsquo;t load the alert counts.
        </p>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  const loading = isPending || !data;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {ALERT_CARDS.map((card) => {
        const count = data?.[card.field] ?? null;
        return (
          <Button
            key={card.key}
            type="button"
            variant="ghost"
            onClick={() => onOpen(card.key)}
            disabled={loading}
            aria-label={
              loading
                ? `${card.label}, loading`
                : `${card.label}: ${formatCount(count)}. Open the list`
            }
            className={cn(
              "h-auto flex-col items-stretch gap-3 rounded-xl border border-border bg-card p-5 text-left whitespace-normal",
              "hover:border-primary/40 hover:bg-card",
              count ? "border-l-4 border-l-destructive" : "",
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <SectionLabel>{card.label}</SectionLabel>
              <ChevronRight
                aria-hidden
                className="size-4 shrink-0 text-muted-foreground"
              />
            </div>
            {loading ? (
              <div>
                <Skeleton className="h-8 w-16" />
                <Skeleton className="mt-2 h-3 w-32" />
              </div>
            ) : (
              <div>
                <p
                  className={cn(
                    "text-[2rem] leading-none font-bold -tracking-[0.03em] tabular-nums",
                    count ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {formatCount(count)}
                </p>
                <p className="mt-1.5 text-xs font-normal text-muted-foreground">
                  {card.detail}
                </p>
              </div>
            )}
          </Button>
        );
      })}
    </div>
  );
}
