import { z } from 'zod';
import { multiValue } from '../../leads/dto/multi-value';

/** The three states a row's Status badge can show. */
export const AGENCY_USER_STATUSES = [
  'active',
  'invited',
  'deactivated',
] as const;
export type AgencyUserStatus = (typeof AGENCY_USER_STATUSES)[number];

/**
 * Query for the agency directory (PAC-101).
 *
 * Shaped like `list-platform-users.dto.ts`, deliberately: the two screens
 * render nearly the same row and a caller moving between them should not have
 * to learn a second parameter vocabulary.
 *
 * This endpoint took **no** query at all until PAC-101 — it returned the whole
 * roster and the page filtered it in the browser over three of its five
 * columns. That was a documented decision ("an agency is tens of people"), and
 * it is being reversed rather than worked around: the ticket's rule is that
 * search runs on the backend over every record, and a client-side filter
 * cannot be made to satisfy it as the roster grows.
 */
export const listAgencyUsersSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),

  /** Free text: name, email, role name, and branch name. */
  q: z.string().trim().max(120).optional(),

  /**
   * Multi-select, ORed — the Status column as a facet.
   *
   * A facet rather than searchable text because the value is **derived**, not
   * stored: it comes from `isActive` + `deactivatedAt`. Substring-matching a
   * label that does not exist in the database would need an `$expr`/`$switch`
   * in the `$or`, and it would make `act` match both "active" and
   * "deactivated" — worse than useless. Same treatment `Leads` gives `status`
   * and `temperature`.
   */
  status: z.preprocess(
    multiValue,
    z
      .array(z.enum(AGENCY_USER_STATUSES))
      .max(AGENCY_USER_STATUSES.length)
      .optional(),
  ),
});

/** Inferred TypeScript type — single source of truth for the parsed query. */
export type ListAgencyUsersDto = z.infer<typeof listAgencyUsersSchema>;
