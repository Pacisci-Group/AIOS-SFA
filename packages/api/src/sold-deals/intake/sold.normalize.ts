import {
  AUTO_DISCOUNT_KEYS,
  PROPERTY_DISCOUNT_KEYS,
  isAutoPolicyType,
  isDiscountSelected,
  isPropertyPolicyType,
  normalizePolicyType,
} from '@sfa/shared';
import type {
  NormalizedLeadSource,
  SoldDocumentMeta,
  SoldPolicyDiscounts,
  SoldPolicyInput,
} from '@sfa/shared';
import { deriveDealType } from '../../common/domain/deal-derive';
import { sumCents } from '../../common/domain/money';
import type {
  DealAuditTriggers,
  DealType,
} from '../../deals/schemas/deal.schema';
import { emptyAuditTriggers } from '../../deals/schemas/deal.schema';
import type { SoldUploadKind } from '../dto/presign-sold-document.dto';

/**
 * Pure derivations for the Sold write path (PAC-40).
 *
 * No Mongoose, no I/O — everything here is a function of the submitted policy
 * array, so the rules that back the Sold scorecard can be unit-tested directly.
 *
 * Every total is computed here rather than accepted from the client. Legacy
 * never had to: SmartSuite maintained `Total Premium`, `Total Items` and
 * `Policy Count` as rollups over linked policy rows. Mongo has no rollup
 * engine, so these become explicitly persisted fields — and a client-supplied
 * total would silently corrupt the Sold scorecard (PAC-11).
 */

/** `SOLD|<UPPERCASED>`, matching the `WEB|` namespacing lead intake established. */
export function buildSoldSubmissionToken(raw?: string | null): string | null {
  const token = raw?.trim();
  return token ? `SOLD|${token.toUpperCase()}` : null;
}

/** `YYYY-MM-DD` → the `YYYYMMDD` integer the sold-date range filters use. */
export function soldDateYmd(isoDate: string): number | undefined {
  const digits = isoDate.slice(0, 10).replace(/-/g, '');
  const value = Number(digits);
  return Number.isNaN(value) ? undefined : value;
}

/**
 * Parse a `YYYY-MM-DD` form date as **UTC midnight**.
 *
 * `new Date('2026-01-15')` is already UTC, but `new Date(2026, 0, 15)` is local
 * — mixing them puts sold dates a few hours either side of midnight, which
 * moves a deal between days in `soldDateYmd` and therefore between buckets on
 * the scorecard. Being explicit keeps the two representations consistent.
 */
export function parseFormDate(isoDate: string): Date {
  return new Date(`${isoDate.slice(0, 10)}T00:00:00.000Z`);
}

export interface DealAggregates {
  premium: number;
  itemCount: number;
  policyCount: number;
  policyTypes: string[];
  isBundle: boolean;
  dealType: DealType;
  soldDate: Date;
  soldDateYmd?: number;
}

/**
 * Roll the policy array up into the deal-level totals.
 *
 * `isBundle` is auto + property on the same deal, which is also what
 * `deriveDealType` keys `Bundle` off — computed here rather than taken from a
 * flag because legacy's `Bundle` boolean was set by hand and frequently wasn't.
 */
export function deriveDealAggregates(
  policies: SoldPolicyInput[],
  soldDate: string,
): DealAggregates {
  const policyTypes = [
    ...new Set(policies.map((p) => normalizePolicyType(p.policyType))),
  ].sort();

  const hasAuto = policyTypes.some(isAutoPolicyType);
  const hasProperty = policyTypes.some(isPropertyPolicyType);
  const isBundle = hasAuto && hasProperty;

  return {
    premium: sumCents(policies.map((p) => p.premium)),
    itemCount: policies.reduce((sum, p) => sum + p.itemCount, 0),
    policyCount: policies.length,
    policyTypes,
    isBundle,
    dealType: deriveDealType(isBundle, policyTypes),
    soldDate: parseFormDate(soldDate),
    soldDateYmd: soldDateYmd(soldDate),
  };
}

/** What {@link derivePersistedDealAggregates} can recompute from stored rows. */
export type PersistedDealAggregates = Pick<
  DealAggregates,
  | 'premium'
  | 'itemCount'
  | 'policyCount'
  | 'policyTypes'
  | 'isBundle'
  | 'dealType'
>;

/** The stored `Policy` fields the recompute reads. All optional on old rows. */
export interface PersistedPolicyTotals {
  policyType?: string;
  premium?: number;
  /** Note: `items` on the stored document, `itemCount` on the wire. */
  items?: number;
}

/**
 * Recompute a deal's roll-ups from the policies **already in Mongo** (PAC-56 #25).
 *
 * The counterpart to {@link deriveDealAggregates}, which folds the submission
 * DTO. `PATCH /policies/:id` has no DTO to fold — it corrects one stored row
 * and the deal's totals then disagree with the rows the user is looking at.
 *
 * Three differences from the DTO version, each a real trap:
 *   - the stored field is `items`, not `itemCount`;
 *   - a migrated `policyType` may be a raw SmartSuite code, so it goes through
 *     `normalizePolicyType` (the DTO version's input is already canonical);
 *   - everything is optional, because migrated rows are.
 *
 * ⚠ **`soldDate` / `soldDateYmd` are deliberately absent.** `soldDateYmd` is
 * the Sold scorecard's indexed bucket key; correcting a premium must not move
 * the deal between reporting days.
 */
export function derivePersistedDealAggregates(
  policies: PersistedPolicyTotals[],
): PersistedDealAggregates {
  const policyTypes = [
    ...new Set(
      policies.map((p) => normalizePolicyType(p.policyType)).filter(Boolean),
    ),
  ].sort();

  const isBundle =
    policyTypes.some(isAutoPolicyType) &&
    policyTypes.some(isPropertyPolicyType);

  return {
    premium: sumCents(policies.map((p) => p.premium ?? 0)),
    itemCount: policies.reduce((sum, p) => sum + (p.items ?? 0), 0),
    policyCount: policies.length,
    policyTypes,
    isBundle,
    dealType: deriveDealType(isBundle, policyTypes),
  };
}

/**
 * OR every policy's discount selections into the deal-level flags audit
 * generation reads.
 *
 * Legacy kept these booleans directly on the Deal and its generator re-read
 * them from there, so the union is the shape the ported algorithm expects. The
 * per-policy record survives on `Policy.discounts` for provenance.
 *
 * Names follow the **audit template titles** they resolve to, not the form
 * controls that set them — `roofReceipt` becomes `Hail Resistant Roof` and
 * `studentDiscount` becomes `Good Student`.
 */
export function deriveAuditTriggers(
  policies: SoldPolicyInput[],
): DealAuditTriggers {
  const triggers = emptyAuditTriggers();
  const driverNames = new Set<string>();

  for (const policy of policies) {
    const d = policy.discounts;
    if (!d) continue;

    triggers.fireSubscription ||= d.fireSubscription?.selected === true;
    triggers.hailResistantRoof ||= d.roofReceipt?.selected === true;
    triggers.actualCashValue ||=
      d.acvPersonalProperty === true || d.acvDwellingProtection === true;

    // Still recorded, but `computeRequiredTitles` no longer generates an item
    // from it (PAC-65) — Drivewise is provenance only.
    triggers.drivewise ||= d.drivewise === true;
    triggers.goodStudent ||= d.studentDiscount?.selected === true;
    triggers.defensiveDriver ||= d.defensiveDriver?.selected === true;

    if (d.defensiveDriver?.selected) {
      for (const driver of d.defensiveDriver.drivers ?? []) {
        const name = driver.name?.trim();
        // Deduped: the same driver named on both the auto and the motorcycle
        // policy needs one certificate, not two identical audit items.
        if (name) driverNames.add(name);
      }
    }
  }

  triggers.defensiveDriverNames = [...driverNames];
  return triggers;
}

/** Escrow on any policy implies a mortgagee on the deal. */
export function deriveMortgagee(policies: SoldPolicyInput[]): boolean {
  return policies.some((p) => p.discounts?.escrow === true);
}

/**
 * Every uploaded document on a policy row, with what kind it is.
 *
 * ⚠ **This function is a security boundary.** `SoldDealsService.verifyAttachments`
 * is the only place `assertKeyOwnership` runs on a sold upload, and it iterates
 * exactly what this returns — so a file-carrying field missed here is a key the
 * server never checks belongs to this agency and lead. It walked three hard-coded
 * discounts before PAC-56 #21; PAC-65 then removed the escrow statement and the
 * inspection and Drivewise proofs, leaving four places a document can hang.
 *
 * Structured as one pass over a **derived** list rather than a literal so that
 * adding a proof-backed discount cannot forget it: the discount keys come from
 * the object itself.
 *
 * Returns the **live objects**, not copies, so the caller can stamp each with
 * the size and content type storage actually reports.
 */
export function collectAttachments(
  policies: SoldPolicyInput[],
): SoldAttachmentRef[] {
  const found: SoldAttachmentRef[] = [];
  const add = (
    attachment: SoldDocumentMeta | undefined,
    kind: SoldUploadKind = 'discount_proof',
  ) => {
    if (attachment) found.push({ attachment, kind });
  };

  for (const policy of policies) {
    // Its own kind: PDF-only, and under a distinct key prefix (PAC-56 #23).
    add(policy.newBusinessApplication, 'new_business_application');

    const d = policy.discounts;
    if (!d) continue;

    // Every proof-backed discount, found structurally: anything shaped
    // `{ selected, attachment? }` qualifies, so a new one is covered the day it
    // is added rather than the day someone remembers to list it here.
    for (const value of Object.values(d)) {
      if (isProofBacked(value)) add(value.attachment);
    }

    for (const driver of d.defensiveDriver?.drivers ?? []) {
      add(driver.attachment);
    }
  }

  return found;
}

/** One document to verify, and which allow-list applies to it. */
export interface SoldAttachmentRef {
  attachment: SoldDocumentMeta;
  kind: SoldUploadKind;
}

/** Structural test for `{ selected, attachment? }`, used by the sweep above. */
function isProofBacked(value: unknown): value is {
  selected?: boolean;
  attachment?: SoldDocumentMeta;
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    'selected' in value &&
    !('drivers' in value)
  );
}

/**
 * Reject a discount that cannot belong to the policy type that carries it.
 *
 * Returned as a list of human-readable problems so the DTO can surface all of
 * them at once. Stripping silently would be worse than rejecting: a Home
 * policy claiming `studentDiscount` would otherwise generate a `Good Student`
 * item for a deal with no auto line, and nothing downstream could tell it was
 * bogus.
 */
export function findCrossBranchDiscounts(
  // Narrowed to the two fields actually read, so both write paths' schemas can
  // call it during validation — where the row is not yet a full
  // `SoldPolicyInput` — without either one casting.
  policies: { policyType: string; discounts?: SoldPolicyDiscounts }[],
): string[] {
  const problems: string[] = [];

  policies.forEach((policy, index) => {
    const d = policy.discounts;
    if (!d) return;

    const type = normalizePolicyType(policy.policyType);
    const label = `policies.${index}`;
    const isAuto = isAutoPolicyType(type);
    const isProperty = isPropertyPolicyType(type);

    // Both lists come from `@sfa/shared` so this rule and the web form's
    // "clear the branch that no longer applies" reset cannot drift — the drift
    // is what let a stale selection block the form invisibly.
    const autoSelections = AUTO_DISCOUNT_KEYS.some((key) =>
      isDiscountSelected(d[key]),
    );

    const propertySelections = PROPERTY_DISCOUNT_KEYS.some((key) =>
      isDiscountSelected(d[key]),
    );

    if (autoSelections && !isAuto) {
      problems.push(
        `${label}: auto discounts on a ${type || 'non-auto'} policy`,
      );
    }
    if (propertySelections && !isProperty) {
      problems.push(
        `${label}: property discounts on a ${type || 'non-property'} policy`,
      );
    }
  });

  return problems;
}

/**
 * The deal title, mirroring legacy's 3-tier fallback so migrated and
 * app-created deals read the same in a list.
 */
export function buildDealTitle(
  clientName: string | undefined,
  fallbackId: string,
): string {
  const name = clientName?.trim();
  return name ? `Deal - ${name}` : `Deal - ${fallbackId.slice(0, 8)}`;
}

/** Carried from the lead so the Sold scorecard can attribute by source. */
export function resolveLeadSource(
  leadSource: NormalizedLeadSource | undefined,
): NormalizedLeadSource {
  return leadSource ?? { code: null, label: '' };
}

/** Legacy stores these yes/no answers as strings, not booleans. */
export function yesNo(value: boolean): 'Yes' | 'No' {
  return value ? 'Yes' : 'No';
}

/**
 * Split the per-policy prior carriers into the deal-level auto/home columns.
 *
 * `priorInsurance` is one row per deal with **separate** `previousCarrierAuto`
 * and `previousCarrierHome` fields plus an "auto & home same carrier?" flag —
 * legacy's shape, and what the service team reads. The form asks per policy, so
 * the summary takes the first declared carrier of each kind and the per-line
 * detail lives on in `priorPolicies`.
 *
 * Lines that ticked "no prior insurance" are ignored entirely rather than
 * contributing a blank carrier.
 */
export function derivePriorCarriers(
  policies: Array<
    Pick<SoldPolicyInput, 'policyType'> & {
      priorInsurance: { none: boolean; carrier?: string };
    }
  >,
): { auto?: string; home?: string; sameCarrier: boolean } {
  const declared = policies.filter(
    (p) => !p.priorInsurance.none && p.priorInsurance.carrier?.trim(),
  );

  const auto = declared
    .find((p) => isAutoPolicyType(p.policyType))
    ?.priorInsurance.carrier?.trim();
  const home = declared
    .find((p) => isPropertyPolicyType(p.policyType))
    ?.priorInsurance.carrier?.trim();

  return {
    auto,
    home,
    // Only meaningful when both sides were actually declared — two undefined
    // carriers are not "the same carrier".
    sameCarrier: Boolean(
      auto && home && auto.toLowerCase() === home.toLowerCase(),
    ),
  };
}
