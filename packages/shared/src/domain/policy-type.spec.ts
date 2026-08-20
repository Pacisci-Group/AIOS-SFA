import {
  AUTO_POLICY_TYPES,
  COUNTABLE_POLICY_TYPES,
  IMPLIED_ITEM_COUNT,
  POLICY_TYPES,
  POLICY_TYPE_CODE_ALIASES,
  PROPERTY_POLICY_TYPES,
  isAutoPolicyType,
  isCanonicalPolicyType,
  isPropertyPolicyType,
  itemCountLabel,
  normalizePolicyType,
  policyTypeHasItemCount,
  policyTypeQueryValues,
  resolveItemCount,
} from './policy-type';

/**
 * The policy-type vocabulary reconciles three disjoint SmartSuite code sets and
 * two label spellings that are already in Mongo. These tests pin the collapses,
 * because getting one wrong silently mis-buckets quoted premium.
 */
describe('policy-type vocabulary', () => {
  it('has no duplicate canonical labels', () => {
    expect(new Set(POLICY_TYPES).size).toBe(POLICY_TYPES.length);
  });

  it('resolves every catalogued SmartSuite code to a canonical label', () => {
    const canonical = new Set<string>(POLICY_TYPES);
    for (const code of Object.keys(POLICY_TYPE_CODE_ALIASES)) {
      expect(canonical.has(normalizePolicyType(code))).toBe(true);
    }
  });

  it('collapses every Landlord spelling and code onto one label', () => {
    // `mCt4m` is SmartSuite's "Landlords"; `AiFB5` is the Deals table's
    // "Landlord". Both, plus either label spelling, must agree.
    for (const raw of ['mCt4m', 'AiFB5', 'Landlords', 'landlord', 'LANDLORD']) {
      expect(normalizePolicyType(raw)).toBe('Landlord');
    }
  });

  it('collapses the demo seed’s "Condo" onto "Condominium"', () => {
    expect(normalizePolicyType('Condo')).toBe('Condominium');
    expect(normalizePolicyType('condo')).toBe('Condominium');
    expect(normalizePolicyType('mrzQD')).toBe('Condominium');
  });

  it('maps the separate Policies-table code set too', () => {
    expect(normalizePolicyType('Zgsh3')).toBe('Auto');
    expect(normalizePolicyType('eCEuV')).toBe('Home');
    expect(normalizePolicyType('F3oxm')).toBe('Renters');
    expect(normalizePolicyType('le1BC')).toBe('Umbrella');
    expect(normalizePolicyType('gGKei')).toBe('Motorcycle');
  });

  it('passes an uncatalogued value through rather than dropping it', () => {
    expect(normalizePolicyType('Pet Insurance')).toBe('Pet Insurance');
    expect(normalizePolicyType('  Flood  ')).toBe('Flood');
  });

  it('returns an empty string for nullish or blank input', () => {
    expect(normalizePolicyType(undefined)).toBe('');
    expect(normalizePolicyType(null)).toBe('');
    expect(normalizePolicyType('   ')).toBe('');
  });

  it('expands a label to every stored form for $in filters', () => {
    const values = policyTypeQueryValues('Landlord');
    expect(values).toContain('Landlord');
    expect(values).toContain('mCt4m');
    expect(values).toContain('AiFB5');
    expect(values).toContain('landlords');

    const auto = policyTypeQueryValues('Auto');
    expect(auto).toContain('Auto');
    expect(auto).toContain('PYgez');
    expect(auto).toContain('Zgsh3');
    // "Auto - Special" is its own type and must not be swept in.
    expect(auto).not.toContain('UAOk8');
  });

  it('answers the property question for codes as well as labels', () => {
    for (const label of PROPERTY_POLICY_TYPES) {
      expect(isPropertyPolicyType(label)).toBe(true);
    }
    // Raw codes: Home, Condominium, Landlords.
    expect(isPropertyPolicyType('sNMRK')).toBe(true);
    expect(isPropertyPolicyType('mrzQD')).toBe(true);
    expect(isPropertyPolicyType('mCt4m')).toBe(true);

    expect(isPropertyPolicyType('Auto')).toBe(false);
    expect(isPropertyPolicyType('Umbrella')).toBe(false);
    expect(isPropertyPolicyType('Life')).toBe(false);
    // The prototype's invented type is not part of this vocabulary.
    expect(isPropertyPolicyType('Property')).toBe(false);
    expect(isPropertyPolicyType(undefined)).toBe(false);
  });

  it('answers the auto question for codes as well as labels', () => {
    for (const label of AUTO_POLICY_TYPES) {
      expect(isAutoPolicyType(label)).toBe(true);
    }
    // Raw codes: Auto (Quote Recaps), Auto (Policies), Auto - Special,
    // Motorcycle (Quote Recaps), Motorcycle (Policies).
    expect(isAutoPolicyType('PYgez')).toBe(true);
    expect(isAutoPolicyType('Zgsh3')).toBe(true);
    expect(isAutoPolicyType('UAOk8')).toBe(true);
    expect(isAutoPolicyType('OMJjl')).toBe(true);
    expect(isAutoPolicyType('gGKei')).toBe(true);

    expect(isAutoPolicyType('Home')).toBe(false);
    expect(isAutoPolicyType('Landlord')).toBe(false);
    expect(isAutoPolicyType('Umbrella')).toBe(false);
    expect(isAutoPolicyType(undefined)).toBe(false);
  });

  it('keeps the auto and property sets disjoint', () => {
    // The Sold form's Card 5 branches on these two predicates, and a type
    // answering `true` to both would render the Home and Auto discount blocks
    // together — the one combination the conditional matrix cannot mean.
    for (const label of AUTO_POLICY_TYPES) {
      expect(isPropertyPolicyType(label)).toBe(false);
    }
    for (const label of PROPERTY_POLICY_TYPES) {
      expect(isAutoPolicyType(label)).toBe(false);
    }
  });

  it('asks for an item count only on the vehicle types', () => {
    for (const label of COUNTABLE_POLICY_TYPES) {
      expect(policyTypeHasItemCount(label)).toBe(true);
    }
    // Raw codes answer too: Auto, Motorcycle, Boat Owners.
    expect(policyTypeHasItemCount('PYgez')).toBe(true);
    expect(policyTypeHasItemCount('gGKei')).toBe(true);
    expect(policyTypeHasItemCount('NlLBc')).toBe(true);

    // The types the field used to confuse producers on. There is nothing on a
    // house or a life policy to count — the answer is always one.
    for (const label of PROPERTY_POLICY_TYPES) {
      expect(policyTypeHasItemCount(label)).toBe(false);
    }
    expect(policyTypeHasItemCount('Umbrella')).toBe(false);
    expect(policyTypeHasItemCount('Life')).toBe(false);
    expect(policyTypeHasItemCount('Valuable Item Protection')).toBe(false);
    expect(policyTypeHasItemCount(undefined)).toBe(false);
  });

  it('is exactly the set that has a type-specific count noun', () => {
    // The generic "Item count" wording is the tell: a type that needs it is a
    // type with nothing to count, and so is a type we do not ask.
    for (const label of POLICY_TYPES) {
      expect(policyTypeHasItemCount(label)).toBe(
        itemCountLabel(label) !== 'Item count',
      );
    }
  });

  it('stores the count sent for a vehicle policy and 1 for everything else', () => {
    expect(resolveItemCount('Auto', 3)).toBe(3);
    expect(resolveItemCount('Boat Owners', 2)).toBe(2);
    // A raw code resolves the same way a label does.
    expect(resolveItemCount('OMJjl', 4)).toBe(4);

    expect(resolveItemCount('Home', 3)).toBe(IMPLIED_ITEM_COUNT);
    expect(resolveItemCount('Umbrella', 7)).toBe(IMPLIED_ITEM_COUNT);
    expect(resolveItemCount('sNMRK', 9)).toBe(IMPLIED_ITEM_COUNT);
  });

  it('leaves an uncatalogued type\'s stored count alone', () => {
    // `PATCH /policies/:id` edits migrated rows whose type normalizes to
    // nothing we know. Forcing 1 there would destroy a real count on the first
    // unrelated save.
    expect(isCanonicalPolicyType('Flood')).toBe(false);
    expect(resolveItemCount('Flood', 5)).toBe(5);
    expect(resolveItemCount('', 5)).toBe(5);
    expect(resolveItemCount(undefined, 5)).toBe(5);

    // Every canonical label and every code aliasing to one is recognised.
    for (const label of POLICY_TYPES) {
      expect(isCanonicalPolicyType(label)).toBe(true);
    }
    for (const code of Object.keys(POLICY_TYPE_CODE_ALIASES)) {
      expect(isCanonicalPolicyType(code)).toBe(true);
    }
  });
});
