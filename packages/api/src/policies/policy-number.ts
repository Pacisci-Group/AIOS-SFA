/**
 * Policy-number normalization for the duplicate check (PAC-40).
 *
 * ⚠ The implementation now lives in `@sfa/shared` (`domain/policy-number.ts`),
 * because the Sold wizard has to apply the identical transform client-side to
 * validate a carrier's policy-number rule (PAC-56 #20) — and a normalizer with
 * two implementations is a normalizer with two behaviours.
 *
 * Re-exported rather than deleted: every existing API call site imports from
 * here, and the indirection is the natural place to say where the real one is.
 */
export {
  MIN_POLICY_NUMBER_KEY_LENGTH,
  normalizePolicyNumber,
  policyNumberKey,
} from '@sfa/shared';
