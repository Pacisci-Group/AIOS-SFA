import type { ReactNode } from "react";
import { formatMetric, type MetricKind } from "../analytics-format";

interface TooltipEntry {
  dataKey?: unknown;
  name?: unknown;
  value?: unknown;
  color?: string;
}

/**
 * The hover card every analytics chart shares: a heading, then one line per
 * series — a colour swatch for identity, the name and value in text ink (never
 * in the series colour, which is illegible as text on the card).
 */
export function ChartTooltipBox({
  active,
  payload,
  heading,
  kind,
  labels,
}: {
  active?: boolean;
  payload?: readonly TooltipEntry[];
  heading: ReactNode;
  kind: MetricKind;
  /** Series data key → display name. */
  labels: Record<string, string>;
}) {
  if (!active || !payload?.length) return null;
  const entries = payload.filter(
    (entry) => typeof entry.value === "number" && entry.value !== 0,
  );
  return (
    <div className="grid min-w-40 gap-1.5 rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <p className="font-medium">{heading}</p>
      {entries.length === 0 ? (
        <p className="text-muted-foreground">Nothing in this period.</p>
      ) : (
        entries.map((entry) => {
          const key = String(entry.dataKey ?? "");
          return (
            <div key={key} className="flex items-center gap-2">
              <span
                aria-hidden
                className="size-2.5 shrink-0 rounded-[2px]"
                style={{ background: entry.color }}
              />
              <span className="flex-1 text-muted-foreground">
                {labels[key] ?? String(entry.name ?? key)}
              </span>
              <span className="font-medium tabular-nums">
                {formatMetric(kind, entry.value as number)}
              </span>
            </div>
          );
        })
      )}
    </div>
  );
}
