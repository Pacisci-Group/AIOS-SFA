import {
  PRIOR_POLICY_CANCELLATION_CODE_ALIASES,
  PRIOR_POLICY_CANCELLATION_STATUSES,
  PRIOR_POLICY_TYPES,
  PRIOR_POLICY_TYPE_CODE_ALIASES,
  normalizePriorPolicyCancellationStatus,
  normalizePriorPolicyType,
} from './prior-policy';
import { normalizeCancellationResponsibility } from './prior-insurance';
import { POLICY_TYPE_CODE_ALIASES, normalizePolicyType } from './policy-type';

describe('prior policy vocabulary', () => {
  it('resolves every catalogued type code to a canonical label', () => {
    for (const [code, expected] of Object.entries(
      PRIOR_POLICY_TYPE_CODE_ALIASES,
    )) {
      expect(normalizePriorPolicyType(code)).toBe(expected);
      expect(PRIOR_POLICY_TYPES).toContain(expected);
    }
  });

  it('resolves every catalogued cancellation code', () => {
    for (const [code, expected] of Object.entries(
      PRIOR_POLICY_CANCELLATION_CODE_ALIASES,
    )) {
      expect(normalizePriorPolicyCancellationStatus(code)).toBe(expected);
      expect(PRIOR_POLICY_CANCELLATION_STATUSES).toContain(expected);
    }
  });

  it('passes an already-canonical label through unchanged', () => {
    // What makes it safe to apply on both write and read, and to re-run over
    // data a previous import already healed.
    for (const label of PRIOR_POLICY_TYPES) {
      expect(normalizePriorPolicyType(label)).toBe(label);
    }
  });

  it('passes an uncatalogued value through rather than dropping it', () => {
    expect(normalizePriorPolicyType('Boat')).toBe('Boat');
    expect(normalizePriorPolicyType('')).toBe('');
    expect(normalizePriorPolicyType(null)).toBe('');
  });
});

describe('the XT6s7 / fr4Ge collision', () => {
  /*
   * This is the reason every vocabulary in this codebase is scoped to one
   * field, and the reason a "tidy the maps into one" refactor must fail loudly.
   *
   * SmartSuite field id `sb3cc60eb5` appears on two tables. On Prior Policies it
   * is "Policy Type"; on Prior Insurance it is "Cancellation Responsibility".
   * The clone kept the original's choice ids while its labels were rewritten, so
   * the same two codes carry unrelated meanings.
   */
  it('reads the same code as two different things in two different tables', () => {
    expect(normalizePriorPolicyType('XT6s7')).toBe('Auto');
    expect(normalizeCancellationResponsibility('XT6s7')).toBe('SFA Call');

    expect(normalizePriorPolicyType('fr4Ge')).toBe('Home');
    expect(normalizeCancellationResponsibility('fr4Ge')).toBe('Customer Call');
  });

  it('never lets the global policy-type map learn either code', () => {
    /*
     * The live hazard, not a hypothetical one: `lead-detail.service.ts` used to
     * call `normalizePolicyType` on a prior policy. It was harmless only because
     * the global map happened not to contain these codes. Teaching it
     * `XT6s7 → Auto` would have started rendering a cancellation responsibility
     * as "Auto" on the Lead Detail page.
     */
    expect(POLICY_TYPE_CODE_ALIASES).not.toHaveProperty('XT6s7');
    expect(POLICY_TYPE_CODE_ALIASES).not.toHaveProperty('fr4Ge');
    expect(POLICY_TYPE_CODE_ALIASES).not.toHaveProperty('RWdTl');
    expect(normalizePolicyType('XT6s7')).toBe('XT6s7');
  });

  it('keeps "Other" out of the live policy-type vocabulary', () => {
    // A prior policy may be "Other"; a live one may not. Another reason the two
    // vocabularies cannot be merged.
    expect(PRIOR_POLICY_TYPES).toContain('Other');
    expect(normalizePriorPolicyType('RWdTl')).toBe('Other');
  });
});
