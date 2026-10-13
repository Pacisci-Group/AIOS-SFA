import type {
  AnalyticsInterval,
  SalesGroupBy,
  SalesMetrics,
  SalesSegmentBy,
  ServiceGroupBy,
  ServiceMetrics,
} from "@/lib/analytics-api";
import { NOT_AVAILABLE } from "@/lib/not-available";
import {
  formatCount,
  formatMoney,
  formatMoneyCompact,
  formatPct,
} from "@/features/owner-dashboard/owner-format";

export {
  comparisonDates,
  comparisonLabel,
  formatCount,
  formatMoney,
  formatMoneyCompact,
  formatPct,
} from "@/features/owner-dashboard/owner-format";

/** What a breakdown row is, in the words the menu uses. */
export const SALES_GROUP_LABELS: Record<SalesGroupBy, string> = {
  producer: "Producer",
  leadSource: "Lead source",
  policyType: "Policy line",
  carrier: "Carrier",
  branch: "Branch",
  zip: "ZIP code",
  csr: "CSR",
};

export const SALES_SEGMENT_LABELS: Record<SalesSegmentBy, string> = {
  policyType: "Policy line",
  carrier: "Carrier",
  leadSource: "Lead source",
  producer: "Producer",
  branch: "Branch",
};

export const SERVICE_GROUP_LABELS: Record<ServiceGroupBy, string> = {
  category: "Category",
  policyType: "Policy line",
  status: "Status",
  priority: "Priority",
  assignee: "Assignee",
  branch: "Branch",
};

export type MetricKind = "money" | "count" | "pct" | "hours";

export interface MetricDef<K extends string> {
  key: K;
  label: string;
  kind: MetricKind;
  /** One sentence for the column's help glyph. */
  hint: string;
}

/** The sales measures, in table order. The first is the default chart measure. */
export const SALES_METRICS: readonly MetricDef<
  Exclude<keyof SalesMetrics, "closingGap">
>[] = [
  {
    key: "premium",
    label: "Bound premium",
    kind: "money",
    hint: "Premium on new business sold in this period, summed from its policies — the Owner dashboard's figure.",
  },
  {
    key: "netPremium",
    label: "Net premium",
    kind: "money",
    hint: "Bound premium after chargebacks. A chargeback belongs to a sale, so this is not split by policy line or carrier.",
  },
  {
    key: "items",
    label: "Items",
    kind: "count",
    hint: "Insured items — cars, homes and the like — across every policy sold.",
  },
  {
    key: "policies",
    label: "Policies",
    kind: "count",
    hint: "Policies sold.",
  },
  {
    key: "deals",
    label: "Sales",
    kind: "count",
    hint: "Sales recorded on the Sold form. A bundle counts once in each of its lines, so line and carrier rows do not add up to the total.",
  },
  {
    key: "households",
    label: "Households",
    kind: "count",
    hint: "Distinct households sold to. One household can appear in several rows.",
  },
  {
    key: "quotes",
    label: "Quotes",
    kind: "count",
    hint: "Quote recaps written in this period. A quote records no carrier.",
  },
  {
    key: "quotedPremium",
    label: "Quoted premium",
    kind: "money",
    hint: "Premium on the quote recaps written in this period.",
  },
  {
    key: "closingPct",
    label: "Closing ratio",
    kind: "pct",
    hint: "Bound premium ÷ quoted premium. Not shown where too few quotes were recorded to mean anything.",
  },
];

/** The measures a sales trend can chart. */
export const SALES_TREND_METRICS = [
  { key: "premium", label: "Bound premium", kind: "money" },
  { key: "items", label: "Items", kind: "count" },
  { key: "deals", label: "Sales", kind: "count" },
  { key: "quotes", label: "Quotes", kind: "count" },
  { key: "quotedPremium", label: "Quoted premium", kind: "money" },
] as const;
export type SalesTrendMetric = (typeof SALES_TREND_METRICS)[number]["key"];

export const SERVICE_METRICS: readonly MetricDef<keyof ServiceMetrics>[] = [
  {
    key: "opened",
    label: "Opened",
    kind: "count",
    hint: "Tickets opened in this period.",
  },
  {
    key: "resolved",
    label: "Resolved",
    kind: "count",
    hint: "Of those, how many have been resolved since.",
  },
  {
    key: "stillOpen",
    label: "Still open",
    kind: "count",
    hint: "Of those, how many are still open now.",
  },
  {
    key: "overdue",
    label: "Overdue",
    kind: "count",
    hint: "Of those, how many are overdue now.",
  },
  {
    key: "avgHoursToResolve",
    label: "Avg time to resolve",
    kind: "hours",
    hint: "Mean time from opened to resolved, over the resolved ones.",
  },
];

export function formatHours(value: number | null): string {
  if (value === null) return NOT_AVAILABLE;
  if (value < 48) return `${value.toLocaleString("en-US")} h`;
  return `${(value / 24).toLocaleString("en-US", { maximumFractionDigits: 1 })} d`;
}

export function formatMetric(kind: MetricKind, value: number | null): string {
  switch (kind) {
    case "money":
      return formatMoney(value);
    case "pct":
      return formatPct(value);
    case "hours":
      return formatHours(value);
    default:
      return formatCount(value);
  }
}

/** Axis ticks: compact money, plain counts. */
export function formatTick(kind: MetricKind, value: number): string {
  if (kind === "money") return formatMoneyCompact(value);
  if (kind === "pct") return `${value}%`;
  return value.toLocaleString("en-US", { notation: "compact" });
}

/** The grain a window reads best at: days for a month, weeks for a quarter. */
export function defaultInterval(from: string, to: string): AnalyticsInterval {
  const days =
    (Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) /
      86_400_000 +
    1;
  if (days <= 31) return "day";
  if (days <= 120) return "week";
  return "month";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A bucket key on an axis: `May 4` for a day or week, `May '26` for a month. */
export function formatBucket(key: string, interval: AnalyticsInterval): string {
  const [year, month, day] = key.split("-").map(Number);
  if (interval === "month") return `${MONTHS[month - 1]} '${String(year).slice(2)}`;
  return `${MONTHS[month - 1]} ${day}`;
}

/** The same bucket in full, for a tooltip. */
export function formatBucketLong(
  bucket: { key: string; from: string; to: string },
  interval: AnalyticsInterval,
): string {
  const day = (iso: string) => {
    const [, m, d] = iso.split("-").map(Number);
    return `${MONTHS[m - 1]} ${d}`;
  };
  if (interval === "day") return day(bucket.from);
  if (interval === "month") {
    const [year, month] = bucket.key.split("-").map(Number);
    return `${MONTHS[month - 1]} ${year}`;
  }
  return `${day(bucket.from)} – ${day(bucket.to)}`;
}
