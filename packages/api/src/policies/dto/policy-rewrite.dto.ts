import { z } from 'zod';
import {
  policyBaseSchema,
  refineEscrow,
  refinePolicyBatch,
} from '../../sold-deals/dto/create-sold-deal.dto';

/** `YYYY-MM-DD`, the shape an `<input type="date">` submits. */
const ymd = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

/**
 * One replacement policy on a Cancel Rewrite.
 *
 * Built from `policyBaseSchema` for the same reason the transfer's row is —
 * carrier, policy number, premium, item count, the signed application and the
 * discount block are validated identically on every path that writes a policy,
 * so the three cannot drift.
 *
 * **No `fromPolicyId` here, unlike the transfer.** The policy being cancelled is
 * the URL (`POST /policies/:id/rewrite`), not a field in the body: a rewrite is
 * anchored on exactly one policy, and letting the body name a second one would
 * make it possible to cancel policy A while addressing the request to B. The
 * service injects `fromPolicyId` onto the first row before the intake steps run.
 *
 * No prior insurance or cancellation block either, again as on the transfer —
 * the policy being replaced is already in our own book, so there is no other
 * carrier to name and nothing to cancel.
 */
const rewritePolicySchema = policyBaseSchema.superRefine(refineEscrow);

export const createPolicyRewriteSchema = z
  .object({
    /**
     * When the cancellation happened — the date the one-month clawback window is
     * judged against, and the replacement deal's sold date.
     *
     * Separate from each policy's `effectiveDate` for the reason the Sold form
     * separates `soldDate`: the replacement can take effect next month, and
     * neither the window nor the scorecard period should move because of it.
     *
     * Client-supplied rather than `new Date()` so a cancellation processed on
     * Monday for a policy the carrier killed on Friday is recorded on Friday.
     * `PolicyRewritesService` clamps it — see `resolveCancelledAt`.
     */
    cancelledAt: ymd,
    /**
     * The replacement policies. At least one, which is the invariant the whole
     * feature rests on: a policy cannot be Cancel Rewrite without a replacement,
     * so there is no request shape that cancels without writing one.
     */
    policies: z
      .array(rewritePolicySchema)
      .min(1, 'Add at least one replacement policy')
      .max(10, 'At most 10 policies per submission'),
    submissionToken: z.string().trim().min(8).max(200).optional(),
  })
  // Cross-branch discounts and in-submission duplicate policy numbers are traps
  // on any looping policy form, not just the sold one.
  .superRefine(refinePolicyBatch);

export type CreatePolicyRewriteDto = z.infer<typeof createPolicyRewriteSchema>;
