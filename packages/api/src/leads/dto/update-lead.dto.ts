import {
  LEAD_SOURCE_NONE,
  LEAD_STATUSES,
  LEAD_TEMPERATURE_OPTIONS,
  SELECTABLE_LEAD_SOURCE_OPTIONS,
} from '@sfa/shared';
import type { LeadTemperature } from '@sfa/shared';
import { z } from 'zod';

/**
 * `Test` (ENEJP) is excluded for the same reason as `create-lead.dto.ts`: the
 * `isTestRecord` heuristic hides any record it flags from every read path, so
 * letting a producer select it would silently make a real lead disappear.
 *
 * `LEAD_SOURCE_NONE` is accepted alongside the codes so a source can be
 * *cleared* as well as set — a mis-attributed lead has to be correctable back
 * to "not known yet", not just to a different wrong answer.
 */
const LEAD_SOURCE_VALUES: [string, ...string[]] = [
  LEAD_SOURCE_NONE,
  ...SELECTABLE_LEAD_SOURCE_OPTIONS.map((option) => option.code),
];

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
     * A **code**, not a label — the same vocabulary `POST /leads` takes, so the
     * two write paths cannot disagree about what a source is.
     *
     * This control exists because PAC-37 share-link leads arrive with no source
     * at all; without it those leads could never be corrected.
     */
    leadSourceCode: z.enum(LEAD_SOURCE_VALUES).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update.',
  });

export type UpdateLeadDto = z.infer<typeof updateLeadSchema>;
