import { LOGGABLE_ACTIVITY_TYPES } from '@sfa/shared';
import { z } from 'zod';

/**
 * Body for `POST /activities` (PAC-16).
 *
 * `type` is bounded by the **write** vocabulary, not the read one — see
 * `LOGGABLE_ACTIVITY_TYPES`. A client able to post `sold` could invent a sale
 * on the Sold scorecard, so the narrow enum here is a security boundary rather
 * than input tidiness.
 */
export const createActivitySchema = z
  .object({
    leadId: z.string().trim().min(1),
    type: z.enum(LOGGABLE_ACTIVITY_TYPES),
    summary: z.string().trim().min(1).max(500).optional(),
    /**
     * Backdating a touch that happened away from the app. Defaults to now.
     */
    occurredAt: z.coerce.date().optional(),
  })
  .superRefine((value, ctx) => {
    // A note *is* its text; a call/text/email is an event that stands alone and
    // gets a default summary.
    if (value.type === 'note' && !value.summary) {
      ctx.addIssue({
        code: 'custom',
        path: ['summary'],
        message: 'A note needs some text.',
      });
    }
  });

/** Inferred TypeScript type — single source of truth for the parsed body. */
export type CreateActivityDto = z.infer<typeof createActivitySchema>;
