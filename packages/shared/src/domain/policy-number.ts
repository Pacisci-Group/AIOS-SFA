/**
 * Policy-number normalization (PAC-40, moved to `shared` by PAC-56 #20).
 *
 * Producers copy policy numbers off carrier portals, PDFs and phone calls, so
 * the same policy arrives as `ABC-123-456`, `abc123456` or `ABC 123 456`. The
 * dedupe check is worthless if those three do not collide, so both the stored
 * key (`Policy.policyNumberKey`) and the incoming query go through this — a
 * normalizer applied to only one side matches nothing.
 *
 * It lives in `shared` because there are now **three** consumers and they must
 * agree exactly: the duplicate check, the server-side carrier format rule, and
 * the wizard's live validation of the same rule. Two of those were already
 * hand-rolling the expression.
 */

/**
 * Below this length a "match" carries no information: two unrelated policies
 * numbered `12` and `12` tell a producer nothing, and warning about them
 * trains people to dismiss the warning. Short input is treated as "no opinion"
 * rather than as an error.
 */
export const MIN_POLICY_NUMBER_KEY_LENGTH = 4;

/**
 * Uppercase, non-alphanumerics stripped. **No length floor** — `''` for input
 * that contains nothing usable.
 *
 * The raw transform, separate from {@link normalizePolicyNumber} because two
 * callers need it *without* the floor:
 *
 * - **Carrier policy-number rules.** A pattern tested against `null` silently
 *   passes, so a short number would skip validation entirely.
 * - **The in-submission duplicate check**, where two policies numbered `123` in
 *   one submission are still a collision.
 *
 * Being stricter on write than on lookup is deliberate, not an inconsistency:
 * the floor exists to keep a *warning* meaningful.
 */
export function policyNumberKey(raw?: string | null): string {
  if (typeof raw !== 'string') return '';
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * `null` when the input cannot produce a usable key — blank, or fewer than
 * {@link MIN_POLICY_NUMBER_KEY_LENGTH} alphanumeric characters.
 */
export function normalizePolicyNumber(raw?: string | null): string | null {
  const key = policyNumberKey(raw);
  return key.length >= MIN_POLICY_NUMBER_KEY_LENGTH ? key : null;
}
