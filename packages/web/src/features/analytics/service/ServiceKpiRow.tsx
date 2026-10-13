import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { KpiCard } from "@/components/common/KpiCard";
import { TrendBadge } from "@/components/common/TrendBadge";
import {
  analyticsKey,
  getServiceSummary,
  type ServiceFilterParams,
} from "@/lib/analytics-api";
import { comparisonDates, formatCount, formatHours } from "../analytics-format";
import { KpiRowError } from "../components/KpiRowError";

/**
 * The Service tab's KPI row (PAC-152, part 2): tickets opened and resolved in
 * the period, how long resolving took, and the open work right now.
 */
export function ServiceKpiRow({ params }: { params: ServiceFilterParams }) {
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: [...analyticsKey, "service", "summary", params],
    queryFn: () => getServiceSummary(params),
    placeholderData: keepPreviousData,
  });

  if (isError) {
    return (
      <KpiRowError
        message="Couldn’t load the service figures."
        onRetry={() => void refetch()}
      />
    );
  }

  const loading = isPending || !data;
  const comparedWith = data ? comparisonDates(data.period) : "";

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard
        label="Requests opened"
        value={formatCount(data?.opened.current ?? null)}
        caption="Service tickets opened in this period"
        badge={data && <TrendBadge trend={data.opened} comparedWith={comparedWith} />}
        isPending={loading}
      />
      <KpiCard
        label="Requests resolved"
        value={formatCount(data?.resolved.current ?? null)}
        caption="Resolved in this period, whenever opened"
        badge={data && <TrendBadge trend={data.resolved} comparedWith={comparedWith} />}
        isPending={loading}
      />
      <KpiCard
        label="Avg time to resolve"
        value={formatHours(data?.avgHoursToResolve.current ?? null)}
        caption={
          data?.avgHoursToResolve.current === null
            ? "Nothing resolved in this period"
            : "Opened to resolved, over this period’s resolved tickets"
        }
        badge={
          data && (
            <TrendBadge trend={data.avgHoursToResolve} comparedWith={comparedWith} />
          )
        }
        isPending={loading}
      />
      <KpiCard
        label="Open now"
        value={formatCount(data?.openNow ?? null)}
        caption={`${formatCount(data?.overdueNow ?? null)} overdue · a snapshot, not the period`}
        isPending={loading}
      />
    </div>
  );
}
