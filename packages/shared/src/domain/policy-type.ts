/**
 * Canonical policy-type vocabulary (PAC-39).
 *
 * Four disjoint sources had to be reconciled here:
 *
 * 1. SmartSuite "Quote Recaps" `products_quoted` (`s1e17612aa`) — 11 choices,
 *    the authoritative list, since that is the table we write.
 * 2. SmartSuite "Deals" Policy Type(s) — the same codes minus `UAOk8`, plus
 *    `AiFB5` ("Landlord", singular).
 * 3. SmartSuite "Policies" — a wholly separate code set for the same concepts.
 * 4. The `sfaforms` prototype, which invented a "Property" type that exists in
 *    none of the above. It is deliberately **not** part of this vocabulary.
 *
 * The storage split is the trap: the migration writes `quoteRecaps
 * .productsQuoted` with `selectCodes()`, i.e. **raw choice codes** (`PYgez`),
 * while `deals.policyTypes` and the demo seed hold **labels** (`Auto`). Rather
 * than backfill, we normalize on read ({@link normalizePolicyType}) and expand
 * filters on write ({@link policyTypeQueryValues}) so both stored forms match —
 * exactly the approach `lead-status.ts` takes for `leads.status`.
 */

/** Canonical labels. Drives the Quote Recap form's policy-type dropdown. */
export const POLICY_TYPES = [
  'Auto',
  'Home',
  'Renters',
  'Condominium',
  'Landlord',
  'Motorcycle',
  'Boat Owners',
  'Umbrella',
  'Life',
  'Valuable Item Protection',
  'Auto - Special',
] as const;

export type PolicyType = (typeof POLICY_TYPES)[number];

/**
 * What the form offers. Currently everything: unlike `lead-source`'s `Test`
 * entry, no policy type is a data-integrity artefact, and hiding the long tail
 * would just push producers to mis-classify.
 */
export const POLICY_TYPE_OPTIONS: readonly PolicyType[] = POLICY_TYPES;

/**
 * SmartSuite choice codes → canonical label, across all three code sets.
 *
 * Two collapses are intentional: SmartSuite spells `mCt4m` "Landlords" while
 * the Deals and Policies tables use the singular, and the demo seed writes
 * "Condo" for `mrzQD`'s "Condominium". One spelling wins in both cases.
 */
export const POLICY_TYPE_CODE_ALIASES: Record<string, PolicyType> = {
  // Quote Recaps `products_quoted` (s1e17612aa) — the authoritative list.
  PYgez: 'Auto',
  sNMRK: 'Home',
  Hn155: 'Renters',
  mrzQD: 'Condominium',
  mCt4m: 'Landlord',
  OMJjl: 'Motorcycle',
  NlLBc: 'Boat Owners',
  fltex: 'Umbrella',
  EGGWR: 'Life',
  uBjtw: 'Valuable Item Protection',
  UAOk8: 'Auto - Special',
  // Deals "Policy Type(s)" — one code the Quote Recaps set does not carry.
  AiFB5: 'Landlord',
  // Policies single-select — a separate code set for overlapping concepts.
  Zgsh3: 'Auto',
  eCEuV: 'Home',
  F3oxm: 'Renters',
  le1BC: 'Umbrella',
  gGKei: 'Motorcycle',
};

/**
 * Non-canonical **label** spellings already sitting in Mongo. Keys lowercased.
 *
 * `deals.policyTypes` holds "Landlords" (via the migration's label map) and the
 * demo seed held "Condo", so a label alias map is needed on top of the code map.
 */
export const POLICY_TYPE_LABEL_ALIASES: Record<string, PolicyType> = {
  landlords: 'Landlord',
  condo: 'Condominium',
};

const CANONICAL_BY_LOWER = new Map<string, PolicyType>(
  POLICY_TYPES.map((t) => [t.toLowerCase(), t]),
);

/**
 * Stored value → canonical label. Accepts a raw choice code or any label
 * spelling, case-insensitively. Unrecognized non-empty values pass through
 * trimmed, so a type we haven't catalogued still renders as itself rather than
 * disappearing.
 */
export function normalizePolicyType(raw?: string | null): string {
  const value = (raw ?? '').trim();
  if (!value) return '';

  const byCode = POLICY_TYPE_CODE_ALIASES[value];
  if (byCode) return byCode;

  const lower = value.toLowerCase();
  return (
    POLICY_TYPE_LABEL_ALIASES[lower] ?? CANONICAL_BY_LOWER.get(lower) ?? value
  );
}

/**
 * Canonical label → every stored form that must match it. Feeds a Mongo
 * `{ productsQuoted: { $in: [...] } }` filter, so that filtering by "Landlord"
 * also matches migrated documents storing `mCt4m` or the label "Landlords".
 */
export function policyTypeQueryValues(label: string): string[] {
  const canonical = normalizePolicyType(label);
  if (!canonical) return [];

  const codes = Object.entries(POLICY_TYPE_CODE_ALIASES)
    .filter(([, mapped]) => mapped === canonical)
    .map(([code]) => code);
  const labels = Object.entries(POLICY_TYPE_LABEL_ALIASES)
    .filter(([, mapped]) => mapped === canonical)
    .map(([alias]) => alias);

  return [canonical, ...codes, ...labels];
}

/**
 * Types that describe an insured dwelling, and therefore require a property
 * address on the Quote Recap form.
 *
 * The form-pipeline spec says "Home/Renters/Landlord"; Condominium is added
 * because omitting it would silently drop the address for every condo quote.
 * The prototype triggers on its invented "Property" type only — that behaviour
 * is not ported.
 */
export const PROPERTY_POLICY_TYPES: readonly PolicyType[] = [
  'Home',
  'Renters',
  'Condominium',
  'Landlord',
];

const PROPERTY_SET = new Set<string>(PROPERTY_POLICY_TYPES);

/** Normalizes first, so this answers correctly for a raw code too. */
export function isPropertyPolicyType(value?: string | null): boolean {
  return PROPERTY_SET.has(normalizePolicyType(value));
}
