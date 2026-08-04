/**
 * Policy-number normalization for the duplicate check (PAC-40).
 *
 * Producers copy policy numbers off carrier portals, PDFs and phone calls, so
 * the same policy arrives as `ABC-123-456`, `abc123456` or `ABC 123 456`. The
 * dedupe check is worthless if those three do not collide, so both the stored
 * key (`Policy.policyNumberKey`) and the incoming query go through this — a
 * normalizer applied to only one side matches nothing.
 */

/**
 * Below this length a "match" carries no information: two unrelated policies
 * numbered `12` and `12` tell a producer nothing, and warning about them
 * trains people to dismiss the warning. Short input is treated as "no opinion"
 * rather than as an error.
 */
export const MIN_POLICY_NUMBER_KEY_LENGTH = 4;

/**
 * `null` when the input cannot produce a usable key — blank, or fewer than
 * {@link MIN_POLICY_NUMBER_KEY_LENGTH} alphanumeric characters.
 */
export function normalizePolicyNumber(raw?: string | null): string | null {
  if (typeof raw !== 'string') return null;

  const key = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return key.length >= MIN_POLICY_NUMBER_KEY_LENGTH ? key : null;
}
