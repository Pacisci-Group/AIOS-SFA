import { USER_AVAILABILITIES } from '@sfa/shared';
import { z } from 'zod';
import { multiValue } from '../../leads/dto/multi-value';

/**
 * Optional narrowing for `GET /users/options` (PAC-144).
 *
 * Both filters are opt-in, because the endpoint's default — everyone active in
 * the agency — is what the audit, ticket and CRM pickers want. Only the
 * Command Center's lead picker asks for less: producers who are taking leads.
 */
export const listUserOptionsSchema = z.object({
  /**
   * A role **slug**, never a display name — an agency can rename its roles,
   * but the slug is what code keys on (see `PRODUCER_ROLE_SLUG` in the
   * management dashboard, which defines its roster the same way).
   */
  role: z
    .string()
    .trim()
    .regex(/^[a-z0-9_-]+$/)
    .max(60)
    .optional(),

  /** Multi-select, ORed. */
  availability: z.preprocess(
    multiValue,
    z
      .array(z.enum(USER_AVAILABILITIES))
      .max(USER_AVAILABILITIES.length)
      .optional(),
  ),
});

/** Inferred TypeScript type — single source of truth for the parsed query. */
export type ListUserOptionsDto = z.infer<typeof listUserOptionsSchema>;
