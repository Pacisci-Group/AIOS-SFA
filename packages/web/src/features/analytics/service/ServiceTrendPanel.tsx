import { ANALYTICS_INTERVALS } from "@sfa/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { DetailCard } from "@/components/common/DetailCard";
import { FilterToggles } from "@/components/common/FilterToggles";
import {
  analyticsKey,
  getServiceTimeseries,
  type AnalyticsInterval,
  type ServiceFilterParams,
} from "@/lib/analytics-api";
import { formatBucket, formatBucketLong } from "../analytics-format";
import { SERIES_COLORS } from "../chart-palette";
import { PanelBody } from "../components/PanelStates";
import { PanelToolbar } from "../components/PanelToolbar";
import { TrendChart } from "../components/TrendChart";
import type { AnalyticsFilters } from "../filters/useAnalyticsFilters";

const INTERVAL_LABELS: Record<AnalyticsInterval, string> = {
  day: "Day",
  week: "Week",
  month: "Month",
};

const SERIES = [
  { dataKey: "opened", label: "Opened", color: SERIES_COLORS[0], members: [] },
  { dataKey: "resolved", label: "Resolved", color: SERIES_COLORS[1], members: [] },
];

/**
 * Requests opened against requests resolved, per day, week or month — the
 * AgencyZoom "Service requests over 12 months" chart, on any period (the
 * Last 12 Months chip gives that exact view).
 */
export function ServiceTrendPanel({
  params,
  filters,
}: {
  params: ServiceFilterParams;
  filters: AnalyticsFilters;
}) {
  const { view, setValues } = filters;
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: [...analyticsKey, "service", "timeseries", params, view.interval],
    queryFn: () => getServiceTimeseries(params, { interval: view.interval }),
    placeholderData: keepPreviousData,
  });

  return (
    <DetailCard
      title="Opened vs resolved"
      bodyless
      subheading={
        <PanelToolbar>
          <FilterToggles
            label="Time grain"
            value={view.interval}
            options={ANALYTICS_INTERVALS.map((interval) => ({
              value: interval,
              label: INTERVAL_LABELS[interval],
            }))}
            onChange={(interval) => setValues({ interval })}
            className="sm:w-60"
          />
        </PanelToolbar>
      }
    >
      <PanelBody
        isPending={isPending}
        isError={isError}
        isEmpty={!!data && data.buckets.every((b) => !b.opened && !b.resolved)}
        emptyMessage="No service requests were opened or resolved in this period."
        errorMessage="Couldn’t load the trend."
        onRetry={() => void refetch()}
      >
        {data && (
          <TrendChart
            data={data.buckets.map((bucket) => ({
              label: formatBucket(bucket.key, data.interval),
              heading: formatBucketLong(bucket, data.interval),
              opened: bucket.opened,
              resolved: bucket.resolved,
            }))}
            series={SERIES}
            kind="count"
            showPrevious={false}
            grouped
            ariaLabel={`Service requests opened and resolved by ${INTERVAL_LABELS[data.interval].toLowerCase()}, ${data.period.current.from} to ${data.period.current.to}`}
          />
        )}
      </PanelBody>
    </DetailCard>
  );
}
