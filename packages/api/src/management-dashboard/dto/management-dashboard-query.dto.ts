import { z } from 'zod';
import {
  dashboardFilterFields,
  dashboardFilterQuerySchema,
  type DashboardFilterQuery,
} from '../../common/dashboard/dashboard-filter-query.dto';
import { refineCustomRange } from '../../performance/dto/custom-range.refine';

/**
 * Query params for the Manager view's reads (PAC-139): the same filter the
 * Owner view takes, from the same filter bar.
 */
export const managementDashboardQuerySchema = dashboardFilterQuerySchema;

export type ManagementDashboardQueryDto = DashboardFilterQuery;

/** A drawer page. Capped: a drawer is a list to scan, not an export. */
export const MAX_ALERT_PAGE_SIZE = 200;

/**
 * The three drawer lists take the filter plus a page. `page` is 1-based.
 * `pageSize` defaults high enough that the usual drawer is one page — the
 * card's number is the drawer's `total` either way.
 */
export const managementAlertListQuerySchema = z
  .object({
    ...dashboardFilterFields,
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_ALERT_PAGE_SIZE)
      .default(50),
  })
  .superRefine(refineCustomRange);

export type ManagementAlertListQueryDto = z.infer<
  typeof managementAlertListQuerySchema
>;
