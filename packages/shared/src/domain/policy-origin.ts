/**
 * Where a policy came from, when it was not the agency's own sale (PAC-173).
 *
 * - `carrier_direct` — Allstate sold it directly (its 1-800 line or
 *   allstate.com) and assigned it to the agency to **service**. It has no deal
 *   and is never a sale: nothing is credited on performance or the
 *   leaderboard, which read deals. Set up from a Dash Reconciliation row
 *   ("Set up for service"), with a CSR onboarding opening on the welcome call.
 *
 * Absent means the agency's own business, which is every policy written before
 * this existed — the `businessType` `$ne` convention, so no migration.
 */
export const POLICY_ORIGINS = ['carrier_direct'] as const;
export type PolicyOrigin = (typeof POLICY_ORIGINS)[number];

export const POLICY_ORIGIN_LABELS: Record<PolicyOrigin, string> = {
  carrier_direct: 'Allstate direct (1-800)',
};

/** A stored value as a known origin, or `null` (the agency's own). */
export function policyOriginOf(value: unknown): PolicyOrigin | null {
  return (POLICY_ORIGINS as readonly unknown[]).includes(value)
    ? (value as PolicyOrigin)
    : null;
}
