import { PRODUCER_NONE } from '@sfa/shared';
import { z } from 'zod';
import {
  dashboardFilterFields,
  dashboardFilterQuerySchema,
  objectId,
  type DashboardFilterQuery,
} from '../../common/dashboard/dashboard-filter-query.dto';
import { refineCustomRange } from '../../performance/dto/custom-range.refine';

/**
 * Query params for the `GET /owner-dashboard/*` reads (PAC-135).
 *
 * **One schema on purpose.** The KPI row, the leaderboard, the lead-source
 * table and the quotes-by-producer table promise to agree with each other,
 * which is only true if they can never be asked slightly different questions.
 *
 * The fields live in `common/dashboard/dashboard-filter-query.dto.ts` since the
 * Manager view (PAC-139) started taking the same filter from the same bar.
 */
export const ownerDashboardQuerySchema = dashboardFilterQuerySchema;

export type OwnerDashboardQueryDto = DashboardFilterQuery;

/** Generous: a producer's open quotes for a year are a few hundred. */
export const MAX_OPEN_QUOTES_PAGE_SIZE = 200;

/**
 * `GET /owner-dashboard/open-quotes` — the same filter plus the drawer's
 * producer and a page. Composed from the field map rather than extended: a
 * `superRefine`d schema cannot be `.extend()`ed, so the custom-range check is
 * re-applied here (the `managementAlertListQuerySchema` pattern).
 */
export const ownerOpenQuotesQuerySchema = z
  .object({
    ...dashboardFilterFields,
    /** One producer, or `__none__` for quotes with none. Omitted = everyone in scope. */
    producer: z.union([z.literal(PRODUCER_NONE), objectId]).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_OPEN_QUOTES_PAGE_SIZE)
      .default(50),
  })
  .superRefine(refineCustomRange);

export type OwnerOpenQuotesQueryDto = z.infer<
  typeof ownerOpenQuotesQuerySchema
>;
