import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
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

/** How many rows the chart draws; the table beneath always lists them all. */
export const CHART_ROWS = 12;

const ROW_HEIGHT = 30;

export interface BreakdownDatum {
  label: string;
  /** Series data key → value. */
  [dataKey: string]: string | number | null;
}

/**
 * One horizontal bar per row — the shape a "sales by X" question wants: labels
 * read left to right, magnitudes compare along one baseline, and a long ZIP
 * or carrier name does not have to be rotated.
 *
 * Split by a segment, each bar stacks its series (fixed colour order, a 2px
 * card-coloured gap between segments). With a comparison, a thin muted bar
 * under each row is the prior period.
 */
export function BreakdownChart({
  data,
  series,
  kind,
  showPrevious,
  ariaLabel,
}: {
  data: BreakdownDatum[];
  series: ChartSeries[];
  kind: MetricKind;
  showPrevious: boolean;
  ariaLabel: string;
}) {
  const config: ChartConfig = Object.fromEntries([
    ...series.map((s) => [s.dataKey, { label: s.label, color: s.color }]),
    ["previous", { label: "Prior period", color: MUTED_COLOR }],
  ]);
  const labels = Object.fromEntries(
    Object.entries(config).map(([key, value]) => [key, String(value.label)]),
  );
  const stacked = series.length > 1;
  const height = Math.max(
    192,
    data.length * (showPrevious ? ROW_HEIGHT + 10 : ROW_HEIGHT) +
      (stacked ? 72 : 40),
  );

  return (
    <div role="img" aria-label={ariaLabel} className="px-2 pt-4 pb-2 sm:px-4">
      <ChartContainer
        config={config}
        className="aspect-auto w-full"
        style={{ height }}
      >
        <BarChart
          data={data}
          layout="vertical"
          margin={{ left: 4, right: 16 }}
          barCategoryGap={6}
          accessibilityLayer
        >
          <CartesianGrid horizontal={false} stroke="var(--border)" />
          <XAxis
            type="number"
            tickLine={false}
            axisLine={false}
            tickFormatter={(value: number) => formatTick(kind, value)}
          />
          <YAxis
            type="category"
            dataKey="label"
            width={128}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value: string) =>
              value.length > 18 ? `${value.slice(0, 17)}…` : value
            }
          />
          <ChartTooltip
            cursor={{ fill: "var(--muted)", opacity: 0.6 }}
            content={({ active, payload, label }) => (
              <ChartTooltipBox
                active={active}
                payload={payload}
                heading={String(label ?? "")}
                kind={kind}
                labels={labels}
              />
            )}
          />
          {stacked && (
            <ChartLegend
              verticalAlign="top"
              // Series order, not recharts' default sort by data key — which
              // would put "Other" and "Prior period" first.
              itemSorter={null}
              content={<ChartLegendContent className="flex-wrap pb-3" />}
            />
          )}
          {series.map((s, index) => (
            <Bar
              key={s.dataKey}
              dataKey={s.dataKey}
              stackId={stacked ? "row" : undefined}
              fill={`var(--color-${s.dataKey})`}
              stroke={stacked ? "var(--card)" : undefined}
              strokeWidth={stacked ? 2 : 0}
              radius={
                !stacked || index === series.length - 1 ? [0, 4, 4, 0] : 0
              }
              maxBarSize={20}
            />
          ))}
          {showPrevious && (
            <Bar
              dataKey="previous"
              fill="var(--color-previous)"
              fillOpacity={0.45}
              radius={[0, 3, 3, 0]}
              maxBarSize={6}
            />
          )}
        </BarChart>
      </ChartContainer>
    </div>
  );
}
