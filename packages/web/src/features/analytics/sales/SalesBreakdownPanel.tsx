import { SALES_GROUP_BY, SALES_SEGMENT_BY } from "@sfa/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { useMemo } from "react";
import { DetailCard } from "@/components/common/DetailCard";
import { Button } from "@/components/ui/button";
import {
  analyticsKey,
  getSalesBreakdown,
  type SalesBreakdownResponse,
  type SalesFilterParams,
  type SalesMetrics,
} from "@/lib/analytics-api";
import {
  SALES_GROUP_LABELS,
  SALES_METRICS,
  SALES_SEGMENT_LABELS,
  type MetricKind,
} from "../analytics-format";
import { foldSeries, SERIES_COLORS, seriesKey } from "../chart-palette";
import { downloadCsv } from "../csv-download";
import { BreakdownChart, CHART_ROWS, type BreakdownDatum } from "../components/BreakdownChart";
import { BreakdownTable } from "../components/BreakdownTable";
import { PanelBody } from "../components/PanelStates";
import {
  CompareSwitch,
  LabelledSelect,
  PanelToolbar,
} from "../components/PanelToolbar";
import type { AnalyticsFilters } from "../filters/useAnalyticsFilters";

type SalesMetricKey = (typeof SALES_METRICS)[number]["key"];

/** Measures a segment carries — anything else charts premium when split. */
const SEGMENT_METRICS = new Set<string>(["premium", "items", "policies", "deals"]);

const NO_SEGMENT = "none";

/**
 * "Sales by …" — the AgencyZoom Reports question, answered for any dimension
 * (PAC-152, part 2): group by producer, lead source, line, carrier, branch,
 * ZIP or CSR; optionally split each bar by a second dimension (producer × line
 * is the multi-line view); compare with the prior period.
 *
 * The chart draws the largest rows by the chosen measure; the table lists
 * every row and the totals, which equal the KPI row above by construction.
 */
export function SalesBreakdownPanel({
  params,
  filters,
}: {
  params: SalesFilterParams;
  filters: AnalyticsFilters;
}) {
  const { view, setValues } = filters;
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: [
      ...analyticsKey,
      "sales",
      "breakdown",
      params,
      view.groupBy,
      view.segmentBy,
      view.compare,
    ],
    queryFn: () =>
      getSalesBreakdown(params, {
        groupBy: view.groupBy,
        segmentBy: view.segmentBy,
        compare: view.compare,
      }),
    placeholderData: keepPreviousData,
  });

  const columns = useMemo(
    () =>
      SALES_METRICS.filter(
        (metric) => !data?.unavailable.includes(metric.key as keyof SalesMetrics),
      ),
    [data],
  );
  // A measure this grouping cannot carry falls back to bound premium.
  const metric: SalesMetricKey = columns.some((c) => c.key === view.metric)
    ? view.metric
    : "premium";
  const metricDef = SALES_METRICS.find((m) => m.key === metric)!;
  const dimension = SALES_GROUP_LABELS[view.groupBy];

  const model = useMemo(
    () => (data ? buildModel(data, metric, columns) : null),
    [data, metric, columns],
  );

  const segmentOptions = [
    { value: NO_SEGMENT, label: "Nothing" },
    ...SALES_SEGMENT_BY.filter((s) => s !== view.groupBy).map((s) => ({
      value: s,
      label: SALES_SEGMENT_LABELS[s],
    })),
  ];

  const download = () => {
    if (!data || !model) return;
    downloadCsv(
      `sales-by-${view.groupBy}_${data.period.current.from}_${data.period.current.to}.csv`,
      [
        dimension,
        ...columns.map((c) => c.label),
        "Share %",
        ...(view.compare ? [`${metricDef.label} vs prior`] : []),
      ],
      model.table.map((row) => [
        row.label,
        ...row.cells,
        row.share,
        ...(view.compare ? [row.change] : []),
      ]),
    );
  };

  return (
    <DetailCard
      title={`Sales by ${dimension.toLowerCase()}`}
      bodyless
      action={
        <Button
          variant="ghost"
          size="sm"
          onClick={download}
          disabled={!model || model.table.length === 0}
        >
          <Download aria-hidden />
          Download CSV
        </Button>
      }
      subheading={
        <PanelToolbar>
          <LabelledSelect
            label="Group by"
            value={view.groupBy}
            options={SALES_GROUP_BY.map((g) => ({
              value: g,
              label: SALES_GROUP_LABELS[g],
            }))}
            onChange={(groupBy) =>
              setValues({
                groupBy,
                // A split by the new row dimension is no split.
                ...(view.segmentBy === groupBy ? { segmentBy: "" } : {}),
              })
            }
          />
          <LabelledSelect
            label="Split by"
            value={view.segmentBy ?? NO_SEGMENT}
            options={segmentOptions}
            onChange={(value) =>
              setValues({ segmentBy: value === NO_SEGMENT ? "" : value })
            }
          />
          <LabelledSelect
            label="Measure"
            value={metric}
            options={columns.map((c) => ({ value: c.key, label: c.label }))}
            onChange={(value) => setValues({ metric: value })}
          />
          <CompareSwitch
            id="sales-breakdown-compare"
            checked={view.compare}
            onChange={(checked) => setValues({ compare: checked ? "1" : "" })}
          />
        </PanelToolbar>
      }
    >
      <PanelBody
        isPending={isPending}
        isError={isError}
        isEmpty={!!data && data.rows.length === 0}
        emptyMessage="No sales or quotes in this period for these filters."
        errorMessage="Couldn’t load the breakdown."
        onRetry={() => void refetch()}
      >
        {data && model && (
          <>
            <BreakdownChart
              data={model.chart}
              series={model.series}
              kind={model.chartKind}
              showPrevious={view.compare && !view.segmentBy}
              ariaLabel={`${model.chartLabel} by ${dimension.toLowerCase()}, ${data.period.current.from} to ${data.period.current.to}. Every value is in the table below.`}
            />
            {data.rows.length > CHART_ROWS && (
              <p className="px-5 pb-3 text-xs text-muted-foreground">
                The chart shows the {CHART_ROWS} largest of {data.rows.length}; the table lists them all.
              </p>
            )}
            <BreakdownTable
              caption={`Sales by ${dimension.toLowerCase()}`}
              dimensionLabel={dimension}
              columns={columns}
              rows={model.table}
              totals={columns.map((c) => data.totals[c.key] as number | null)}
              emphasis={metric}
              showChange={view.compare}
              changeUnit={metric === "closingPct" ? "points" : "percent"}
            />
          </>
        )}
      </PanelBody>
    </DetailCard>
  );
}

/** The response as the chart and the table draw it. */
function buildModel(
  data: SalesBreakdownResponse,
  metric: SalesMetricKey,
  columns: readonly (typeof SALES_METRICS)[number][],
) {
  const value = (m: SalesMetrics) => m[metric] as number | null;
  const rows = [...data.rows].sort(
    (a, b) =>
      Number(a.key === null) - Number(b.key === null) ||
      (value(b.metrics) ?? -1) - (value(a.metrics) ?? -1),
  );
  const total = (value(data.totals) ?? 0) || 0;

  const table = rows.map((row) => ({
    id: row.key ?? "",
    label: row.label,
    cells: columns.map((c) => row.metrics[c.key] as number | null),
    share:
      total > 0 && value(row.metrics) !== null && metric !== "closingPct"
        ? Math.round(((value(row.metrics) ?? 0) / total) * 1000) / 10
        : null,
    change: (row.change?.[metric] as number | null | undefined) ?? null,
  }));

  // A split charts a measure the segments carry; anything else charts premium.
  const segmented = data.segmentBy !== null;
  const chartMetric = segmented && !SEGMENT_METRICS.has(metric) ? "premium" : metric;
  const chartDef = SALES_METRICS.find((m) => m.key === chartMetric)!;
  const shown = rows.slice(0, CHART_ROWS);

  if (segmented) {
    const series = foldSeries(data.series);
    const chart: BreakdownDatum[] = shown.map((row) => {
      const datum: BreakdownDatum = { label: row.label };
      for (const s of series) {
        datum[s.dataKey] = (row.segments ?? [])
          .filter((part) => s.members.includes(part.key))
          .reduce(
            (sum, part) =>
              sum + ((part.metrics as unknown as Record<string, number>)[chartMetric] ?? 0),
            0,
          );
      }
      return datum;
    });
    return {
      table,
      chart,
      series,
      chartKind: chartDef.kind as MetricKind,
      chartLabel: chartDef.label,
    };
  }

  const series = [
    { dataKey: seriesKey(0), label: chartDef.label, color: SERIES_COLORS[0], members: [] },
  ];
  const chart: BreakdownDatum[] = shown.map((row) => ({
    label: row.label,
    [seriesKey(0)]: value(row.metrics),
    previous: row.previous ? value(row.previous) : null,
  }));
  return {
    table,
    chart,
    series,
    chartKind: chartDef.kind as MetricKind,
    chartLabel: chartDef.label,
  };
}
