import { z } from 'zod';
import {
  policyBaseSchema,
  refineEscrow,
  refinePolicyBatch,
} from '../../sold-deals/dto/create-sold-deal.dto';

/** A 24-char hex ObjectId. Mongoose would throw a 500 on anything else. */
const objectId = z
  .string()
  .trim()
  .length(24, 'Invalid id')
  .regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

/** `YYYY-MM-DD`, the shape an `<input type="date">` submits. */
const ymd = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

/**
 * One policy being replaced by another.
 *
 * Built from `policyBaseSchema` rather than copied from `soldPolicySchema`, so
 * the two write paths cannot drift on what a policy row requires — carrier,
 * policy number, premium, item count, the signed application and the discount
 * block are validated identically.
 *
 * The two differences are the whole feature:
 *   - **`fromPolicyId` is required.** A transfer that names no policy to replace
 *     is just a sale, and would be booked as company transfer while quietly
 *     adding a policy — the one outcome this must not allow.
 *   - **No prior insurance or cancellation.** The policy being replaced is
 *     already in our own book; there is no other carrier to name and nothing to
 *     cancel. The service injects the wire-legal `{ none: true }` /
 *     `{ cancelled: false }` shape before the intake steps see the row.
 */
const transferPolicySchema = policyBaseSchema
  .extend({ fromPolicyId: objectId })
  .superRefine(refineEscrow);

export const createPolicyTransferSchema = z
  .object({
    /**
     * When the transfer happened — the reporting date, distinct from each
     * policy's `effectiveDate`.
     *
     * Separate for the same reason the Sold form separates `soldDate` from
     * `effectiveDate`: a policy can take effect next month, and the Transfers
     * scorecard must not book the premium into a future period because of it.
     */
    transferDate: ymd,
    policies: z
      .array(transferPolicySchema)
      .min(1, 'Add at least one policy')
      .max(10, 'At most 10 policies per submission'),
    submissionToken: z.string().trim().min(8).max(200).optional(),
  })
  // Cross-branch discounts and in-submission duplicate policy numbers are traps
  // on any looping policy form, not just the sold one.
  .superRefine(refinePolicyBatch);

export type CreatePolicyTransferDto = z.infer<
  typeof createPolicyTransferSchema
>;
