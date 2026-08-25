import { z } from 'zod';

/**
 * Query params for `GET /deal-audits`. Values arrive as strings, so we coerce
 * to numbers, then bound + default them. `page` is 1-based; `pageSize` is
 * capped to keep the hand-off board responses small.
 */
export const listDealAuditsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(8),
  /**
   * The soft-deadline filter (PAC-65).
   *
   * `all` adds no clause at all, so the default response is byte-identical to
   * the pre-PAC-65 one. Note both narrowing values also exclude items with no
   * `dueAt` — a missing deadline is not an overdue one, and there is no
   * backfill that would give the old items a date to be judged against.
   */
  due: z.enum(['all', 'overdue', 'due_soon']).default('all'),
});

/** How far ahead `due=due_soon` looks. */
export const DUE_SOON_DAYS = 3;

/** Inferred TypeScript type — single source of truth for the parsed query. */
export type ListDealAuditsDto = z.infer<typeof listDealAuditsSchema>;
