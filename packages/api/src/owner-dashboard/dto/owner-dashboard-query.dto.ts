import {
  dashboardFilterQuerySchema,
  type DashboardFilterQuery,
} from '../../common/dashboard/dashboard-filter-query.dto';

/**
 * Query params for all three `GET /owner-dashboard/*` reads (PAC-135).
 *
 * **One schema on purpose.** The KPI row, the leaderboard and the lead-source
 * table promise to agree with each other, which is only true if they can never
 * be asked slightly different questions.
 *
 * The fields live in `common/dashboard/dashboard-filter-query.dto.ts` since the
 * Manager view (PAC-139) started taking the same filter from the same bar.
 */
export const ownerDashboardQuerySchema = dashboardFilterQuerySchema;

export type OwnerDashboardQueryDto = DashboardFilterQuery;
