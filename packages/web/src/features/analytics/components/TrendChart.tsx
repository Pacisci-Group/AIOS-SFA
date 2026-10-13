import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  type ChartConfig,
} from "@/components/ui/chart";
import { formatTick, type MetricKind } from "../analytics-format";
import { MUTED_COLOR, type ChartSeries } from "../chart-palette";
import { ChartTooltipBox } from "./ChartTooltipBox";

export interface TrendDatum {
  /** The x-axis label. */
  label: string;
  /** The tooltip heading. */
  heading: string;
  [dataKey: string]: string | number | null;
}

/**
 * A measure across the window.
 *
 * - **One series:** a 2px line over a 10% wash — the shape of a total over
 *   time. With a comparison, the prior period is a dashed muted line aligned
 *   bucket for bucket.
 * - **Several series, stacked:** bars per bucket, each split by its series
 *   (fixed colour order, 2px gaps) — how a total is made up, bucket by bucket.
 * - **Several series, side by side** (`grouped`): bars next to each other —
 *   two measures to compare, like tickets opened against resolved.
 */
export function TrendChart({
  data,
  series,
  kind,
  showPrevious,
  grouped = false,
  ariaLabel,
}: {
  data: TrendDatum[];
  series: ChartSeries[];
  kind: MetricKind;
  showPrevious: boolean;
  grouped?: boolean;
  ariaLabel: string;
}) {
  const config: ChartConfig = Object.fromEntries([
    ...series.map((s) => [s.dataKey, { label: s.label, color: s.color }]),
    ["previous", { label: "Prior period", color: MUTED_COLOR }],
  ]);
  const labels = Object.fromEntries(
    Object.entries(config).map(([key, value]) => [key, String(value.label)]),
  );
  const single = series.length === 1;
  const headingFor = (label: unknown) =>
    data.find((row) => row.label === label)?.heading ?? String(label ?? "");

  return (
    <div role="img" aria-label={ariaLabel} className="px-2 pt-4 pb-2 sm:px-4">
      <ChartContainer config={config} className="aspect-auto h-64 w-full sm:h-72">
        <ComposedChart data={data} margin={{ left: 4, right: 12 }} accessibilityLayer>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            minTickGap={16}
          />
          <YAxis
            width={56}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value: number) => formatTick(kind, value)}
          />
          <ChartTooltip
            cursor={
              single
                ? { stroke: "var(--border)", strokeWidth: 1 }
                : { fill: "var(--muted)", opacity: 0.6 }
            }
            content={({ active, payload, label }) => (
              <ChartTooltipBox
                active={active}
                payload={payload}
                heading={headingFor(label)}
                kind={kind}
                labels={labels}
              />
            )}
          />
          {(!single || showPrevious) && (
            <ChartLegend
              verticalAlign="top"
              // Series order, not recharts' default sort by data key — which
              // would put "Other" and "Prior period" first.
              itemSorter={null}
              content={<ChartLegendContent className="flex-wrap pb-3" />}
            />
          )}
          {single ? (
            <Area
              dataKey={series[0].dataKey}
              type="monotone"
              stroke={`var(--color-${series[0].dataKey})`}
              strokeWidth={2}
              fill={`var(--color-${series[0].dataKey})`}
              fillOpacity={0.1}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
            />
          ) : (
            series.map((s, index) => (
              <Bar
                key={s.dataKey}
                dataKey={s.dataKey}
                stackId={grouped ? undefined : "bucket"}
                fill={`var(--color-${s.dataKey})`}
                stroke={grouped ? undefined : "var(--card)"}
                strokeWidth={grouped ? 0 : 2}
                radius={
                  grouped || index === series.length - 1 ? [4, 4, 0, 0] : 0
                }
                maxBarSize={grouped ? 16 : 28}
              />
            ))
          )}
          {showPrevious && (
            <Line
              dataKey="previous"
              type="monotone"
              stroke="var(--color-previous)"
              strokeWidth={2}
              strokeDasharray="4 4"
              dot={false}
            />
          )}
        </ComposedChart>
      </ChartContainer>
    </div>
  );
}
