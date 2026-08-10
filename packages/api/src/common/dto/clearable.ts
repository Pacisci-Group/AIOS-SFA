import { z } from 'zod';

/**
 * A field that can be cleared as well as set.
 *
 * `null` and "absent" are different requests — a producer blanking a mistyped
 * carrier is not the same as one who only touched the premium — so the schema
 * has to keep them distinguishable rather than collapsing both to `undefined`.
 * An empty string is treated as a clear, because that is what a cleared text
 * input actually sends.
 *
 * Lifted here from `policies/dto/update-policy.dto.ts` once a second edit
 * endpoint needed it (PAC-56 #11). The rule it encodes is a convention for
 * every `PATCH` in this API, so it belongs above any one feature.
 */
export function clearable<T extends z.ZodTypeAny>(inner: T) {
  return inner.nullable().optional();
}

/** Trimmed, length-capped text that reports an emptied input as `null`. */
export const trimmedText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value.length ? value : null));
