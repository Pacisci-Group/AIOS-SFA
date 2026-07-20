import type { DealType, PremiumSource } from '../../deals/schemas/deal.schema';
import type { LeadTemperature } from '../../leads/schemas/lead.schema';
import { POLICY_TYPE_LABELS } from '../smartsuite/field-ids';
import { selectCode, toNumber } from './value-utils';

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
 * into readable line-of-business labels.
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
  return [...codes].map((c) => POLICY_TYPE_LABELS[c] ?? c);
}

/**
 * Deal type (Auto / Home / Bundle / Other) — not first-class in SmartSuite, so derived:
 *   - Bundle flag set OR both an auto-like and home-like line present -> Bundle
 *   - only auto-like -> Auto
 *   - only home-like -> Home
 *   - otherwise -> Other
 */
export function deriveDealType(
  isBundle: boolean,
  policyLabels: string[],
): DealType {
  const labels = policyLabels.map((l) => l.toLowerCase());
  const hasAuto = labels.some(
    (l) => l.includes('auto') || l.includes('motorcycle'),
  );
  const hasHome = labels.some(
    (l) =>
      l.includes('home') ||
      l.includes('renter') ||
      l.includes('landlord') ||
      l.includes('condo') ||
      l.includes('dwelling'),
  );

  if (isBundle || (hasAuto && hasHome)) return 'Bundle';
  if (hasAuto) return 'Auto';
  if (hasHome) return 'Home';
  return 'Other';
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

/** Whole days between a start date and now (>= 0). */
export function daysSince(date: Date | undefined, now = new Date()): number {
  if (!date) return 0;
  const diff = now.getTime() - date.getTime();
  if (diff <= 0) return 0;
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}
