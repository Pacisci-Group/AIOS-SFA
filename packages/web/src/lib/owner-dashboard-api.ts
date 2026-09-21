import type {
  OwnerDashboardRangeKey,
  OwnerDashboardSummary,
  OwnerLeadSourcesResponse,
  OwnerProducersResponse,
} from "@sfa/shared";
import { apiFetch } from "./api-client";

// Re-exported so components import the contract from the client module, the
// same way they do for `performance-api`.
export type {
  OwnerClosingRatio,
  OwnerDashboardPeriod,
  OwnerDashboardRangeKey,
  OwnerDashboardSummary,
  OwnerLeadSourceRow,
  OwnerLeadSourcesResponse,
  OwnerLobMix,
  OwnerProducerRow,
  OwnerProducersResponse,
  OwnerTrend,
} from "@sfa/shared";

/**
 * The one filter all three Owner dashboard reads take (PAC-135).
 *
 * One shape on purpose: the KPI row, the leaderboard and the lead-source table
 * promise to agree with each other, which only holds if they are always asked
 * the same question. Arrays arrive already in canonical order (`MultiSelect`
 * emits in `options` order), so this object is safe inside a query key.
 */
export interface OwnerDashboardParams {
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

/** Query-key root. Anything that changes a sale or a quote invalidates this. */
export const ownerDashboardKey = ["owner-dashboard"] as const;

function toSearch(params: OwnerDashboardParams): string {
  const search = new URLSearchParams({ range: params.range });
  if (params.range === "custom" && params.from && params.to) {
    search.set("from", params.from);
    search.set("to", params.to);
  }
  // Comma-separated: the API accepts that, the repeated form, or a single value.
  for (const key of ["producerIds", "leadSourceIds", "policyTypes"] as const) {
    if (params[key].length > 0) search.set(key, params[key].join(","));
  }
  return search.toString();
}

/** `GET /owner-dashboard/summary` — the KPI row. */
export function getOwnerSummary(params: OwnerDashboardParams) {
  return apiFetch<OwnerDashboardSummary>(
    `/owner-dashboard/summary?${toSearch(params)}`,
  );
}

/** `GET /owner-dashboard/producers` — the leaderboard. */
export function getOwnerProducers(params: OwnerDashboardParams) {
  return apiFetch<OwnerProducersResponse>(
    `/owner-dashboard/producers?${toSearch(params)}`,
  );
}

/** `GET /owner-dashboard/lead-sources` — the lead-source table. */
export function getOwnerLeadSources(params: OwnerDashboardParams) {
  return apiFetch<OwnerLeadSourcesResponse>(
    `/owner-dashboard/lead-sources?${toSearch(params)}`,
  );
}
