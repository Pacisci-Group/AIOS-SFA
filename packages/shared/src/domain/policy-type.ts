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
  // The three below are not in the Quote Recaps list this vocabulary started
  // from, but the agency sold them in SmartSuite: they are choices on the
  // Policies table that the table doc we built from never listed (PAC-135).
  'Manufactured Home',
  'RV',
  'ATV / ORV',
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
  /*
   * The rest of the Policies set (PAC-135). `docs/smartsuite-tables/The Policies
   * Table.md` lists six choices; SmartSuite has thirteen, and the import read a
   * choice's code while ignoring the hydrated label beside it — so these seven
   * were stored as raw codes on 92 policies. (The import now falls back to the
   * label; this map is what repairs the rows already stored.) Decoded by joining those
   * policies to the labelled 2026-09-04 Policies export — every row agreed — and
   * four of them independently confirmed by legacy's own lookup table in
   * `SFA/app/api/admin/deal-audit-detail/route.ts`. They reach
   * `deals.policyTypes` too, via the migration's rollup of a deal's policies.
   */
  BK08B: 'Boat Owners', // SmartSuite: "Boat"
  ayKjZ: 'Valuable Item Protection', // SmartSuite: "Item Protection"
  UrNOp: 'Condominium', // SmartSuite: "Condo"
  HicyK: 'Life',
  Tz3ny: 'Manufactured Home', // SmartSuite: "Manufactured Homes"
  sTSOE: 'RV',
  cgoHC: 'ATV / ORV', // SmartSuite: "ATVs / ORVs"
  /*
   * A Quote Recaps `products_quoted` choice the table doc does not list, on six
   * migrated recaps. Confirmed from SmartSuite's own choice list (2026-09-21);
   * the data agreed beforehand — five of the six leads went on to an `sTSOE`
   * (RV) deal, four at the quoted premium to the dollar.
   */
  AP0VA: 'RV',
};

/**
 * Non-canonical **label** spellings, exactly as their source writes them.
 *
 * `deals.policyTypes` holds "Landlords" (via the migration's label map), the
 * demo seed held "Condo", and the rest are SmartSuite's own wording for a type
 * we name differently — what a labelled export or a hand-typed correction
 * carries. Recorded in their **exact** case because a Mongo `$in` is
 * case-sensitive: see {@link policyTypeQueryValues}.
 */
export const POLICY_TYPE_LEGACY_LABELS: Record<string, PolicyType> = {
  Landlords: 'Landlord',
  Condo: 'Condominium',
  Boat: 'Boat Owners',
  'Item Protection': 'Valuable Item Protection',
  'Manufactured Homes': 'Manufactured Home',
  'ATVs / ORVs': 'ATV / ORV',
};

/** {@link POLICY_TYPE_LEGACY_LABELS} keyed in lowercase, for the read path. */
export const POLICY_TYPE_LABEL_ALIASES: Record<string, PolicyType> =
  Object.fromEntries(
    Object.entries(POLICY_TYPE_LEGACY_LABELS).map(([label, canonical]) => [
      label.toLowerCase(),
      canonical,
    ]),
  );

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
  // Both the exact legacy spelling and its lowercase form: `$in` is
  // case-sensitive, so the lowercase key alone (`landlords`) would never match
  // the value it exists for (`Landlords`).
  const labels = Object.entries(POLICY_TYPE_LEGACY_LABELS)
    .filter(([, mapped]) => mapped === canonical)
    .flatMap(([label]) => [label, label.toLowerCase()]);

  return [...new Set([canonical, ...codes, ...labels])];
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
  // A dwelling like any other: it has an address, and a quote without one is
  // the omission the Condominium note above is about (PAC-135).
  'Manufactured Home',
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
 * Vehicles that are **not** part of the auto family (PAC-135).
 *
 * An RV or a pair of ATVs is a countable fleet, so these ask "how many?" and
 * say "vehicles". They are deliberately kept out of {@link AUTO_POLICY_TYPES}:
 * that list drives the Sold form's Drivewise / Defensive Driver / Student
 * discount branch and the `Drivers Verified` audit item, none of which legacy
 * ever applied to them — and out of {@link SEMIANNUAL_TERM_POLICY_TYPES}, since
 * David's six-month rule was about auto, and annual is the documented safe
 * guess for anything else.
 */
export const RECREATIONAL_VEHICLE_POLICY_TYPES: readonly PolicyType[] = [
  'RV',
  'ATV / ORV',
];

const RECREATIONAL_VEHICLE_SET = new Set<string>(
  RECREATIONAL_VEHICLE_POLICY_TYPES,
);

/** Is one "item" on this policy a vehicle — auto family or recreational? */
function isVehiclePolicyType(value?: string | null): boolean {
  return (
    isAutoPolicyType(value) ||
    RECREATIONAL_VEHICLE_SET.has(normalizePolicyType(value))
  );
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
  ...RECREATIONAL_VEHICLE_POLICY_TYPES,
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
  if (isVehiclePolicyType(policyType)) return 'Number of Vehicles';
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
  const singular = isVehiclePolicyType(policyType)
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
 * Types quoted on a 6-month term. **Auto and Auto - Special only.**
 *
 * Motorcycle was seeded in here from {@link AUTO_POLICY_TYPES} when the
 * 2026-08-19 rule was read as "any auto vehicle", and was taken back out on
 * 2026-09-11: motorcycle is written on a 12-month term, which is the case this
 * file's own note predicted ("carriers write motorcycle annually more often
 * than not").
 *
 * **Its own array rather than a call to {@link isAutoPolicyType}, and this is
 * the divergence that vindicates that.** "Renews every 6 months" and "is a
 * motor vehicle" are two different facts, and Motorcycle now sits in the second
 * set but not the first: it keeps the Sold form's Drivewise / defensive-driver
 * / student branch and the `Drivers Verified` audit item, because those follow
 * the *vehicle*, while its premium is labelled and its renewal scheduled
 * annually. Expressing the term change by editing `AUTO_POLICY_TYPES` would
 * have silently moved that discount branch and audit item with it.
 *
 * ⚠ `policies.renewalDate` is **derived and stored**, so changing this array
 * does not reach rows already written — only the next write of each policy
 * would. Moving a type between tracks therefore needs a migration to re-derive
 * the anchor; this one's is
 * `migrations/20260911154500-motorcycle_annual_renewal_anchors.js`.
 */
export const SEMIANNUAL_TERM_POLICY_TYPES: readonly PolicyType[] = [
  'Auto',
  'Auto - Special',
];

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
