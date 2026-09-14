import { searchDigits } from '@sfa/shared';
import {
  MATCHES_NOTHING,
  addressPaths,
  buildSearchFilter,
  phoneDigitsRegex,
  tokenRegex,
} from './search-filter';

const FIELDS = ['firstName', 'lastName', 'address.city'] as const;

/** The filter shape these helpers build, narrowed enough to assert against. */
type Clause = { $or: Array<Record<string, { $regex: string }>> };
type Built = {
  $and?: Clause[];
  $or?: Array<{ $and?: Clause[] } & Record<string, unknown>>;
} | null;

/** The regex each token clause carries, sorted — `$and` is order-insensitive. */
function patternsOf(filter: unknown): string[] {
  const clauses = (filter as Built)?.$and ?? [];
  return clauses.map((clause) => clause.$or[0].firstName.$regex).sort();
}

describe('tokenRegex', () => {
  it('is an unanchored, case-insensitive contains', () => {
    expect(tokenRegex('smith')).toEqual({ $regex: 'smith', $options: 'i' });
  });

  it('escapes a term so it cannot compile as a pattern', () => {
    // Without this, `a.b` matches `axb` and `(` is a 500.
    expect(tokenRegex('a.b(').$regex).toBe('a\\.b\\(');
  });
});

describe('addressPaths', () => {
  it('expands a root into the four sub-fields', () => {
    expect(addressPaths('address')).toEqual([
      'address.street',
      'address.city',
      'address.state',
      'address.zip',
    ]);
  });
});

describe('phoneDigitsRegex', () => {
  it('matches a stored number in whatever format it was saved in', () => {
    const pattern = new RegExp(phoneDigitsRegex('9185550134'));
    expect(pattern.test('(918) 555-0134')).toBe(true);
    expect(pattern.test('918-555-0134')).toBe(true);
    expect(pattern.test('918.555.0134')).toBe(true);
    expect(pattern.test('9185550134')).toBe(true);
  });

  it('does not match a different number', () => {
    expect(
      new RegExp(phoneDigitsRegex('9185550134')).test('(918) 555-9999'),
    ).toBe(false);
  });
});

describe('buildSearchFilter — token clause', () => {
  it('ANDs the tokens and ORs each across every field', async () => {
    // The `smith tulsa` criterion: the two tokens match *different* fields.
    expect(await buildSearchFilter('smith tulsa', { fields: FIELDS })).toEqual({
      $and: [
        {
          $or: [
            { firstName: { $regex: 'smith', $options: 'i' } },
            { lastName: { $regex: 'smith', $options: 'i' } },
            { 'address.city': { $regex: 'smith', $options: 'i' } },
          ],
        },
        {
          $or: [
            { firstName: { $regex: 'tulsa', $options: 'i' } },
            { lastName: { $regex: 'tulsa', $options: 'i' } },
            { 'address.city': { $regex: 'tulsa', $options: 'i' } },
          ],
        },
      ],
    });
  });

  it('matches a full name in either order', async () => {
    // `$and` is order-insensitive, so both queries select the same documents.
    expect(
      patternsOf(await buildSearchFilter('John Smith', { fields: FIELDS })),
    ).toEqual(['john', 'smith']);
    expect(
      patternsOf(await buildSearchFilter('Smith John', { fields: FIELDS })),
    ).toEqual(['john', 'smith']);
  });

  it('is null — never MATCHES_NOTHING — for a cleared input', async () => {
    // Clearing the box must list the first page, not empty the table.
    expect(await buildSearchFilter('', { fields: FIELDS })).toBeNull();
    expect(await buildSearchFilter('   ', { fields: FIELDS })).toBeNull();
    expect(await buildSearchFilter(undefined, { fields: FIELDS })).toBeNull();
  });

  it('caps fan-out at four tokens', async () => {
    const filter = (await buildSearchFilter('one two three four five six', {
      fields: FIELDS,
    })) as Built;
    expect(filter?.$and).toHaveLength(4);
  });
});

describe('buildSearchFilter — token branches', () => {
  const contactBranch = (token: string) =>
    Promise.resolve(
      token === 'tulsa' ? { primaryContactId: { $in: ['c1'] } } : null,
    );

  it('adds a resolved branch to that token OR, without losing the fields', async () => {
    const filter = (await buildSearchFilter('tulsa', {
      fields: FIELDS,
      tokenBranches: [contactBranch],
    })) as Built;
    const or = filter?.$and?.[0]?.$or;
    expect(or).toHaveLength(FIELDS.length + 1);
    expect(or?.at(-1)).toEqual({ primaryContactId: { $in: ['c1'] } });
  });

  it('runs each token branch once per token', async () => {
    const seen: string[] = [];
    await buildSearchFilter('smith tulsa', {
      fields: FIELDS,
      tokenBranches: [
        (token) => {
          seen.push(token);
          return Promise.resolve(null);
        },
      ],
    });
    expect(seen).toEqual(['smith', 'tulsa']);
  });

  it('a branch finding nothing removes a branch, never the token', async () => {
    const filter = (await buildSearchFilter('smith', {
      fields: FIELDS,
      tokenBranches: [contactBranch],
    })) as Built;
    expect(filter?.$and?.[0]?.$or).toHaveLength(FIELDS.length);
  });

  it('does not run any resolver for a cleared input', async () => {
    const resolver = jest.fn(() => Promise.resolve(null));
    expect(
      await buildSearchFilter('', {
        fields: FIELDS,
        tokenBranches: [resolver],
      }),
    ).toBeNull();
    expect(resolver).not.toHaveBeenCalled();
  });

  it('is MATCHES_NOTHING when a real query has nowhere left to match', async () => {
    expect(await buildSearchFilter('smith', { fields: [] })).toEqual(
      MATCHES_NOTHING,
    );
  });
});

describe('buildSearchFilter — whole-term branches', () => {
  /**
   * The case that forced term branches to exist: normalization splits a printed
   * phone number into three tokens, none of them phone-shaped, and no field
   * holds all three. Only the raw term can answer it.
   */
  const phoneBranch = (raw: string) => {
    const digits = searchDigits(raw);
    return Promise.resolve(
      digits.length >= 7
        ? { phone: { $regex: phoneDigitsRegex(digits) } }
        : null,
    );
  };

  it.each(['(918) 555-0134', '918-555-0134', '9185550134', '918.555.0134'])(
    'resolves %s to the same phone branch',
    async (typed) => {
      const filter = (await buildSearchFilter(typed, {
        fields: FIELDS,
        termBranches: [phoneBranch],
      })) as Built;
      const branch = filter?.$or?.at(-1) as { phone: { $regex: string } };
      expect(branch.phone.$regex).toBe(phoneDigitsRegex('9185550134'));
    },
  );

  it('ORs the term branch around the token clause, not inside it', async () => {
    const filter = (await buildSearchFilter('9185550134', {
      fields: FIELDS,
      termBranches: [phoneBranch],
    })) as Built;
    // Either every token matches, or the whole term is that phone number.
    expect(filter?.$or).toHaveLength(2);
    expect(filter?.$or?.[0]).toHaveProperty('$and');
  });

  it('leaves the token clause alone when no term branch resolves', async () => {
    const filter = (await buildSearchFilter('smith', {
      fields: FIELDS,
      termBranches: [phoneBranch],
    })) as Built;
    expect(filter?.$or).toBeUndefined();
    expect(filter?.$and).toHaveLength(1);
  });

  it('answers on the term branch alone when the tokens have no fields', async () => {
    // A phone-only search surface: nothing to match by name, but the number
    // still resolves.
    const filter = (await buildSearchFilter('9185550134', {
      fields: [],
      termBranches: [phoneBranch],
    })) as Built;
    expect(filter).toEqual({
      phone: { $regex: phoneDigitsRegex('9185550134') },
    });
  });
});
