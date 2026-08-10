import { LEAD_TEMPERATURES } from '@sfa/shared';
import { z } from 'zod';
import { multiValue } from './multi-value';

/**
 * Query params for `GET /leads/hot`.
 *
 * No `page`/`pageSize`: this is a fixed-size dashboard panel, not a table.
 * `scope` is a *request* — the service clamps it to the caller's `DataScope`.
 */
export const listHotLeadsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(25).default(5),
  /**
   * Which temperatures to draw from, in priority order. Defaults to
   * `['Hot', 'Warm']`: the panel tops up with Warm leads when a producer has
   * fewer than `limit` Hot ones, so the card is never half-empty.
   */
  temperature: z.preprocess(
    multiValue,
    z.array(z.enum(LEAD_TEMPERATURES)).max(LEAD_TEMPERATURES.length).optional(),
  ),
  scope: z.enum(['own', 'agency']).optional(),
});

/** Inferred TypeScript type — single source of truth for the parsed query. */
export type ListHotLeadsDto = z.infer<typeof listHotLeadsSchema>;
