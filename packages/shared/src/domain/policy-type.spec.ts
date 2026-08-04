import {
  POLICY_TYPES,
  POLICY_TYPE_CODE_ALIASES,
  PROPERTY_POLICY_TYPES,
  isPropertyPolicyType,
  normalizePolicyType,
  policyTypeQueryValues,
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
});
