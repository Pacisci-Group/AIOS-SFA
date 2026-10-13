import type {
  AnalyticsInterval,
  AnalyticsOptionsResponse,
  AnalyticsSalesSummary,
  OwnerDashboardRangeKey,
  SalesBreakdownResponse,
  SalesGroupBy,
  SalesSegmentBy,
  SalesTimeseriesResponse,
  ServiceBreakdownResponse,
  ServiceGroupBy,
  ServiceSummary,
  ServiceTimeseriesResponse,
} from "@sfa/shared";
import { apiFetch } from "./api-client";
import {
  dashboardFilterSearch,
  type DashboardFilterParams,
} from "./dashboard-filter-params";

// Re-exported so components import the contract from the client module.
export type {
  AnalyticsBucket,
  AnalyticsInterval,
  AnalyticsOptionsResponse,
  AnalyticsSalesSummary,
  AnalyticsSeries,
  GoalPacing,
  GoalPacingGap,
  SalesBreakdownResponse,
  SalesBreakdownRow,
  SalesGroupBy,
  SalesMetrics,
  SalesSegmentBy,
  SalesTimeseriesBucket,
  SalesTimeseriesResponse,
  ServiceBreakdownResponse,
  ServiceBreakdownRow,
  ServiceGroupBy,
  ServiceMetrics,
  ServiceSummary,
  ServiceTimeseriesResponse,
} from "@sfa/shared";

/** The Sales tab's filter: the dashboards' fields plus branch and carrier. */
export interface SalesFilterParams extends DashboardFilterParams {
  /** Honoured for an agency-scope caller only. */
  branchId: string;
  carriers: readonly string[];
}

/** The Service tab's filter. The person filter is the ticket's assignee. */
export interface ServiceFilterParams {
  range: OwnerDashboardRangeKey;
  from?: string;
  to?: string;
  branchId: string;
  assigneeIds: readonly string[];
  policyTypes: readonly string[];
}

export const analyticsKey = ["analytics"] as const;

function salesSearch(
  params: SalesFilterParams,
  extra: Record<string, string | number | undefined> = {},
): string {
  return dashboardFilterSearch(params, {
    branchId: params.branchId || undefined,
    carriers: params.carriers.length ? params.carriers.join(",") : undefined,
    ...extra,
  });
}

function serviceSearch(
  params: ServiceFilterParams,
  extra: Record<string, string | number | undefined> = {},
): string {
  const search = new URLSearchParams({ range: params.range });
  if (params.range === "custom" && params.from && params.to) {
    search.set("from", params.from);
    search.set("to", params.to);
  }
  if (params.branchId) search.set("branchId", params.branchId);
  if (params.assigneeIds.length)
    search.set("assigneeIds", params.assigneeIds.join(","));
  if (params.policyTypes.length)
    search.set("policyTypes", params.policyTypes.join(","));
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined) search.set(key, String(value));
  }
  return search.toString();
}

/** `GET /analytics/options` — what the filter bar can offer. */
export function getAnalyticsOptions() {
  return apiFetch<AnalyticsOptionsResponse>("/analytics/options");
}

export function getSalesSummary(params: SalesFilterParams) {
  return apiFetch<AnalyticsSalesSummary>(
    `/analytics/sales/summary?${salesSearch(params)}`,
  );
}

export function getSalesBreakdown(
  params: SalesFilterParams,
  view: { groupBy: SalesGroupBy; segmentBy: SalesSegmentBy | null; compare: boolean },
) {
  return apiFetch<SalesBreakdownResponse>(
    `/analytics/sales/breakdown?${salesSearch(params, {
      groupBy: view.groupBy,
      segmentBy: view.segmentBy ?? undefined,
      compare: view.compare ? "true" : undefined,
    })}`,
  );
}

export function getSalesTimeseries(
  params: SalesFilterParams,
  view: {
    interval: AnalyticsInterval;
    segmentBy: SalesSegmentBy | null;
    compare: boolean;
  },
) {
  return apiFetch<SalesTimeseriesResponse>(
    `/analytics/sales/timeseries?${salesSearch(params, {
      interval: view.interval,
      segmentBy: view.segmentBy ?? undefined,
      compare: view.compare ? "true" : undefined,
    })}`,
  );
}

export function getServiceSummary(params: ServiceFilterParams) {
  return apiFetch<ServiceSummary>(
    `/analytics/service/summary?${serviceSearch(params)}`,
  );
}

export function getServiceBreakdown(
  params: ServiceFilterParams,
  view: { groupBy: ServiceGroupBy; compare: boolean },
) {
  return apiFetch<ServiceBreakdownResponse>(
    `/analytics/service/breakdown?${serviceSearch(params, {
      groupBy: view.groupBy,
      compare: view.compare ? "true" : undefined,
    })}`,
  );
}

export function getServiceTimeseries(
  params: ServiceFilterParams,
  view: { interval: AnalyticsInterval },
) {
  return apiFetch<ServiceTimeseriesResponse>(
    `/analytics/service/timeseries?${serviceSearch(params, {
      interval: view.interval,
    })}`,
  );
}
