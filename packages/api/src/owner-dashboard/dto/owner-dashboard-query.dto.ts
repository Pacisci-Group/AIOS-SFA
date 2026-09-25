import {
  LEAD_SOURCE_NONE,
  OWNER_DASHBOARD_RANGE_KEYS,
  POLICY_TYPES,
} from '@sfa/shared';
import { z } from 'zod';
import { multiValue } from '../../leads/dto/multi-value';
import { refineCustomRange } from '../../performance/dto/custom-range.refine';

const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'must be a record id');

/**
 * Bounds on the multi-selects. Generous — no agency has fifty producers or
 * sources on one screen — and there so a hand-built URL cannot hand Mongo an
 * `$in` of arbitrary size.
 */
const MAX_SELECTED = 50;

/**
 * Query params for all three `GET /owner-dashboard/*` reads (PAC-135).
 *
 * **One schema on purpose.** The KPI row, the leaderboard and the lead-source
 * table promise to agree with each other, which is only true if they can never
 * be asked slightly different questions.
 *
 * Every multi-select accepts the repeated, comma-separated or single form
 * (`multiValue`), and an empty one means "no filter", never "match nothing".
 */
export const ownerDashboardQuerySchema = z
  .object({
    range: z.enum(OWNER_DASHBOARD_RANGE_KEYS).default('mtd'),
    /** `YYYY-MM-DD`, Chicago calendar dates. `to` is inclusive. */
    from: z.string().trim().optional(),
    to: z.string().trim().optional(),
    /** Narrows within the caller's data scope; can never widen it. */
    producerIds: z.preprocess(
      multiValue,
      z.array(objectId).max(MAX_SELECTED).optional(),
    ),
    /** `leadSources` row ids, and/or `LEAD_SOURCE_NONE` for "no source". */
    leadSourceIds: z.preprocess(
      multiValue,
      z
        .array(z.union([z.literal(LEAD_SOURCE_NONE), objectId]))
        .max(MAX_SELECTED)
        .optional(),
    ),
    /** Line of business = policy type, exactly the Sold form's dropdown. */
    policyTypes: z.preprocess(
      multiValue,
      z.array(z.enum(POLICY_TYPES)).max(POLICY_TYPES.length).optional(),
    ),
  })
  .superRefine(refineCustomRange);

export type OwnerDashboardQueryDto = z.infer<typeof ownerDashboardQuerySchema>;
