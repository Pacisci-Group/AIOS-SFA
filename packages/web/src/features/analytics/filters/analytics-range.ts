import type { AnalyticsInterval, OwnerDashboardRangeKey } from "@sfa/shared";
import type { RangeChip } from "@/components/common/RangeChips";
import type { UrlRange } from "@/lib/date-range";
import { defaultInterval } from "../analytics-format";

/**
 * The Analytics page's period chips: the management dashboards' set plus
 * "Last 12 Months" — the year view a service trend wants, and the window
 * AgencyZoom's service chart shows.
 */
export const ANALYTICS_RANGE_CHIPS: readonly RangeChip<OwnerDashboardRangeKey>[] =
  [
    { key: "mtd", label: "This Month" },
    { key: "lastMonth", label: "Last Month" },
    { key: "last3Months", label: "Last 3 Months" },
    { key: "last12Months", label: "Last 12 Months" },
    { key: "ytd", label: "YTD" },
    { key: "lastYear", label: "Last Year" },
    { key: "custom", label: "Custom Date" },
  ];

export const ANALYTICS_RANGE_KEYS = ANALYTICS_RANGE_CHIPS.map((chip) => chip.key);

/** The grain a trend opens at for this period, before the user picks one. */
export function intervalForRange(
  range: UrlRange<OwnerDashboardRangeKey>,
): AnalyticsInterval {
  switch (range.key) {
    case "mtd":
    case "lastMonth":
      return "day";
    case "last3Months":
      return "week";
    case "custom":
      return range.from && range.to ? defaultInterval(range.from, range.to) : "day";
    default:
      return "month";
  }
}
