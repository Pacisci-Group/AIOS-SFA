/**
 * Normalize a multi-value query param.
 *
 * The same filter may arrive as a single value (`status=New`), repeated
 * (`status=New&status=Sold`) or comma-separated (`status=New,Sold`) — all three
 * collapse to a deduped, trimmed array.
 *
 * An empty result becomes `undefined` rather than `[]`, so "the user cleared the
 * filter" reaches the service as *no filter* instead of an empty `$in` (which
 * would match nothing).
 *
 * Extracted from `list-leads.dto.ts` when `list-hot-leads.dto.ts` became its
 * second caller.
 */
export function multiValue(raw: unknown): unknown {
  if (raw == null) return undefined;
  const values = (Array.isArray(raw) ? raw : [raw])
    .filter((value): value is string => typeof value === 'string')
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean);
  return values.length > 0 ? [...new Set(values)] : undefined;
}
