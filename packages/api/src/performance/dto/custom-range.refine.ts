import { z } from 'zod';
import {
  MAX_CUSTOM_SPAN_DAYS,
  isValidIsoDate,
  spanDays,
} from '../performance.range';

/**
 * The `custom` range rules, shared by every endpoint that takes one.
 *
 * Extracted when the Owner dashboard (PAC-135) became the second caller: two
 * copies of "what is a valid custom window" would let the two dashboards accept
 * different dates for the same picker.
 */
export function refineCustomRange(
  value: { range: string; from?: string; to?: string },
  ctx: z.RefinementCtx,
): void {
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

  // Load-bearing, not cosmetic. The aggregations accumulate distinct households
  // with `$addToSet`, and this is what bounds that set.
  if (spanDays(value.from, value.to) > MAX_CUSTOM_SPAN_DAYS) {
    ctx.addIssue({
      code: 'custom',
      path: ['to'],
      message: `A custom range may span at most ${MAX_CUSTOM_SPAN_DAYS} days.`,
    });
  }
}
