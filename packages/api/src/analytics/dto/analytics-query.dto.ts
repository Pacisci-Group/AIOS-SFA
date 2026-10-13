import {
  ANALYTICS_INTERVALS,
  OWNER_DASHBOARD_RANGE_KEYS,
  POLICY_TYPES,
  SALES_GROUP_BY,
  SALES_SEGMENT_BY,
  SERVICE_GROUP_BY,
} from '@sfa/shared';
import { z } from 'zod';
import {
  dashboardFilterFields,
  objectId,
} from '../../common/dashboard/dashboard-filter-query.dto';
import { multiValue } from '../../leads/dto/multi-value';
import { refineCustomRange } from '../../performance/dto/custom-range.refine';

const MAX_SELECTED = 50;

/** `'true'` / `'false'` in a query string, `false` when absent. */
const queryFlag = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

/**
 * The Analytics page's sales filter (PAC-152, part 2): the management
 * dashboards' fields, so one URL means one question on every page, plus the
 * two this page adds.
 */
export const salesFilterFields = {
  ...dashboardFilterFields,
  /**
   * Narrows an **agency-scope** caller to one branch. The scope clamps ignore
   * `X-Branch-Id` at agency scope, so without this an owner could not report
   * on one office. A branch- or own-scope caller is pinned already: their own
   * branch is accepted (and changes nothing), and any other is refused with a
   * 403 by `BranchGuard` before this DTO is read.
   */
  branchId: objectId.optional(),
  /**
   * Carrier display names (alias codes match too). Applied to sales only:
   * quote recaps record no carrier, so quote figures read as unavailable while
   * this is set.
   */
  carriers: z.preprocess(
    multiValue,
    z.array(z.string().trim().min(1).max(80)).max(MAX_SELECTED).optional(),
  ),
};

/** A segment must be a different dimension from the rows it splits. */
function refineSegment(
  value: { groupBy: string; segmentBy?: string },
  ctx: z.RefinementCtx,
): void {
  if (value.segmentBy && value.segmentBy === value.groupBy) {
    ctx.addIssue({
      code: 'custom',
      path: ['segmentBy'],
      message: 'segmentBy must differ from groupBy.',
    });
  }
}

export const salesSummaryQuerySchema = z
  .object(salesFilterFields)
  .superRefine(refineCustomRange);
export type SalesSummaryQuery = z.infer<typeof salesSummaryQuerySchema>;

export const salesBreakdownQuerySchema = z
  .object({
    ...salesFilterFields,
    groupBy: z.enum(SALES_GROUP_BY).default('producer'),
    segmentBy: z.enum(SALES_SEGMENT_BY).optional(),
    compare: queryFlag,
  })
  .superRefine(refineCustomRange)
  .superRefine(refineSegment);
export type SalesBreakdownQuery = z.infer<typeof salesBreakdownQuerySchema>;

export const salesTimeseriesQuerySchema = z
  .object({
    ...salesFilterFields,
    interval: z.enum(ANALYTICS_INTERVALS).default('month'),
    segmentBy: z.enum(SALES_SEGMENT_BY).optional(),
    compare: queryFlag,
  })
  .superRefine(refineCustomRange);
export type SalesTimeseriesQuery = z.infer<typeof salesTimeseriesQuerySchema>;

/**
 * The Service tab's filter. No lead source or carrier — a ticket carries
 * neither reliably — and the person filter is the **assignee**, not the
 * producer.
 */
export const serviceFilterFields = {
  range: z.enum(OWNER_DASHBOARD_RANGE_KEYS).default('mtd'),
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
  branchId: objectId.optional(),
  assigneeIds: z.preprocess(
    multiValue,
    z.array(objectId).max(MAX_SELECTED).optional(),
  ),
  policyTypes: z.preprocess(
    multiValue,
    z.array(z.enum(POLICY_TYPES)).max(POLICY_TYPES.length).optional(),
  ),
};

export const serviceSummaryQuerySchema = z
  .object(serviceFilterFields)
  .superRefine(refineCustomRange);
export type ServiceSummaryQuery = z.infer<typeof serviceSummaryQuerySchema>;

export const serviceBreakdownQuerySchema = z
  .object({
    ...serviceFilterFields,
    groupBy: z.enum(SERVICE_GROUP_BY).default('category'),
    compare: queryFlag,
  })
  .superRefine(refineCustomRange);
export type ServiceBreakdownQuery = z.infer<typeof serviceBreakdownQuerySchema>;

export const serviceTimeseriesQuerySchema = z
  .object({
    ...serviceFilterFields,
    interval: z.enum(ANALYTICS_INTERVALS).default('month'),
  })
  .superRefine(refineCustomRange);
export type ServiceTimeseriesQuery = z.infer<
  typeof serviceTimeseriesQuerySchema
>;
