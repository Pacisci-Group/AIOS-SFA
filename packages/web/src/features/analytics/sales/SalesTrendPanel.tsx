import { ANALYTICS_INTERVALS, SALES_SEGMENT_BY } from "@sfa/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { DetailCard } from "@/components/common/DetailCard";
import { FilterToggles } from "@/components/common/FilterToggles";
import {
  analyticsKey,
  getSalesTimeseries,
  type AnalyticsInterval,
  type SalesFilterParams,
  type SalesTimeseriesResponse,
} from "@/lib/analytics-api";
import {
  formatBucket,
  formatBucketLong,
  SALES_SEGMENT_LABELS,
  SALES_TREND_METRICS,
  type SalesTrendMetric,
} from "../analytics-format";
import { foldSeries, SERIES_COLORS, seriesKey } from "../chart-palette";
import { PanelBody } from "../components/PanelStates";
import {
  CompareSwitch,
  LabelledSelect,
  PanelToolbar,
} from "../components/PanelToolbar";
import { TrendChart, type TrendDatum } from "../components/TrendChart";
import type { AnalyticsFilters } from "../filters/useAnalyticsFilters";

const INTERVAL_LABELS: Record<AnalyticsInterval, string> = {
  day: "Day",
  week: "Week",
  month: "Month",
};

/** Measures a segment carries; a split charts premium otherwise. */
const SEGMENT_METRICS = new Set<string>(["premium", "items", "deals"]);
const NO_SEGMENT = "none";

/**
 * Sales over time (PAC-152, part 2) — AgencyZoom's daily and monthly sales
 * summaries as one chart: pick the grain, the measure, and optionally split
 * each bucket by a dimension. Quotes are bucketed by the day they were
 * written, sales by the day they were sold.
 */
export function SalesTrendPanel({
  params,
  filters,
}: {
  params: SalesFilterParams;
  filters: AnalyticsFilters;
}) {
  const { view, setValues } = filters;
  const segmentBy = view.trendSegmentBy;
  const compare = view.compare && !segmentBy;
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: [
      ...analyticsKey,
      "sales",
      "timeseries",
      params,
      view.interval,
      segmentBy,
      compare,
    ],
    queryFn: () =>
      getSalesTimeseries(params, {
        interval: view.interval,
        segmentBy,
        compare,
      }),
    placeholderData: keepPreviousData,
  });

  // Quotes record no carrier, so under a carrier filter there are none to chart.
  const metrics = SALES_TREND_METRICS.filter(
    (m) =>
      !params.carriers.length || (m.key !== "quotes" && m.key !== "quotedPremium"),
  );
  const metric: SalesTrendMetric = metrics.some((m) => m.key === view.trendMetric)
    ? view.trendMetric
    : "premium";

  const model = useMemo(
    () => (data ? buildModel(data, metric) : null),
    [data, metric],
  );
  const empty =
    !!data && data.buckets.every((b) => !b.metrics.deals && !b.metrics.quotes);

  return (
    <DetailCard
      title="Over time"
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
          <LabelledSelect
            label="Measure"
            value={metric}
            options={metrics.map((m) => ({ value: m.key, label: m.label }))}
            onChange={(trendMetric) => setValues({ trendMetric })}
          />
          <LabelledSelect
            label="Split by"
            value={segmentBy ?? NO_SEGMENT}
            options={[
              { value: NO_SEGMENT, label: "Nothing" },
              ...SALES_SEGMENT_BY.map((s) => ({
                value: s,
                label: SALES_SEGMENT_LABELS[s],
              })),
            ]}
            onChange={(value) =>
              setValues({ trendSegmentBy: value === NO_SEGMENT ? "" : value })
            }
          />
          {!segmentBy && (
            <CompareSwitch
              id="sales-trend-compare"
              checked={view.compare}
              onChange={(checked) => setValues({ compare: checked ? "1" : "" })}
            />
          )}
        </PanelToolbar>
      }
    >
      <PanelBody
        isPending={isPending}
        isError={isError}
        isEmpty={empty}
        emptyMessage="No sales or quotes in this period for these filters."
        errorMessage="Couldn’t load the trend."
        onRetry={() => void refetch()}
      >
        {data && model && (
          <TrendChart
            data={model.data}
            series={model.series}
            kind={model.kind}
            showPrevious={compare && !!data.previous}
            ariaLabel={`${model.label} by ${INTERVAL_LABELS[data.interval].toLowerCase()}, ${data.period.current.from} to ${data.period.current.to}`}
          />
        )}
      </PanelBody>
    </DetailCard>
  );
}

function buildModel(data: SalesTimeseriesResponse, metric: SalesTrendMetric) {
  const segmented = data.segmentBy !== null;
  const chartMetric = segmented && !SEGMENT_METRICS.has(metric) ? "premium" : metric;
  const def = SALES_TREND_METRICS.find((m) => m.key === chartMetric)!;

  if (segmented) {
    const series = foldSeries(data.series);
    const rows: TrendDatum[] = data.buckets.map((bucket) => {
      const datum: TrendDatum = {
        label: formatBucket(bucket.key, data.interval),
        heading: formatBucketLong(bucket, data.interval),
      };
      for (const s of series) {
        datum[s.dataKey] = s.members.reduce((sum, member) => {
          const part = bucket.segments?.[member ?? ""];
          return sum + ((part as unknown as Record<string, number> | undefined)?.[chartMetric] ?? 0);
        }, 0);
      }
      return datum;
    });
    return { data: rows, series, kind: def.kind, label: def.label };
  }

  const series = [
    { dataKey: seriesKey(0), label: def.label, color: SERIES_COLORS[0], members: [] },
  ];
  const rows: TrendDatum[] = data.buckets.map((bucket, index) => ({
    label: formatBucket(bucket.key, data.interval),
    heading: formatBucketLong(bucket, data.interval),
    [seriesKey(0)]: bucket.metrics[chartMetric],
    previous: data.previous?.[index]?.metrics[chartMetric] ?? null,
  }));
  return { data: rows, series, kind: def.kind, label: def.label };
}
