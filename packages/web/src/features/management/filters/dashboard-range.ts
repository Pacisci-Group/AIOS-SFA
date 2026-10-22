import type { OwnerDashboardRangeKey } from "@sfa/shared";
import type { RangeChip } from "@/components/common/RangeChips";

/**
 * The management dashboards' period chips (PAC-135) — the mockup's five, with
 * "Today" and "Yesterday" in front (David, 14 Oct 2026: a single agency day for
 * the daily check-in) and the custom picker he asked to sit beside them. Shared
 * by the Owner view and the Manager view (PAC-139), which sit behind one filter
 * bar, so both get the day chips.
 */
export const DASHBOARD_RANGE_CHIPS: readonly RangeChip<OwnerDashboardRangeKey>[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "mtd", label: "This Month" },
  { key: "lastMonth", label: "Last Month" },
  { key: "last3Months", label: "Last 3 Months" },
  { key: "ytd", label: "YTD" },
  { key: "lastYear", label: "Last Year" },
  { key: "custom", label: "Custom Date" },
];

export const DASHBOARD_DEFAULT_RANGE_KEY: OwnerDashboardRangeKey = "mtd";

/**
 * Vocabulary guard for `useUrlState` — a stale `?range=` falls back to mtd.
 *
 * The chips, not the API's whole vocabulary: the API also accepts
 * `last12Months` (the Analytics page's chip), and a `?range=` no chip
 * highlights would leave this bar showing nothing selected.
 */
export const DASHBOARD_RANGE_KEYS = DASHBOARD_RANGE_CHIPS.map(
  (chip) => chip.key,
);
