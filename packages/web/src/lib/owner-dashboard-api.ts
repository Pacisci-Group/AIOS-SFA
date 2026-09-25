import type {
  OwnerDashboardSummary,
  OwnerLeadSourcesResponse,
  OwnerProducersResponse,
} from "@sfa/shared";
import { apiFetch } from "./api-client";
import {
  dashboardFilterSearch,
  type DashboardFilterParams,
} from "./dashboard-filter-params";

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
 * The one filter all three Owner dashboard reads take (PAC-135) — the same
 * shape the Manager view sends, since both sit behind one filter bar. See
 * `dashboard-filter-params.ts`.
 */
export type OwnerDashboardParams = DashboardFilterParams;

/** Query-key root. Anything that changes a sale or a quote invalidates this. */
export const ownerDashboardKey = ["owner-dashboard"] as const;

/** `GET /owner-dashboard/summary` — the KPI row. */
export function getOwnerSummary(params: OwnerDashboardParams) {
  return apiFetch<OwnerDashboardSummary>(
    `/owner-dashboard/summary?${dashboardFilterSearch(params)}`,
  );
}

/** `GET /owner-dashboard/producers` — the leaderboard. */
export function getOwnerProducers(params: OwnerDashboardParams) {
  return apiFetch<OwnerProducersResponse>(
    `/owner-dashboard/producers?${dashboardFilterSearch(params)}`,
  );
}

/** `GET /owner-dashboard/lead-sources` — the lead-source table. */
export function getOwnerLeadSources(params: OwnerDashboardParams) {
  return apiFetch<OwnerLeadSourcesResponse>(
    `/owner-dashboard/lead-sources?${dashboardFilterSearch(params)}`,
  );
}
