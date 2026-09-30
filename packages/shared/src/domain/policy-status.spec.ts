import {
  FLOW_ONLY_POLICY_STATUSES,
  POLICY_STATUSES,
  POLICY_STATUS_OPTIONS,
  TERMINAL_POLICY_STATUSES,
  isFlowOnlyPolicyStatus,
  isTerminalPolicyStatus,
  policyActiveForStatus,
} from './policy-status';

/**
 * These decide whether a policy counts towards a household's active total and
 * whether the renewal scan schedules calls for it, so a wrong answer here is
 * visible to a client on the phone.
 */
describe('terminal statuses and the active flag', () => {
  it('deactivates a policy for every terminal status', () => {
    for (const status of TERMINAL_POLICY_STATUSES) {
      expect(isTerminalPolicyStatus(status)).toBe(true);
      expect(policyActiveForStatus(status)).toBe(false);
    }
  });

  it('reinstates on Active', () => {
    // The correction in the other direction has to work too, or fixing a
    // mistakenly-cancelled policy leaves it invisible.
    expect(policyActiveForStatus('Active')).toBe(true);
    expect(policyActiveForStatus('QsrnM')).toBe(true);
  });

  it('leaves the flag alone for Quoted and Pending', () => {
    // Neither is live, but neither is terminal — flipping `active` off would
    // retire a policy that is merely waiting on the carrier.
    for (const status of ['Quoted', 'Pending']) {
      expect(policyActiveForStatus(status)).toBeNull();
      expect(isTerminalPolicyStatus(status)).toBe(false);
    }
  });

  it('leaves the flag alone for an uncatalogued migrated code', () => {
    // `1943j` and `4krtk` appear in no table doc. Guessing either into a flag
    // would silently retire or revive thousands of policies.
    for (const code of ['1943j', '4krtk', '', null, undefined]) {
      expect(policyActiveForStatus(code)).toBeNull();
    }
  });

  it('normalizes before deciding', () => {
    expect(policyActiveForStatus('cancelled')).toBe(false);
    expect(policyActiveForStatus('hLpfg')).toBe(false);
  });
});

describe('flow-only statuses', () => {
  it('covers both replacement statuses', () => {
    // Neither can be chosen by hand: each means "replaced by *that* policy",
    // and the flow that sets it writes the replacement in the same transaction.
    expect([...FLOW_ONLY_POLICY_STATUSES]).toEqual([
      'Cancel Rewrite',
      'Company Transfer',
    ]);
    expect(isFlowOnlyPolicyStatus('Cancel Rewrite')).toBe(true);
    expect(isFlowOnlyPolicyStatus('company transfer')).toBe(true);
  });

  it('does not offer them in the status select', () => {
    // The API rejects them on PATCH, and an option that always 400s is worse
    // than no option.
    for (const status of FLOW_ONLY_POLICY_STATUSES) {
      expect(POLICY_STATUS_OPTIONS).not.toContain(status);
    }
  });

  it('still offers every status a human may set', () => {
    const offered = new Set<string>(POLICY_STATUS_OPTIONS);
    const flowOnly = new Set<string>(FLOW_ONLY_POLICY_STATUSES);
    for (const status of POLICY_STATUSES) {
      expect(offered.has(status)).toBe(!flowOnly.has(status));
    }
  });

  it('leaves plain Cancelled selectable', () => {
    // A client who simply cancels is the common case and must not be forced
    // through the rewrite wizard to record it.
    expect(POLICY_STATUS_OPTIONS).toContain('Cancelled');
    expect(isFlowOnlyPolicyStatus('Cancelled')).toBe(false);
  });
});
