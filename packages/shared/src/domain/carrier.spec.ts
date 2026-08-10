import {
  CARRIER_OTHER,
  carrierPolicyNumberMatches,
  carrierSlug,
  normalizeCarrier,
} from './carrier';

describe('carrierSlug', () => {
  it('collapses the spellings that mean the same carrier', () => {
    expect(carrierSlug('Allstate')).toBe('allstate');
    expect(carrierSlug('  ALLSTATE  ')).toBe('allstate');
    expect(carrierSlug('State Farm')).toBe('state-farm');
    expect(carrierSlug('Auto-Owners')).toBe('auto-owners');
    expect(carrierSlug('Auto Owners')).toBe('auto-owners');
  });

  it('never leaves a leading or trailing hyphen', () => {
    expect(carrierSlug('  The Hartford!  ')).toBe('the-hartford');
    expect(carrierSlug('...')).toBe('');
  });

  it('keeps distinct carriers distinct', () => {
    expect(carrierSlug('Safeco')).not.toBe(carrierSlug('Liberty Mutual'));
  });
});

describe('normalizeCarrier', () => {
  it('maps the one legacy SmartSuite code we have', () => {
    // Migrated policies stored the raw choice code and rendered it to users.
    expect(normalizeCarrier('B4tEH')).toBe('Allstate');
  });

  it('passes an uncatalogued name through, trimmed', () => {
    expect(normalizeCarrier('  Shelter Insurance ')).toBe('Shelter Insurance');
  });

  it('returns an empty string for nothing', () => {
    expect(normalizeCarrier(undefined)).toBe('');
    expect(normalizeCarrier(null)).toBe('');
    expect(normalizeCarrier('   ')).toBe('');
  });
});

describe('carrierPolicyNumberMatches', () => {
  const digitsOnly = '\\d+';

  it('accepts a number satisfying the rule', () => {
    expect(carrierPolicyNumberMatches(digitsOnly, '123456789')).toBe(true);
  });

  it('rejects one that does not', () => {
    expect(carrierPolicyNumberMatches(digitsOnly, 'AB123456')).toBe(false);
  });

  it('anchors the stored pattern', () => {
    // The pattern is stored unanchored on purpose; anchoring at the point of
    // use is what stops "contains a valid number" from passing.
    expect(carrierPolicyNumberMatches(digitsOnly, '123ABC')).toBe(false);
    expect(carrierPolicyNumberMatches(digitsOnly, 'ABC123')).toBe(false);
  });

  it('treats an absent pattern as no constraint', () => {
    expect(carrierPolicyNumberMatches(null, 'ANYTHING')).toBe(true);
    expect(carrierPolicyNumberMatches(undefined, 'ANYTHING')).toBe(true);
    expect(carrierPolicyNumberMatches('', 'ANYTHING')).toBe(true);
  });

  it('passes rather than throws on an unparseable pattern', () => {
    // A regex that will not compile is a seeding bug. Blocking a real sale over
    // it would be the wrong trade.
    expect(carrierPolicyNumberMatches('[unclosed', '123')).toBe(true);
  });

  it('rejects an empty key against a rule that requires characters', () => {
    expect(carrierPolicyNumberMatches(digitsOnly, '')).toBe(false);
  });
});

describe('CARRIER_OTHER', () => {
  it('cannot collide with a real carrier name', () => {
    // The sentinel lives in form state and is swapped out before submission;
    // the API rejects it outright. Both rely on it being unmistakable.
    expect(CARRIER_OTHER).toBe('__other__');
    expect(carrierSlug(CARRIER_OTHER)).toBe('other');
    expect(CARRIER_OTHER).not.toBe('Other');
  });
});
