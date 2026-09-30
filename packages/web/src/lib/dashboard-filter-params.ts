import type { OwnerDashboardRangeKey } from "@sfa/shared";

/**
 * The one filter every management-dashboard read takes (PAC-135, PAC-139):
 * the Owner view's KPI row, leaderboard and lead-source table, and the Manager
 * view's alert cards, drawers, Team Activity table and producer drawer.
 *
 * One shape on purpose: the two views share one filter bar, and everything on
 * either page promises to agree with everything else on it, which only holds
 * if they are always asked the same question. Arrays arrive already in
 * canonical order (`MultiSelect` emits in `options` order), so this object is
 * safe inside a query key.
 */
export interface DashboardFilterParams {
  range: OwnerDashboardRangeKey;
  /** `YYYY-MM-DD`, inclusive; sent only with `range: "custom"`. */
  from?: string;
  to?: string;
  producerIds: readonly string[];
  /** `leadSources` row ids and/or `LEAD_SOURCE_NONE`. */
  leadSourceIds: readonly string[];
  /** Line of business — canonical policy types. */
  policyTypes: readonly string[];
}

/** The filter as a query string, the way the API's shared schema reads it. */
export function dashboardFilterSearch(
  params: DashboardFilterParams,
  extra: Record<string, string | number | undefined> = {},
): string {
  const search = new URLSearchParams({ range: params.range });
  if (params.range === "custom" && params.from && params.to) {
    search.set("from", params.from);
    search.set("to", params.to);
  }
  // Comma-separated: the API accepts that, the repeated form, or a single value.
  for (const key of ["producerIds", "leadSourceIds", "policyTypes"] as const) {
    if (params[key].length > 0) search.set(key, params[key].join(","));
  }
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined) search.set(key, String(value));
  }
  return search.toString();
}
