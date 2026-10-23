import { DEFAULT_LEAVE_POLICY_RULES, type LeavePolicyRules } from '@sfa/shared';
import { validateLeavePolicyRules } from './leave-policy.validate';

const withRules = (patch: (rules: LeavePolicyRules) => void) => {
  const rules = structuredClone(DEFAULT_LEAVE_POLICY_RULES);
  patch(rules);
  return rules;
};

describe('validateLeavePolicyRules (PAC-161)', () => {
  it('accepts the defaults', () => {
    expect(validateLeavePolicyRules(DEFAULT_LEAVE_POLICY_RULES)).toEqual([]);
  });

  it('needs an active leave type with unique keys', () => {
    expect(
      validateLeavePolicyRules(
        withRules((r) => r.leaveTypes.forEach((t) => (t.active = false))),
      ),
    ).toContain('At least one leave type must be active.');
    expect(
      validateLeavePolicyRules(
        withRules((r) => (r.leaveTypes[1].key = r.leaveTypes[0].key)),
      ),
    ).toContain('Leave type keys must be unique.');
  });

  it('pins the increment to the offered values', () => {
    expect(
      validateLeavePolicyRules(
        withRules((r) => (r.requests.partialDayIncrementMinutes = 7)),
      ),
    ).toHaveLength(1);
  });

  it('ties the conditional fields to their modes', () => {
    expect(
      validateLeavePolicyRules(
        withRules((r) => (r.requests.validation.advanceNotice = 'warn')),
      ),
    ).toContain(
      'Advance notice days are required while the advance-notice check is on.',
    );
    expect(
      validateLeavePolicyRules(
        withRules((r) => (r.pto.resetBasis = 'fiscal_year')),
      ),
    ).toContain('A fiscal-year start is required for a fiscal-year reset.');
    expect(
      validateLeavePolicyRules(
        withRules((r) => (r.pto.carryover.mode = 'capped')),
      ),
    ).toContain('A carryover cap is required when carryover is capped.');
    expect(
      validateLeavePolicyRules(
        withRules((r) => (r.pto.negativeBalance.mode = 'floor')),
      ),
    ).toContain('A floor is required when a negative balance is floored.');
  });

  it('checks the ladders and thresholds only while points are on', () => {
    const broken = withRules((r) => {
      r.points.ladders.tardy = [];
      r.points.thresholds = [
        { points: 5, recipients: ['employee'], guidance: '' },
        { points: 5, recipients: ['employee'], guidance: '' },
      ];
    });
    expect(validateLeavePolicyRules(broken)).toEqual([
      'The tardy ladder needs at least one step.',
      'Point thresholds must be ascending and unique.',
    ]);
    broken.points.enabled = false;
    expect(validateLeavePolicyRules(broken)).toEqual([]);
  });

  it('refuses an inverted blackout range', () => {
    expect(
      validateLeavePolicyRules(
        withRules((r) =>
          r.requests.blackoutRanges.push({
            from: '2026-12-31',
            to: '2026-12-01',
            label: 'Year end',
          }),
        ),
      ),
    ).toEqual(['Blackout "Year end" ends before it starts.']);
  });
});
