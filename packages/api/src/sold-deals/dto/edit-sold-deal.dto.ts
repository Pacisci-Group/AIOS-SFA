import { z } from 'zod';
import {
  refinePolicyBatch,
  soldPolicySchema,
  ymd,
} from './create-sold-deal.dto';

/**
 * `PATCH /sold-deals/:id` — correct a booked deal's sold date (PAC-104).
 *
 * The create form's own `ymd` rule, so the two paths cannot disagree about what
 * a sold date is. The deal id is checked in the service, which 404s rather than
 * letting Mongoose throw on a malformed one.
 */
export const updateSoldDealSchema = z.object({ soldDate: ymd });

export type UpdateSoldDealDto = z.infer<typeof updateSoldDealSchema>;

/**
 * `POST /sold-deals/:id/policies` — add policies to a booked deal (PAC-104).
 *
 * The Sold form's policy row verbatim, with its whole-batch rules. What the
 * batch rules cannot see — policies the deal **already** holds — is checked in
 * the service against the stored rows.
 */
export const addSoldDealPoliciesSchema = z
  .object({
    policies: z
      .array(soldPolicySchema)
      .min(1, 'Add at least one policy')
      .max(10, 'At most 10 policies per submission'),
    /**
     * Required, unlike on create. An addition has no natural key — the deal
     * already exists — so a double-click without one would add the policy twice
     * and double its premium on the Sold scorecard.
     */
    submissionToken: z.string().trim().min(8).max(200),
  })
  .superRefine(refinePolicyBatch);

export type AddSoldDealPoliciesDto = z.infer<typeof addSoldDealPoliciesSchema>;
