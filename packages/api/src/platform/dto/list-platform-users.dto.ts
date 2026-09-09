import { z } from 'zod';
import { multiValue } from '../../leads/dto/multi-value';

const OBJECT_ID = /^[a-f0-9]{24}$/i;

/**
 * Query for the cross-agency user directory (PAC-70).
 *
 * Multi-value filters accept the three forms `multiValue` normalizes (repeated,
 * comma-separated, single). An absent or empty filter reaches the service as
 * `undefined` — *no filter* — never as an empty `$in`.
 */
export const listPlatformUsersSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  /** Free text: first name, last name, `first last`, email, agency name, role name. */
  q: z.string().trim().max(120).optional(),
  /**
   * Multi-select, ORed. Shape-checked here so a malformed id is a `400`, not a
   * Mongoose `CastError` surfacing as a 500.
   */
  agencyIds: z.preprocess(
    multiValue,
    z
      .array(z.string().regex(OBJECT_ID, 'agencyIds must be record ids'))
      .max(50)
      .optional(),
  ),
  /**
   * Multi-select, ORed. Slugs, not ids: `producer` has a different id in every
   * agency but one slug, and a user holding *any* selected role matches.
   */
  roleSlugs: z.preprocess(
    multiValue,
    z.array(z.string().trim().max(60)).max(20).optional(),
  ),
});

/** Inferred TypeScript type — single source of truth for the parsed query. */
export type ListPlatformUsersDto = z.infer<typeof listPlatformUsersSchema>;
