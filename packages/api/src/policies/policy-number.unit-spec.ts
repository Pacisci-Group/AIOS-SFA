import {
  MIN_POLICY_NUMBER_KEY_LENGTH,
  normalizePolicyNumber,
  policyNumberKey,
} from './policy-number';

describe('policyNumberKey', () => {
  it('applies the same transform as normalizePolicyNumber', () => {
    expect(policyNumberKey('ABC-123-456')).toBe('ABC123456');
    expect(policyNumberKey('  abc 123 456 ')).toBe('ABC123456');
  });

  it('has no length floor — that is the whole reason it exists', () => {
    // PAC-56 #20: a carrier pattern tested against `null` silently passes, so
    // a short number would skip format validation entirely.
    expect(policyNumberKey('12')).toBe('12');
    expect(policyNumberKey('A-1')).toBe('A1');
    expect(normalizePolicyNumber('12')).toBeNull();
  });

  it('returns an empty string, never null, so callers can test it directly', () => {
    expect(policyNumberKey(undefined)).toBe('');
    expect(policyNumberKey(null)).toBe('');
    expect(policyNumberKey('---')).toBe('');
    expect(policyNumberKey(42 as unknown as string)).toBe('');
  });
});

describe('normalizePolicyNumber', () => {
  it('collapses the spellings a producer actually types', () => {
    // The whole point: these are one policy, however it was transcribed.
    const forms = [
      'ABC-123-456',
      'abc123456',
      'ABC 123 456',
      '  abc-123-456  ',
      'a.b.c.1.2.3.4.5.6',
    ];
    for (const form of forms) {
      expect(normalizePolicyNumber(form)).toBe('ABC123456');
    }
  });

  it('is idempotent, so a stored key re-normalizes to itself', () => {
    const key = normalizePolicyNumber('ABC-123-456');
    expect(normalizePolicyNumber(key)).toBe(key);
  });

  it('returns null for input too short to be meaningful', () => {
    // A 2-character "match" is noise, and noisy warnings get dismissed.
    expect(normalizePolicyNumber('12')).toBeNull();
    expect(normalizePolicyNumber('A-1')).toBeNull();
    expect(normalizePolicyNumber('---')).toBeNull();
  });

  it('accepts exactly the minimum length', () => {
    const atLimit = 'A'.repeat(MIN_POLICY_NUMBER_KEY_LENGTH);
    expect(normalizePolicyNumber(atLimit)).toBe(atLimit);
  });

  it('returns null rather than throwing on nullish or non-string input', () => {
    expect(normalizePolicyNumber(undefined)).toBeNull();
    expect(normalizePolicyNumber(null)).toBeNull();
    expect(normalizePolicyNumber('')).toBeNull();
    expect(normalizePolicyNumber('   ')).toBeNull();
    expect(normalizePolicyNumber(42 as unknown as string)).toBeNull();
  });

  it('keeps distinct policies distinct', () => {
    expect(normalizePolicyNumber('ABC123')).not.toBe(
      normalizePolicyNumber('ABC124'),
    );
  });
});
