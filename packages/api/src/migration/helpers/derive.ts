import type { PremiumSource } from '../../deals/schemas/deal.schema';
import type { LeadTemperature } from '@sfa/shared';
import { isCanonicalPolicyType, normalizePolicyType } from '@sfa/shared';
import { CONTACT_FIELDS } from '../smartsuite/field-ids';
import { allLinkedIds, selectCode, selectLabel, toNumber } from './value-utils';

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
 * Nothing is dropped: see {@link resolvePolicyType} for what an uncatalogued
 * choice becomes.
 */
export function policyTypeLabels(value: unknown): string[] {
  const labels = new Set<string>();
  const walk = (v: unknown) => {
    if (v === null || v === undefined) return;
    if (Array.isArray(v)) {
      v.forEach(walk);
      return;
    }
    // Deduped after resolving: `mCt4m` and `AiFB5` both mean "Landlord", and a
    // deal linking policies from both code sets would otherwise list it twice.
    const label = resolvePolicyType(v);
    if (label) labels.add(label);
  };
  walk(value);
  return [...labels];
}

/**
 * One SmartSuite policy-type choice → the value we store.
 *
 * 1. The **code**, through our alias map — the stable route, and the one every
 *    known choice takes.
 * 2. Failing that, the **hydrated label** SmartSuite sent beside the code, run
 *    through the same map (so "Manufactured Homes" still lands on our
 *    "Manufactured Home").
 * 3. Failing that, the label as SmartSuite wrote it; and only with no label at
 *    all, the raw code.
 *
 * Steps 2–3 are PAC-135. The import used to read the code alone and throw the
 * label away, so a choice added in SmartSuite after our map was written was
 * stored as `Tz3ny` when "Manufactured Homes" was sitting in the same payload —
 * 92 policies' worth. A readable name we have not catalogued beats an opaque
 * code we have not catalogued, and it tells whoever reads it what to add.
 */
export function resolvePolicyType(value: unknown): string {
  const byCode = normalizePolicyType(selectCode(value));
  if (isCanonicalPolicyType(byCode)) return byCode;

  const label = selectLabel(value)?.trim();
  if (!label) return byCode;

  const byLabel = normalizePolicyType(label);
  return isCanonicalPolicyType(byLabel) ? byLabel : label;
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

/** Which SmartSuite field a contact's household was resolved from. */
export type ContactHouseholdSource =
  'household' | 'primary-backlink' | 'member-backlink' | 'none';

export interface ContactHouseholdLinks {
  /** The one household the contact's `householdId` points at, if any. */
  householdLegacyId?: string;
  /** Every household the contact is linked to, primary-first, deduped. */
  memberLegacyIds: string[];
  /** Households this contact is named as the *primary* of. */
  primaryLegacyIds: string[];
  via: ContactHouseholdSource;
}

/**
 * Every household link a SmartSuite contact carries (PAC-91 §8).
 *
 * The importer used to read `CONTACT_FIELDS.household` and nothing else, which
 * found 1,060 of 3,064 real links: legacy wrote that field **only** from the
 * intake form, and everything linked from the household side lives in the two
 * server-side back-links instead.
 *
 * `via` mirrors legacy's own fallback order (`SFA/lib/intake/
 * resolveHousehold.ts` — writable field, then primary back-link, then member
 * back-link), so a contact resolves to the same household here as it did in the
 * app it is being migrated out of.
 *
 * `memberLegacyIds` is the **union** of all three rather than the first field
 * that answers, because a contact is genuinely a member of every household that
 * names them: 266 contacts in the 2026-09-04 export are a household's primary
 * without appearing in its member list, and 13 belong to more than one
 * household. Primary-first, so the head of the list is the household the
 * contact most plausibly "belongs to" when only one can be stored.
 */
export function resolveContactHousehold(
  rec: Record<string, unknown>,
): ContactHouseholdLinks {
  const direct = allLinkedIds(rec[CONTACT_FIELDS.household]);
  const primaryLegacyIds = allLinkedIds(
    rec[CONTACT_FIELDS.householdPrimaryBacklink],
  );
  const memberBacklink = allLinkedIds(
    rec[CONTACT_FIELDS.householdMemberBacklink],
  );

  const via: ContactHouseholdSource = direct.length
    ? 'household'
    : primaryLegacyIds.length
      ? 'primary-backlink'
      : memberBacklink.length
        ? 'member-backlink'
        : 'none';

  const householdLegacyId =
    direct[0] ?? primaryLegacyIds[0] ?? memberBacklink[0];

  return {
    householdLegacyId,
    memberLegacyIds: [
      ...new Set([...primaryLegacyIds, ...direct, ...memberBacklink]),
    ],
    primaryLegacyIds,
    via,
  };
}
