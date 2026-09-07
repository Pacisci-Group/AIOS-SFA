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

  /**
   * PAC-93. The operator may know which carrier appointed the agency without
   * knowing the code yet, so the pair must survive validation half-filled and
   * be dropped by the service — not rejected at the edge.
   */
  it('accepts a carrier appointment with no code yet', () => {
    const result = onboardAgencySchema.safeParse({
      ...valid,
      agency: {
        ...valid.agency,
        carrierAppointments: [{ carrierId: 'a'.repeat(24) }],
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a carrierId that is not an ObjectId', () => {
    // Caught here so it is a 400 naming the field rather than a 500 out of a
    // Mongoose cast.
    const result = onboardAgencySchema.safeParse({
      ...valid,
      agency: {
        ...valid.agency,
        carrierAppointments: [{ carrierId: 'Allstate' }],
      },
    });
    expect(result.success).toBe(false);
  });

  it('defaults the appointments to an empty list', () => {
    const result = onboardAgencySchema.parse(valid);
    expect(result.agency.carrierAppointments).toEqual([]);
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

describe('agencyAvailabilitySchema — carrier appointment (PAC-93)', () => {
  const carrierId = 'a'.repeat(24);

  it('accepts a carrier and code together', () => {
    const result = agencyAvailabilitySchema.safeParse({
      carrierId,
      carrierAgencyCode: 'A0B9049',
    });
    expect(result.success).toBe(true);
  });

  it('accepts neither', () => {
    expect(agencyAvailabilitySchema.safeParse({ slug: 'acme' }).success).toBe(
      true,
    );
  });

  it.each([
    ['a code with no carrier', { carrierAgencyCode: 'A0B9049' }],
    ['a carrier with no code', { carrierId }],
  ])('rejects %s', (_label, query) => {
    // A code means nothing outside its carrier, so half the pair is not a
    // question that has an answer.
    expect(agencyAvailabilitySchema.safeParse(query).success).toBe(false);
  });
});
