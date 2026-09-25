import type {
  AgingAuditRow,
  ManagementAlertList,
  ManagementAlerts,
  ManagementDrawerKey,
  OverdueTicketRow,
  ProducerDrawerResponse,
  StalledLeadRow,
  TeamActivityResponse,
} from "@sfa/shared";
import { apiFetch } from "./api-client";
import {
  dashboardFilterSearch,
  type DashboardFilterParams,
} from "./dashboard-filter-params";

// Re-exported so components import the contract from the client module.
export type {
  AgingAuditRow,
  ManagementAlertList,
  ManagementAlerts,
  ManagementDrawerKey,
  OverdueTicketRow,
  ProducerDrawerResponse,
  ProducerOpenAuditItem,
  ProducerPipelineLead,
  StalledLeadRow,
  TeamActivityResponse,
  TeamActivityRow,
  TeamActivityStats,
} from "@sfa/shared";

/**
 * Query-key root for the Manager view (PAC-139). Anything that changes a
 * lead, a sale, a quote, an audit or a ticket invalidates this — the same
 * places that invalidate `ownerDashboardKey`.
 */
export const managementDashboardKey = ["management-dashboard"] as const;

/** `GET /management-dashboard/alerts` — the three cards. */
export function getManagementAlerts(params: DashboardFilterParams) {
  return apiFetch<ManagementAlerts>(
    `/management-dashboard/alerts?${dashboardFilterSearch(params)}`,
  );
}

/** The drawer list behind each card, keyed the way the URL names them. */
const DRAWER_PATHS: Record<ManagementDrawerKey, string> = {
  stalled: "stalled-leads",
  aging: "aging-audits",
  overdue: "overdue-tickets",
};

export interface DrawerRows {
  stalled: StalledLeadRow;
  aging: AgingAuditRow;
  overdue: OverdueTicketRow;
}

/** `GET /management-dashboard/alerts/<list>` — one page of a drawer. */
export function getManagementDrawer<K extends ManagementDrawerKey>(
  key: K,
  params: DashboardFilterParams,
  page: number,
) {
  return apiFetch<ManagementAlertList<DrawerRows[K]>>(
    `/management-dashboard/alerts/${DRAWER_PATHS[key]}?${dashboardFilterSearch(params, { page })}`,
  );
}

/** `GET /management-dashboard/team` — the Team Activity table. */
export function getTeamActivity(params: DashboardFilterParams) {
  return apiFetch<TeamActivityResponse>(
    `/management-dashboard/team?${dashboardFilterSearch(params)}`,
  );
}

/** `GET /management-dashboard/producers/:producerId` — the producer drawer. */
export function getProducerDrawer(
  producerId: string,
  params: DashboardFilterParams,
) {
  return apiFetch<ProducerDrawerResponse>(
    `/management-dashboard/producers/${producerId}?${dashboardFilterSearch(params)}`,
  );
}
