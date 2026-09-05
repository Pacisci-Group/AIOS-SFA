import { appointmentCodeKey } from './carrier-appointment';

describe('appointmentCodeKey', () => {
  it('matches the same code however it was typed', () => {
    expect(appointmentCodeKey('A0B9049')).toBe('A0B9049');
    expect(appointmentCodeKey('  a0b9049 ')).toBe('A0B9049');
    expect(appointmentCodeKey('a0B9049\n')).toBe('A0B9049');
  });

  it('derives the same key from an operator and from a mailer file', () => {
    // The whole reason this function is in `shared`: one side types the code
    // into onboarding, the other reads it off a vendor file's `agencyid`
    // column. A drift between the two normalizations makes PAC-71's routing
    // miss silently.
    const typedByOperator = ' a0b9049 ';
    const fromMailerFile = 'A0B9049';
    expect(appointmentCodeKey(typedByOperator)).toBe(
      appointmentCodeKey(fromMailerFile),
    );
  });

  it('does not assume a format', () => {
    // Codes are carrier-specific: Allstate's is 7 alphanumerics, others are
    // numeric or longer, and some carry punctuation. Casing is the only thing
    // we are entitled to change.
    expect(appointmentCodeKey('123456')).toBe('123456');
    expect(appointmentCodeKey('tx-4471-a')).toBe('TX-4471-A');
    expect(appointmentCodeKey('00 12 34')).toBe('00 12 34');
  });

  it('keeps distinct codes distinct', () => {
    expect(appointmentCodeKey('A0B9049')).not.toBe(
      appointmentCodeKey('A0B9048'),
    );
  });
});
