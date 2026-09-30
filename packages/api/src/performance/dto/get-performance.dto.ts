import { z } from 'zod';
import { RANGE_KEYS } from '../performance.range';
import { refineCustomRange } from './custom-range.refine';

/**
 * Query params for `GET /performance`.
 *
 * One shape serves the four presets and the custom picker: the client always
 * sends `range`, and only `custom` adds `from`/`to`. `scope` is a *request* —
 * the service clamps it to whatever the caller's `DataScope` allows.
 */
export const getPerformanceSchema = z
  .object({
    range: z.enum(RANGE_KEYS).default('mtd'),
    /** `YYYY-MM-DD`, Chicago calendar dates. `to` is inclusive. */
    from: z.string().trim().optional(),
    to: z.string().trim().optional(),
    scope: z.enum(['own', 'agency']).optional(),
  })
  .superRefine(refineCustomRange);

/** Inferred TypeScript type — single source of truth for the parsed query. */
export type GetPerformanceDto = z.infer<typeof getPerformanceSchema>;
