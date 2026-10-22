import { SERVICE_GROUP_BY } from "@sfa/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { useMemo } from "react";
import { DetailCard } from "@/components/common/DetailCard";
import { Button } from "@/components/ui/button";
import {
  analyticsKey,
  getServiceBreakdown,
  type ServiceFilterParams,
  type ServiceMetrics,
} from "@/lib/analytics-api";
import { SERVICE_GROUP_LABELS, SERVICE_METRICS } from "../analytics-format";
import { SERIES_COLORS, seriesKey } from "../chart-palette";
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

/**
 * Service requests by category, line, status, priority, assignee or branch —
 * AgencyZoom's "Requests by Category / by Policy Type" (PAC-152, part 2), as
 * one panel with a dimension picker.
 *
 * Horizontal bars rather than a pie: a category mix of six or more slices is
 * unreadable as angles, and bars put every row on one baseline with its label.
 */
export function ServiceBreakdownPanel({
  params,
  filters,
}: {
  params: ServiceFilterParams;
  filters: AnalyticsFilters;
}) {
  const { view, setValues } = filters;
  const groupBy = view.serviceGroupBy;
  const metric = view.serviceMetric;
  const def = SERVICE_METRICS.find((m) => m.key === metric)!;
  const dimension = SERVICE_GROUP_LABELS[groupBy];

  const { data, isPending, isError, refetch } = useQuery({
    queryKey: [...analyticsKey, "service", "breakdown", params, groupBy, view.compare],
    queryFn: () => getServiceBreakdown(params, { groupBy, compare: view.compare }),
    placeholderData: keepPreviousData,
  });

  const model = useMemo(() => {
    if (!data) return null;
    const value = (m: ServiceMetrics) => m[metric];
    const rows = [...data.rows].sort(
      (a, b) =>
        Number(a.key === null) - Number(b.key === null) ||
        (value(b.metrics) ?? -1) - (value(a.metrics) ?? -1),
    );
    const total = value(data.totals) ?? 0;
    const shareable = metric !== "avgHoursToResolve";
    return {
      table: rows.map((row) => ({
        id: row.key ?? "",
        label: row.label,
        cells: SERVICE_METRICS.map((m) => row.metrics[m.key]),
        share:
          shareable && total > 0
            ? Math.round(((value(row.metrics) ?? 0) / total) * 1000) / 10
            : null,
        change: (row.change?.[metric] as number | null | undefined) ?? null,
      })),
      chart: rows.slice(0, CHART_ROWS).map(
        (row): BreakdownDatum => ({
          label: row.label,
          [seriesKey(0)]: value(row.metrics),
          previous: row.previous ? value(row.previous) : null,
        }),
      ),
    };
  }, [data, metric]);

  const download = () => {
    if (!data || !model) return;
    downloadCsv(
      `service-by-${groupBy}_${data.period.current.from}_${data.period.current.to}.csv`,
      [
        dimension,
        ...SERVICE_METRICS.map((m) => m.label),
        "Share %",
        ...(view.compare ? [`${def.label} vs prior`] : []),
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
      title={`Requests by ${dimension.toLowerCase()}`}
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
            value={groupBy}
            options={SERVICE_GROUP_BY.map((g) => ({
              value: g,
              label: SERVICE_GROUP_LABELS[g],
            }))}
            onChange={(serviceGroupBy) => setValues({ serviceGroupBy })}
          />
          <LabelledSelect
            label="Measure"
            value={metric}
            options={SERVICE_METRICS.map((m) => ({ value: m.key, label: m.label }))}
            onChange={(serviceMetric) => setValues({ serviceMetric })}
          />
          <CompareSwitch
            id="service-breakdown-compare"
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
        emptyMessage="No service requests were opened in this period for these filters."
        errorMessage="Couldn’t load the breakdown."
        onRetry={() => void refetch()}
      >
        {data && model && (
          <>
            <BreakdownChart
              data={model.chart}
              series={[
                { dataKey: seriesKey(0), label: def.label, color: SERIES_COLORS[0], members: [] },
              ]}
              kind={def.kind}
              showPrevious={view.compare}
              ariaLabel={`${def.label} by ${dimension.toLowerCase()}, ${data.period.current.from} to ${data.period.current.to}. Every value is in the table below.`}
            />
            <BreakdownTable
              caption={`Service requests by ${dimension.toLowerCase()}`}
              dimensionLabel={dimension}
              columns={SERVICE_METRICS}
              rows={model.table}
              totals={SERVICE_METRICS.map((m) => data.totals[m.key])}
              emphasis={metric}
              showChange={view.compare}
              changeUnit="percent"
            />
          </>
        )}
      </PanelBody>
    </DetailCard>
  );
}
