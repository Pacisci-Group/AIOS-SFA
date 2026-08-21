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

/**
 * Types that describe a motor vehicle (PAC-40).
 *
 * Drives the Sold form's Card 5 "Auto" discount branch (Drivewise, Defensive
 * Driver, Student) and the `Drivers Verified` audit item. `Motorcycle` is
 * included because legacy's audit generator tests `includes('motorcycle')`
 * alongside `includes('auto')` when deciding whether a deal has an auto line —
 * see `deriveDealType`.
 */
export const AUTO_POLICY_TYPES: readonly PolicyType[] = [
  'Auto',
  'Auto - Special',
  'Motorcycle',
];

const AUTO_SET = new Set<string>(AUTO_POLICY_TYPES);

/** Normalizes first, so this answers correctly for a raw code too. */
export function isAutoPolicyType(value?: string | null): boolean {
  return AUTO_SET.has(normalizePolicyType(value));
}

/** True when the value is one of our canonical labels, or a code aliasing to one. */
export function isCanonicalPolicyType(value?: string | null): boolean {
  return CANONICAL_BY_LOWER.has(normalizePolicyType(value).toLowerCase());
}

/**
 * Types where "how many?" is a real question — the only ones that ask for an
 * item count (PAC-65 #7 follow-up).
 *
 * David: an item count on a Home, Renters, Umbrella or Life policy confuses
 * producers, because there is nothing there to count — the answer is always
 * one. Only a vehicle policy insures a countable fleet, so only a vehicle
 * policy is asked. Boat Owners is in because a boat is a vehicle you can own
 * two of; it is exactly the set {@link itemCountLabel} already gives a
 * type-specific noun to ("Number of Vehicles" / "Number of Boats"), and the
 * generic "Item count" wording it falls back to is precisely the question we
 * are now not asking.
 *
 * ⚠ This is a *form* rule with a storage consequence: {@link resolveItemCount}
 * is what makes the stored count 1 rather than whatever a client sent, so no
 * write path may take `itemCount` straight off the wire.
 */
export const COUNTABLE_POLICY_TYPES: readonly PolicyType[] = [
  ...AUTO_POLICY_TYPES,
  'Boat Owners',
];

const COUNTABLE_SET = new Set<string>(COUNTABLE_POLICY_TYPES);

/**
 * Should this policy type be asked for an item count at all?
 *
 * Normalizes first, so this answers correctly for a raw code too. An
 * unrecognized type answers `false` — see {@link resolveItemCount} for why that
 * does *not* mean "overwrite it with 1".
 */
export function policyTypeHasItemCount(value?: string | null): boolean {
  return COUNTABLE_SET.has(normalizePolicyType(value));
}

/** What a policy nobody is asked to count carries. Always one. */
export const IMPLIED_ITEM_COUNT = 1;

/**
 * The count to store for a policy, given the count a client sent.
 *
 * The forms hide the field for a non-countable type and hold `1`, so this is
 * belt-and-braces on the client — but it is the *only* guarantee on the server,
 * where the public lead-intake form and the Bruno collection can both post
 * whatever they like.
 *
 * An **unrecognized** type keeps its stored count. `PATCH /policies/:id` edits
 * migrated rows whose type may normalize to nothing at all; forcing those to 1
 * would destroy a real count on the first unrelated save, which is the same
 * reasoning that makes `policy-schema.ts` seed an unknown type as `""`.
 */
export function resolveItemCount(
  policyType: string | null | undefined,
  count: number,
): number {
  if (policyTypeHasItemCount(policyType)) return count;
  return isCanonicalPolicyType(policyType) ? IMPLIED_ITEM_COUNT : count;
}

/**
 * What one "item" on a policy actually is (PAC-65 #7).
 *
 * David asked for "Item Count" → **"Number of Vehicles"**, then noted the field
 * is also shown for Boat and Motorcycle. A blanket rename would put "Number of
 * Vehicles" on a boat policy, so the label follows the policy type instead:
 * the auto family are vehicles ({@link isAutoPolicyType} is exactly Auto,
 * Auto - Special and Motorcycle) and Boat Owners are boats.
 *
 * The generic "Item count" fallback survives for **display only**. No form asks
 * it any more — {@link policyTypeHasItemCount} is false for every type that
 * would reach it — but a migrated policy carrying an uncatalogued type still
 * has a stored count to render, and it needs a word.
 *
 * ⚠ Labels only. The stored field stays `itemCount` (and `items` on `Policy`);
 * renaming it across five collections and four DTOs would be a migration, and
 * is not what was asked for.
 */
export function itemCountLabel(policyType?: string | null): string {
  if (isAutoPolicyType(policyType)) return 'Number of Vehicles';
  if (normalizePolicyType(policyType) === 'Boat Owners') return 'Number of Boats';
  return 'Item count';
}

/**
 * The same vocabulary as {@link itemCountLabel}, as a noun for inline copy —
 * "2 vehicles", "1 boat", "5 items".
 *
 * Shares the label's rules rather than restating them, so a policy type cannot
 * read "Number of Vehicles" on the form and "3 items" on the summary.
 */
export function itemCountNoun(
  policyType: string | null | undefined,
  count: number,
): string {
  const singular = isAutoPolicyType(policyType)
    ? 'vehicle'
    : normalizePolicyType(policyType) === 'Boat Owners'
      ? 'boat'
      : 'item';
  return count === 1 ? singular : `${singular}s`;
}

/* -------------------------------------------------------------------------- *
 * Premium term
 * -------------------------------------------------------------------------- */

/**
 * How long the term a premium is quoted for actually is.
 *
 * David, 2026-08-19 scrum: *"auto policies are every six months … what they get
 * paid off of is the premium for 6 months, not the yearly premium"*, and
 * *"when they put in any other policy, it's going to be annual. So auto is the
 * only policy that's six months."*
 *
 * ⚠ This is a **labelling** rule, not a conversion. The number a producer types
 * is whatever the carrier quoted — for an auto policy that is already the
 * 6-month figure. Nothing here doubles it, and no stored premium changes. The
 * defect this fixes is that the app printed `/yr` beside a 6-month number.
 */
export const ANNUAL_TERM_MONTHS = 12;
export const SEMIANNUAL_TERM_MONTHS = 6;

/**
 * Types quoted on a 6-month term.
 *
 * Seeded from {@link AUTO_POLICY_TYPES} because David confirmed the rule
 * applies to "any auto vehicle" — so Motorcycle is in, alongside Auto and
 * Auto - Special.
 *
 * **Kept as its own array rather than calling {@link isAutoPolicyType}.**
 * "Renews every 6 months" and "is a motor vehicle" are two different facts that
 * happen to coincide today; carriers write motorcycle annually more often than
 * not, and a 6-month non-vehicle line is perfectly possible. When the term rule
 * changes, change *this* array — editing `AUTO_POLICY_TYPES` would silently
 * move the Sold form's discount branch and the `Drivers Verified` audit item
 * with it.
 */
export const SEMIANNUAL_TERM_POLICY_TYPES: readonly PolicyType[] =
  AUTO_POLICY_TYPES;

const SEMIANNUAL_TERM_SET = new Set<string>(SEMIANNUAL_TERM_POLICY_TYPES);

/**
 * A lowercase comparison key: whitespace collapsed and a trailing plural
 * dropped, so "Autos" matches "Auto".
 *
 * {@link normalizePolicyType} resolves codes and catalogued aliases but passes
 * an unrecognized spelling straight through, and `policies.policyType` is a
 * free-form string the migration filled from three different SmartSuite code
 * sets. This is the second pass that catches what the first does not.
 */
function termComparisonKey(value: string): string {
  const key = value.trim().toLowerCase().replace(/\s+/g, ' ');
  return key.endsWith('s') ? key.slice(0, -1) : key;
}

const SEMIANNUAL_TERM_KEYS = new Set<string>(
  SEMIANNUAL_TERM_POLICY_TYPES.map(termComparisonKey),
);

/**
 * **The one authority on whether a premium is quoted per 6 months.**
 * `renewalTrackFor` delegates here, so the renewal cadence and the `/6 mo`
 * label cannot drift apart.
 *
 * Tolerant in both directions a stored value can be odd: a raw SmartSuite code
 * (`PYgez`) resolves through {@link normalizePolicyType}, and an uncatalogued
 * spelling ("Autos") falls back to {@link termComparisonKey}. Neither pass
 * alone covers both — which is exactly how a migrated auto policy ended up on
 * the annual renewal track while its premium rendered `/6 mo`.
 *
 * An unrecognized type answers `false`: a row carrying a type we never
 * catalogued is described as annual, the safer of the two guesses.
 */
export function isSemiannualPolicyType(value?: string | null): boolean {
  const canonical = normalizePolicyType(value);
  if (!canonical) return false;
  return (
    SEMIANNUAL_TERM_SET.has(canonical) ||
    SEMIANNUAL_TERM_KEYS.has(termComparisonKey(canonical))
  );
}

/** The term a premium of this type covers, in months. */
export function policyTermMonths(value?: string | null): number {
  return isSemiannualPolicyType(value)
    ? SEMIANNUAL_TERM_MONTHS
    : ANNUAL_TERM_MONTHS;
}

/**
 * The unit to print beside a premium figure, e.g. `$940` + `/6 mo`.
 *
 * Only ever for a *single* policy's premium. A total summed across policy types
 * mixes terms and has no honest suffix; those render bare. See
 * `QuoteTotals` in `QuoteRecapCard.tsx`.
 */
export function premiumTermSuffix(value?: string | null): string {
  return isSemiannualPolicyType(value) ? '/6 mo' : '/yr';
}

/**
 * What to call the premium field on a form — "6-month premium" / "Annual
 * premium".
 *
 * This is the load-bearing half of the fix: a producer told which term the box
 * wants enters the right number, so the data arrives correct instead of being
 * relabelled after the fact.
 */
export function premiumTermLabel(value?: string | null): string {
  return isSemiannualPolicyType(value) ? '6-month premium' : 'Annual premium';
}
