import { parseSearchDate, routeSearchTerm } from './search-routing';

describe('routeSearchTerm', () => {
  it('routes nothing for a blank term', () => {
    expect(routeSearchTerm('')).toEqual({});
    expect(routeSearchTerm('   ')).toEqual({});
  });

  describe('household references', () => {
    it.each(['HH-2614', 'hh-2614', '#HH2614', 'HH2614', 'HH-0002614'])(
      'canonicalizes %s to HH-2614',
      (term) => {
        expect(routeSearchTerm(term).householdRef).toBe('HH-2614');
      },
    );

    it('does not also search a reference as a name', () => {
      // `1985` would otherwise regex-scan every household name for nothing.
      expect(routeSearchTerm('HH-2614').name).toBeUndefined();
    });
  });

  describe('dates of birth', () => {
    it('accepts the ISO form', () => {
      expect(routeSearchTerm('1985-03-12').dateOfBirth).toEqual(
        new Date(Date.UTC(1985, 2, 12)),
      );
    });

    it('accepts the MM/DD/YYYY an American agency types', () => {
      expect(routeSearchTerm('03/12/1985').dateOfBirth).toEqual(
        new Date(Date.UTC(1985, 2, 12)),
      );
    });

    it('accepts a single-digit month and day', () => {
      expect(routeSearchTerm('3/9/1974').dateOfBirth).toEqual(
        new Date(Date.UTC(1974, 2, 9)),
      );
    });

    it('rejects an impossible date rather than rolling it over', () => {
      // `Date.UTC(2025, 1, 30)` would silently become March 2nd.
      expect(routeSearchTerm('2025-02-30').dateOfBirth).toBeUndefined();
    });

    it('does not also search a date as a name', () => {
      expect(routeSearchTerm('1985-03-12').name).toBeUndefined();
    });
  });

  describe('policy numbers', () => {
    it('normalizes separators and case away', () => {
      expect(routeSearchTerm('as 123-4567').policyKey).toBe('AS1234567');
    });

    it('ignores a term too short to carry information', () => {
      // Two unrelated policies numbered `12` tell a producer nothing.
      expect(routeSearchTerm('ab').policyKey).toBeUndefined();
    });
  });

  describe('names', () => {
    it('routes an ordinary word to names', () => {
      expect(routeSearchTerm('mcdonald').name).toBe('mcdonald');
    });

    it('trims before routing', () => {
      expect(routeSearchTerm('  mcdonald  ').name).toBe('mcdonald');
    });

    it('is additive — a name long enough to be a policy key searches both', () => {
      // Neither dimension excludes the other; whichever matches wins.
      const routes = routeSearchTerm('mcdonald');
      expect(routes.name).toBe('mcdonald');
      expect(routes.policyKey).toBe('MCDONALD');
    });

    it('searches a reference as a policy number too', () => {
      const routes = routeSearchTerm('HH-2614');
      expect(routes.householdRef).toBe('HH-2614');
      expect(routes.policyKey).toBe('HH2614');
    });
  });
});

describe('parseSearchDate', () => {
  /*
   * The whole point of routing dates through `parseDateOfBirth`: the stored
   * value is UTC midnight, and a date built through the local timezone lands a
   * day early for anyone west of Greenwich — which is the entire agency.
   */
  it('lands on UTC midnight, not local midnight', () => {
    const parsed = parseSearchDate('1985-03-12');
    expect(parsed?.toISOString()).toBe('1985-03-12T00:00:00.000Z');
  });

  it('agrees on both input formats', () => {
    expect(parseSearchDate('03/12/1985')).toEqual(
      parseSearchDate('1985-03-12'),
    );
  });

  it('returns null for a term that is not a date', () => {
    expect(parseSearchDate('mcdonald')).toBeNull();
    expect(parseSearchDate('HH-2614')).toBeNull();
  });
});
