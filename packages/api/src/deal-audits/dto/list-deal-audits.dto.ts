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
  /**
   * One deal's card only (PAC-106) — what the `audit.sent_back`
   * notification's link (`/dashboard/producer?audit=<dealId>`) opens, wherever
   * the card sits in the board's paging. Same scope and board rules: a deal
   * the caller cannot see, or that is no longer waiting on them, is an empty
   * page, not a 404.
   */
  dealId: z
    .string()
    .regex(/^[a-f0-9]{24}$/i)
    .optional(),
});

/** How far ahead `due=due_soon` looks. */
export const DUE_SOON_DAYS = 3;

/** Inferred TypeScript type — single source of truth for the parsed query. */
export type ListDealAuditsDto = z.infer<typeof listDealAuditsSchema>;
