import {
  LEAD_SOURCE_NONE,
  LEAD_STATUSES,
  LEAD_TEMPERATURE_OPTIONS,
} from '@sfa/shared';
import type { LeadTemperature } from '@sfa/shared';
import { z } from 'zod';
import { leadSourceIdField } from './create-lead.dto';

/**
 * `PATCH /leads/:id` — the Lead Detail inline edits (PAC-38).
 *
 * Every field is optional and the object must not be empty, which is what makes
 * this a patch rather than a replace: the Select controls each fire one field.
 */
export const updateLeadSchema = z
  .object({
    /** A canonical label. Raw SmartSuite codes are rejected on write even though
     *  `normalizeLeadStatus` still accepts them on read — that is how the
     *  migrated mix converges instead of growing. */
    status: z.enum(LEAD_STATUSES).optional(),
    /**
     * `Unknown` is deliberately absent: it is the display state of a lead nobody
     * has assessed, not something a producer chooses. Mirrors
     * `LEAD_TEMPERATURE_OPTIONS`, which excludes it for the same reason.
     */
    temperature: z
      .enum(LEAD_TEMPERATURE_OPTIONS as [LeadTemperature, ...LeadTemperature[]])
      .optional(),
    /**
     * A `leadSources` row id — the same thing `POST /leads` takes, so the two
     * write paths cannot disagree about what a source is — or
     * `LEAD_SOURCE_NONE` to **clear** it: a mis-attributed lead has to be
     * correctable back to "not known yet", not just to a different wrong answer.
     *
     * This control exists because PAC-37 share-link leads arrive with no source
     * at all; without it those leads could never be corrected.
     */
    leadSourceId: z
      .union([z.literal(LEAD_SOURCE_NONE), leadSourceIdField])
      .optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update.',
  });

export type UpdateLeadDto = z.infer<typeof updateLeadSchema>;
