import { POLICY_TYPES } from '@sfa/shared';
import { z } from 'zod';

/**
 * Query params for `GET /policies/check`.
 *
 * `number` is intentionally permissive — it is a *lookup*, not a write, so the
 * only job here is to bound the input. Anything that normalizes to fewer than
 * four alphanumerics returns an empty result rather than a 400: the wizard
 * fires this as the producer leaves the field, and a validation error on a
 * half-typed number would be noise, not help.
 */
export const checkPolicySchema = z.object({
  number: z.string().trim().min(1, 'Enter a policy number').max(60, 'Too long'),
  /**
   * Optional narrowing. A carrier can legitimately reuse a number across lines
   * of business, so when the wizard already knows the type it is entering, it
   * passes it to suppress matches that cannot be the same policy.
   */
  policyType: z.enum(POLICY_TYPES).optional(),
});

export type CheckPolicyDto = z.infer<typeof checkPolicySchema>;
