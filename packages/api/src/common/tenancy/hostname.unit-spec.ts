import {
  isValidHostname,
  normalizeHostname,
  RESERVED_SUBDOMAIN_LABELS,
  subdomainLabelOf,
} from './hostname';

const BASE = 'smithfamily.agency';

describe('normalizeHostname', () => {
  it('lowercases', () => {
    expect(normalizeHostname('TexasHoldings.COM')).toBe('texasholdings.com');
  });

  it('strips the port', () => {
    // The dev stack runs on :5173 and :4000, so an unstripped port would make
    // every locally-mapped tenant host miss.
    expect(normalizeHostname('texasholdings.sfa.local:5173')).toBe(
      'texasholdings.sfa.local',
    );
  });

  it('strips a scheme and path an owner pasted from the address bar', () => {
    expect(normalizeHostname('https://texasholdings.com/login')).toBe(
      'texasholdings.com',
    );
  });

  it('strips the trailing root dot', () => {
    expect(normalizeHostname('texasholdings.com.')).toBe('texasholdings.com');
  });

  it('unwraps a bracketed IPv6 literal and drops its port', () => {
    expect(normalizeHostname('[::1]:4000')).toBe('::1');
  });

  it.each([undefined, null, '', '   ', 'https://', '[::1'])(
    'returns null for %p',
    (input) => {
      expect(normalizeHostname(input)).toBeNull();
    },
  );

  it('rejects a name longer than the DNS limit', () => {
    expect(normalizeHostname(`${'a'.repeat(254)}.com`)).toBeNull();
  });
});

describe('isValidHostname', () => {
  it.each(['texasholdings.com', 'a.b.c.example.co.uk', 'x-1.example.com'])(
    'accepts %s',
    (host) => {
      expect(isValidHostname(host)).toBe(true);
    },
  );

  it('rejects a single label', () => {
    // Not resolvable on the public internet — accepting it would create a row
    // that can never verify.
    expect(isValidHostname('texasholdings')).toBe(false);
  });

  it.each([
    '-lead.example.com',
    'trail-.example.com',
    'under_score.example.com',
    'double..dot.com',
    `${'a'.repeat(64)}.example.com`,
  ])('rejects %s', (host) => {
    expect(isValidHostname(host)).toBe(false);
  });
});

describe('subdomainLabelOf', () => {
  it('returns the label for a direct child', () => {
    expect(subdomainLabelOf(`texasholdings.${BASE}`, BASE)).toBe(
      'texasholdings',
    );
  });

  it('returns null for an unrelated domain', () => {
    expect(subdomainLabelOf('texasholdings.com', BASE)).toBeNull();
  });

  it('returns null for the base domain itself', () => {
    expect(subdomainLabelOf(BASE, BASE)).toBeNull();
  });

  it('returns null two levels deep', () => {
    // A single `*.smithfamily.agency` certificate matches exactly one label.
    // Allowing this would produce a domain that activates and then fails TLS.
    expect(subdomainLabelOf(`a.b.${BASE}`, BASE)).toBeNull();
  });

  it('rejects a suffix match that is not a label boundary', () => {
    expect(subdomainLabelOf(`evil-${BASE}`, BASE)).toBeNull();
  });
});

describe('RESERVED_SUBDOMAIN_LABELS', () => {
  it('reserves the platform host label', () => {
    // Handing `app` to a tenant locks every super admin out of the platform.
    expect(RESERVED_SUBDOMAIN_LABELS.has('app')).toBe(true);
  });

  it.each(['admin', 'api', 'www', 'mail', 'support'])(
    'reserves %s',
    (label) => {
      expect(RESERVED_SUBDOMAIN_LABELS.has(label)).toBe(true);
    },
  );

  it('leaves an ordinary agency name available', () => {
    expect(RESERVED_SUBDOMAIN_LABELS.has('texasholdings')).toBe(false);
  });
});
