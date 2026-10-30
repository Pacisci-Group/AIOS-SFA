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
  it('covers both replacement statuses and plain Cancelled', () => {
    // None can be chosen by hand: the two replacements each mean "replaced by
    // *that* policy", and the flow that sets one writes the replacement in the
    // same transaction; a plain cancellation goes through the Cancel button,
    // which records why.
    expect([...FLOW_ONLY_POLICY_STATUSES]).toEqual([
      'Cancelled',
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

  it('routes plain Cancelled through the Cancel button, not the select', () => {
    // A client who simply cancels is still the common case — it is a one-step
    // dialog rather than the rewrite wizard, but it is no longer a status the
    // Edit dialog can set without saying why.
    expect(POLICY_STATUS_OPTIONS).not.toContain('Cancelled');
    expect(isFlowOnlyPolicyStatus('Cancelled')).toBe(true);
    // The migrated code normalizes first, like every other check here.
    expect(isFlowOnlyPolicyStatus('hLpfg')).toBe(true);
  });

  it('still lets Lapsed be set by hand', () => {
    expect(POLICY_STATUS_OPTIONS).toContain('Lapsed');
    expect(isFlowOnlyPolicyStatus('Lapsed')).toBe(false);
  });
});
