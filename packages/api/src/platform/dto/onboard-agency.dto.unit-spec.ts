import {
  agencyAvailabilitySchema,
  onboardAgencySchema,
  toBranchSlug,
} from './onboard-agency.dto';

describe('onboardAgencySchema', () => {
  const valid = {
    agency: { name: 'Acme Insurance', slug: 'acme-insurance' },
    branch: { name: 'Main', address: {} },
    modules: ['leads'],
    owner: { firstName: 'Ada', lastName: 'Owner', email: 'ada@acme.test' },
  };

  it('accepts a well-formed body', () => {
    const parsed = onboardAgencySchema.parse(valid);
    expect(parsed.agency.slug).toBe('acme-insurance');
    expect(parsed.branch.name).toBe('Main');
  });

  it('defaults the branch to Main when it is omitted entirely', () => {
    const parsed = onboardAgencySchema.parse({ ...valid, branch: {} });
    expect(parsed.branch.name).toBe('Main');
    expect(parsed.branch.address).toEqual({});
  });

  it.each([
    ['a space', 'acme insurance'],
    ['uppercase', 'Acme'],
    ['a leading hyphen', '-acme'],
    ['a trailing hyphen', 'acme-'],
    ['a double hyphen', 'acme--insurance'],
    ['an underscore', 'acme_insurance'],
    ['one character', 'a'],
  ])('rejects a slug with %s', (_label, slug) => {
    const result = onboardAgencySchema.safeParse({
      ...valid,
      agency: { ...valid.agency, slug },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown module key', () => {
    const result = onboardAgencySchema.safeParse({
      ...valid,
      modules: ['not_a_module'],
    });
    expect(result.success).toBe(false);
  });

  /**
   * Not a rule the product has. An operator who wants a tenant with nothing
   * switched on can have one and toggle modules afterwards; refusing would be
   * inventing a constraint the module-entitlement screen does not enforce.
   */
  it('accepts an empty module list', () => {
    expect(
      onboardAgencySchema.parse({ ...valid, modules: [] }).modules,
    ).toEqual([]);
  });

  it('rejects a malformed owner email', () => {
    const result = onboardAgencySchema.safeParse({
      ...valid,
      owner: { ...valid.owner, email: 'not-an-email' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown field', () => {
    // zod strips rather than throws by default, which is what we want here —
    // the point is that the extra key never reaches the service.
    const parsed = onboardAgencySchema.parse({ ...valid, sneaky: true });
    expect(parsed).not.toHaveProperty('sneaky');
  });
});

describe('agencyAvailabilitySchema', () => {
  it('accepts an empty query — every parameter is optional', () => {
    expect(agencyAvailabilitySchema.parse({})).toEqual({});
  });

  it('accepts a partial query', () => {
    expect(agencyAvailabilitySchema.parse({ slug: 'acme' })).toEqual({
      slug: 'acme',
    });
  });
});

describe('toBranchSlug', () => {
  it.each([
    ['Main', 'main'],
    ['Downtown Office', 'downtown-office'],
    ['  North   Branch  ', 'north-branch'],
    ['St. Louis', 'st-louis'],
    ['Branch #2', 'branch-2'],
  ])('slugifies %j to %j', (name, expected) => {
    expect(toBranchSlug(name)).toBe(expected);
  });

  /**
   * `Branch.slug` is required and uniquely indexed per agency, so an empty
   * result would make the second such branch collide on `''`.
   */
  it('falls back to "main" when nothing slug-able survives', () => {
    expect(toBranchSlug('中央支店')).toBe('main');
    expect(toBranchSlug('---')).toBe('main');
  });

  it('produces hyphens, not the underscores role slugs use', () => {
    expect(toBranchSlug('Branch Manager Office')).not.toContain('_');
  });
});
