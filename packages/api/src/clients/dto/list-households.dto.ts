import { HOUSEHOLD_STATUSES } from '@sfa/shared';
import { z } from 'zod';
import { multiValue } from '../../leads/dto/multi-value';

/**
 * Query params for `GET /households` — the Clients list page.
 *
 * Shaped like `list-leads.dto.ts`: values arrive as strings, so everything is
 * coerced, bounded and defaulted here rather than in the service. `page` is
 * 1-based and `pageSize` is capped so a client cannot ask for the whole book.
 *
 * Two kinds of search live side by side, and they compose differently:
 *
 * - `q` is the omni box. It is **shape-routed** (see `routeSearchTerm`) and
 *   ORs across households, their members and their policies.
 * - The five explicit fields are the advanced panel. They **AND** together, for
 *   a caller who knows exactly which identifier they are holding.
 *
 * Both may be sent at once; the service intersects them.
 */
/**
 * A trimmed optional string where **blank means absent**.
 *
 * `?firstName=` is what a cleared input sends, and it has to reach the service
 * as `undefined`, not `''`. Left as an empty string it reads as a supplied
 * filter that every contact satisfies, so clearing one field would quietly
 * return the first 500 households in the agency as if they had all matched.
 */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => value || undefined);

export const listHouseholdsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),

  /** Free-text omni search. Blank or absent lists the first page unfiltered. */
  q: optionalText(120),

  firstName: optionalText(80),
  lastName: optionalText(80),

  /**
   * `YYYY-MM-DD`. Validated by shape here so a malformed date is a 400 rather
   * than a silently empty result set; the service parses it to UTC midnight.
   *
   * Blank is stripped *before* the pattern runs, not after — a cleared date
   * input is an absent filter, and 400-ing on `?dateOfBirth=` while every other
   * field quietly drops it would be a trap for exactly one caller.
   */
  dateOfBirth: z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim() === '' ? undefined : value,
    z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'dateOfBirth must be YYYY-MM-DD')
      .optional(),
  ),

  /** `HH-2614`, `#HH2614` or the bare number — `parseHouseholdRef` takes all three. */
  householdRef: optionalText(20),

  policyNumber: optionalText(40),

  /** Canonical status labels; several are ORed. Raw codes are matched too. */
  status: z.preprocess(
    multiValue,
    z
      .array(z.enum(HOUSEHOLD_STATUSES))
      .max(HOUSEHOLD_STATUSES.length)
      .optional(),
  ),

  sort: z.enum(['name', 'policies', 'updated']).default('name'),
});

/** Inferred type — single source of truth for the parsed query. */
export type ListHouseholdsDto = z.infer<typeof listHouseholdsSchema>;
