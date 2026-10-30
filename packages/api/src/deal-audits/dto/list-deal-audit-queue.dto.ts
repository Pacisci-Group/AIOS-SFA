import {
  DEAL_AUDIT_QUEUE_RANGE_KEYS,
  DEAL_AUDIT_QUEUE_SORTS,
  DEAL_AUDIT_QUEUE_STATUSES,
  MAX_SEARCH_TERM_LENGTH,
} from '@sfa/shared';
import { z } from 'zod';
import { dashboardFilterFields } from '../../common/dashboard/dashboard-filter-query.dto';
import { refineCustomRange } from '../../performance/dto/custom-range.refine';

/** `'true'` / `'false'` in a query string, `false` when absent. */
const queryFlag = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

/**
 * Query params for `GET /deal-audits/queue` — the Deal Audits page (PAC-106).
 *
 * `status` defaults to `open`: everything the manager still has to think
 * about, i.e. every audit that has not passed.
 *
 * Search, filters and sort (20 Oct 2026) reuse the management dashboards'
 * fields — `producerIds`, `policyTypes`, `from` / `to` — so "Home" or "Last
 * Month" means the same question on every page. The one difference is the
 * period's default: `all`, no window, where the dashboards default to
 * month-to-date.
 *
 * ⚠ No `branchId` param. `BranchGuard` reads `query.branchId`, and would
 * refuse a branch manager naming any other branch — the scope already narrows
 * the queue to what the caller may see.
 */
export const listDealAuditQueueSchema = z
  .object({
    status: z.enum(DEAL_AUDIT_QUEUE_STATUSES).default('open'),
    /**
     * A client name, a producer name or a policy number. A blank box is no
     * filter (`?q=` is what a cleared input sends).
     */
    q: z
      .string()
      .trim()
      .max(MAX_SEARCH_TERM_LENGTH)
      .optional()
      .transform((value) => value || undefined),
    producerIds: dashboardFilterFields.producerIds,
    policyTypes: dashboardFilterFields.policyTypes,
    /** Only deals past the five-business-day SLA, never an approved one. */
    aging: queryFlag,
    range: z.enum(DEAL_AUDIT_QUEUE_RANGE_KEYS).default('all'),
    from: dashboardFilterFields.from,
    to: dashboardFilterFields.to,
    sort: z.enum(DEAL_AUDIT_QUEUE_SORTS).default('waiting'),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  // Only acts on `range: 'custom'`, so `all` passes straight through.
  .superRefine(refineCustomRange);

export type ListDealAuditQueueDto = z.infer<typeof listDealAuditQueueSchema>;
