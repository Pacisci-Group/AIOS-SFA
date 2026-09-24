import {
  MAX_SEARCH_TOKENS,
  MAX_SEARCH_TERM_LENGTH,
  isPhoneLike,
  normalizeSearchText,
  searchDigits,
  searchTokens,
} from './search-terms';

describe('normalizeSearchText', () => {
  it('folds case and collapses whitespace', () => {
    expect(normalizeSearchText('  Karen   ANDERSON ')).toBe('karen anderson');
  });

  it('folds diacritics, so the ASCII spelling finds the accented record', () => {
    // Migrated SmartSuite data holds both spellings of several surnames.
    expect(normalizeSearchText('Muñoz')).toBe('munoz');
    expect(normalizeSearchText('José Peña')).toBe('jose pena');
  });

  it('turns punctuation into a separator rather than deleting it', () => {
    // `smithjones` would match neither half of the name.
    expect(normalizeSearchText('Smith-Jones')).toBe('smith jones');
    expect(normalizeSearchText('(918) 555-0134')).toBe('918 555 0134');
  });

  it('is empty when there is nothing searchable', () => {
    expect(normalizeSearchText('')).toBe('');
    expect(normalizeSearchText('   ')).toBe('');
    expect(normalizeSearchText('---')).toBe('');
    expect(normalizeSearchText(null)).toBe('');
    expect(normalizeSearchText(undefined)).toBe('');
    expect(normalizeSearchText(42)).toBe('');
  });

  it('bounds its own work regardless of what the caller passed', () => {
    const long = 'a'.repeat(MAX_SEARCH_TERM_LENGTH + 50);
    expect(normalizeSearchText(long)).toHaveLength(MAX_SEARCH_TERM_LENGTH);
  });
});

describe('searchTokens', () => {
  it('splits a full name so either order can match', () => {
    // The AND-of-ORs the API builds is what makes order irrelevant; here we
    // only assert the two halves survive as separate tokens.
    expect(searchTokens('John Smith')).toEqual(['john', 'smith']);
    expect(searchTokens('Smith John')).toEqual(['smith', 'john']);
  });

  it('keeps a bare surname as one token', () => {
    // Matched as a *contains*, this is what reaches a record stored as
    // `lastName: 'ANN SMITH'` — the mailer importer splits on the first space.
    expect(searchTokens('SMITH')).toEqual(['smith']);
  });

  it('tokenizes a cross-field query', () => {
    expect(searchTokens('smith tulsa')).toEqual(['smith', 'tulsa']);
  });

  it('keeps a bare number, so 147 can reach HH-2147', () => {
    expect(searchTokens('147')).toEqual(['147']);
  });

  it('deduplicates repeated words', () => {
    expect(searchTokens('smith Smith SMITH')).toEqual(['smith']);
  });

  it('caps fan-out instead of rejecting a pasted paragraph', () => {
    const many = 'one two three four five six seven';
    expect(searchTokens(many)).toHaveLength(MAX_SEARCH_TOKENS);
    expect(searchTokens(many)).toEqual(['one', 'two', 'three', 'four']);
  });

  it('is empty — never a filter nothing satisfies — for a cleared input', () => {
    // `?q=` is what a cleared box sends. Reading it as an impossible filter is
    // how a search box returns zero rows the moment you empty it.
    expect(searchTokens('')).toEqual([]);
    expect(searchTokens('   ')).toEqual([]);
    expect(searchTokens('!!!')).toEqual([]);
    expect(searchTokens(undefined)).toEqual([]);
  });
});

describe('searchDigits', () => {
  it('collapses every printed phone format to the same string', () => {
    expect(searchDigits('(918) 555-0134')).toBe('9185550134');
    expect(searchDigits('918-555-0134')).toBe('9185550134');
    expect(searchDigits('9185550134')).toBe('9185550134');
    expect(searchDigits('+1 918.555.0134')).toBe('19185550134');
  });

  it('is empty when there are no digits', () => {
    expect(searchDigits('smith')).toBe('');
    expect(searchDigits(null)).toBe('');
  });
});

describe('isPhoneLike', () => {
  it('accepts a local number without its area code', () => {
    expect(isPhoneLike('5550134')).toBe(true);
    expect(isPhoneLike('(918) 555-0134')).toBe(true);
  });

  it('rejects runs short enough to be a ZIP or a street number', () => {
    expect(isPhoneLike('74501')).toBe(false);
    expect(isPhoneLike('147')).toBe(false);
    expect(isPhoneLike('smith')).toBe(false);
  });

  it('is a hint, not a route — a phone-shaped term stays searchable as text', () => {
    // The Leads box used to `return` on this test, which is why a lead whose
    // quote control number was all digits became unreachable by name.
    expect(isPhoneLike('9185550134')).toBe(true);
    expect(searchTokens('9185550134')).toEqual(['9185550134']);
  });
});
