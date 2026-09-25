import { POLICY_REPLACEMENT_REASONS } from '@sfa/shared';
import { z } from 'zod';

/**
 * `GET /leads/for-replacement?policyId=&reason=` — where a replacement starts.
 *
 * Both parameters are required, and `reason` deliberately has no default. A
 * policy could in principle be queued for a rewrite *and* a transfer, and the
 * two apply different money rules — one charges the full premium back, the other
 * moves a client within their own book and charges nothing. Resuming one into
 * the other would be silently wrong in a way nobody would catch until a
 * producer's payslip. Making the caller say which it means costs a query
 * parameter; guessing is not recoverable.
 */
export const replacementLeadQuerySchema = z.object({
  policyId: z
    .string()
    .trim()
    .regex(/^[a-f0-9]{24}$/i, 'policyId must be a record id'),
  reason: z.enum(POLICY_REPLACEMENT_REASONS),
});

export type ReplacementLeadQueryDto = z.infer<
  typeof replacementLeadQuerySchema
>;
