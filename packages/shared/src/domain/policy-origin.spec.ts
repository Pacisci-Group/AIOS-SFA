import {
  POLICY_ORIGINS,
  POLICY_ORIGIN_LABELS,
  policyOriginOf,
} from './policy-origin';

describe('policy origin', () => {
  it('labels every origin', () => {
    for (const origin of POLICY_ORIGINS) {
      expect(POLICY_ORIGIN_LABELS[origin]).toBeTruthy();
    }
    expect(POLICY_ORIGIN_LABELS.carrier_direct).toBe('Allstate direct (1-800)');
  });

  it('reads anything else as the agency’s own', () => {
    expect(policyOriginOf('carrier_direct')).toBe('carrier_direct');
    expect(policyOriginOf(undefined)).toBeNull();
    expect(policyOriginOf(null)).toBeNull();
    expect(policyOriginOf('agency')).toBeNull();
  });
});
