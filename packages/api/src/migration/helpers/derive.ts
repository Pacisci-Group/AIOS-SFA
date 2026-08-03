import type { PremiumSource } from '../../deals/schemas/deal.schema';
import type { LeadTemperature } from '@sfa/shared';
import { normalizePolicyType } from '@sfa/shared';
import { selectCode, toNumber } from './value-utils';

// Moved to `common/domain/` so the live Sold write path does not import the
// migration module. Re-exported here so existing call sites keep working.
export { daysSince, deriveDealType } from '../../common/domain/deal-derive';

/**
 * Effective premium: prefer the rollup (s0675d21ce), fall back to the snapshot
 * (total_premium_snapshot). Mirrors the legacy leaderboard behaviour.
 */
export function resolvePremium(
  rollup: unknown,
  snapshot: unknown,
): { premium: number; source: PremiumSource } {
  const roll = toNumber(rollup);
  if (roll > 0) return { premium: roll, source: 'rollup' };
  const snap = toNumber(snapshot);
  if (snap > 0) return { premium: snap, source: 'snapshot' };
  return { premium: 0, source: 'none' };
}

/**
 * Normalize the "Policy Type(s)" lookup (array of choice codes, possibly nested)
 * into canonical line-of-business labels.
 *
 * Resolved through `normalizePolicyType` from `@sfa/shared` rather than the
 * migration-local `POLICY_TYPE_LABELS` map (PAC-40). That map emitted
 * "Landlords" for `mCt4m` while the shared vocabulary — and therefore every
 * read path and the Sold form — says "Landlord". The Sold form's audit
 * generator resolves template titles by **exact** name (`Landlord Inspection`,
 * `Landlord Mortgagee`, …), so one stray plural silently produces a deal with
 * no landlord audit items at all.
 *
 * Uncatalogued codes still pass through verbatim, so nothing is dropped.
 */
export function policyTypeLabels(value: unknown): string[] {
  const codes = new Set<string>();
  const walk = (v: unknown) => {
    if (v === null || v === undefined) return;
    if (Array.isArray(v)) {
      v.forEach(walk);
      return;
    }
    const code = selectCode(v);
    if (code) codes.add(code);
  };
  walk(value);
  // Deduped again after normalizing: `mCt4m` and `AiFB5` both mean "Landlord",
  // and a deal linking policies from both code sets would otherwise list it twice.
  return [...new Set([...codes].map((c) => normalizePolicyType(c)))];
}

const TEMPERATURES: Record<string, LeadTemperature> = {
  hot: 'Hot',
  warm: 'Warm',
  cold: 'Cold',
};

export function normalizeTemperature(value: unknown): LeadTemperature {
  const code = selectCode(value);
  if (!code) return 'Unknown';
  return TEMPERATURES[code.toLowerCase()] ?? 'Unknown';
}
