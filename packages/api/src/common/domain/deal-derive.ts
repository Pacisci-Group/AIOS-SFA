import type { DealType } from '../../deals/schemas/deal.schema';

/**
 * Deal-shape derivations shared by the migration, the demo seed and the Sold
 * write path (PAC-40).
 *
 * These lived in `migration/helpers/derive.ts`, which made the live
 * `POST /sold-deals` request path depend on the migration module. They are
 * re-exported from there so existing imports keep working.
 *
 * Sharing one implementation is the point: `deals.dealType`, `premium` and
 * `itemCount` back the Sold scorecard (PAC-11), so an app-created deal and a
 * migrated one must be derived identically or the scorecard drifts.
 */

/**
 * Deal type (Auto / Home / Bundle / Other) — not first-class in SmartSuite, so derived:
 *   - Bundle flag set OR both an auto-like and home-like line present -> Bundle
 *   - only auto-like -> Auto
 *   - only home-like -> Home
 *   - otherwise -> Other
 *
 * Deliberately substring-matched rather than using `isAutoPolicyType` /
 * `isPropertyPolicyType` from `@sfa/shared`. Those answer only for catalogued
 * types, while this runs over whatever labels the migration produced —
 * including uncatalogued ones like "Dwelling Fire" that pass through
 * `policyTypeLabels` verbatim. Narrowing it would silently re-bucket migrated
 * deals as `Other` and move the scorecard.
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

/** Whole days between a start date and now (>= 0). */
export function daysSince(date: Date | undefined, now = new Date()): number {
  if (!date) return 0;
  const diff = now.getTime() - date.getTime();
  if (diff <= 0) return 0;
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}
