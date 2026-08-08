import { z } from 'zod';
import {
  MAX_CUSTOM_SPAN_DAYS,
  RANGE_KEYS,
  isValidIsoDate,
  spanDays,
} from '../performance.range';

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
  .superRefine((value, ctx) => {
    if (value.range !== 'custom') return;

    if (!value.from || !value.to) {
      ctx.addIssue({
        code: 'custom',
        path: ['from'],
        message: 'A custom range needs both from and to.',
      });
      return;
    }

    // Checked here rather than with a regex so `2026-02-31` is rejected too.
    for (const [key, raw] of [
      ['from', value.from],
      ['to', value.to],
    ] as const) {
      if (!isValidIsoDate(raw)) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} must be a real date in YYYY-MM-DD form.`,
        });
        return;
      }
    }

    if (value.from > value.to) {
      // Safe as a string comparison: ISO dates sort lexicographically.
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: 'from must not be after to.',
      });
      return;
    }

    // Load-bearing, not cosmetic. The aggregation accumulates distinct
    // households with `$addToSet`, and this is what bounds that set.
    if (spanDays(value.from, value.to) > MAX_CUSTOM_SPAN_DAYS) {
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: `A custom range may span at most ${MAX_CUSTOM_SPAN_DAYS} days.`,
      });
    }
  });

/** Inferred TypeScript type — single source of truth for the parsed query. */
export type GetPerformanceDto = z.infer<typeof getPerformanceSchema>;
