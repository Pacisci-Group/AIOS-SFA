import { z } from 'zod';

/**
 * Query params for `GET /deal-audits`. Values arrive as strings, so we coerce
 * to numbers, then bound + default them. `page` is 1-based; `pageSize` is
 * capped to keep the hand-off board responses small.
 */
export const listDealAuditsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(8),
});

/** Inferred TypeScript type — single source of truth for the parsed query. */
export type ListDealAuditsDto = z.infer<typeof listDealAuditsSchema>;
