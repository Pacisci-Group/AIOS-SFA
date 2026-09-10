import {
  MATCHES_NOTHING,
  phoneDigitsRegex,
  tokenRegex,
  tokenizedOr,
  tokenizedOrAsync,
} from './search-filter';

const FIELDS = ['firstName', 'lastName', 'address.city'] as const;

/** The filter shape these helpers build, narrowed enough to assert against. */
type TokenizedFilter = {
  $and?: Array<{ $or: Array<Record<string, { $regex: string }>> }>;
} | null;

/** The regex each clause carries, sorted — `$and` itself is order-insensitive. */
function patternsOf(filter: unknown): string[] {
  const clauses = (filter as TokenizedFilter)?.$and ?? [];
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

describe('phoneDigitsRegex', () => {
  it('matches a stored number in whatever format it was saved in', () => {
    const pattern = new RegExp(phoneDigitsRegex('9185550134'));
    expect(pattern.test('(918) 555-0134')).toBe(true);
    expect(pattern.test('918-555-0134')).toBe(true);
    expect(pattern.test('918.555.0134')).toBe(true);
    expect(pattern.test('9185550134')).toBe(true);
  });

  it('does not match a different number', () => {
    const pattern = new RegExp(phoneDigitsRegex('9185550134'));
    expect(pattern.test('(918) 555-9999')).toBe(false);
  });
});

describe('tokenizedOr', () => {
  it('ANDs the tokens and ORs each across every field', () => {
    // The `smith tulsa` criterion: the two tokens match *different* fields.
    expect(tokenizedOr('smith tulsa', FIELDS)).toEqual({
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

  it('matches a full name in either order', () => {
    // `$and` is order-insensitive, so both queries select the same documents:
    // each demands a `john` hit and a `smith` hit, in any field.
    expect(patternsOf(tokenizedOr('John Smith', FIELDS))).toEqual([
      'john',
      'smith',
    ]);
    expect(patternsOf(tokenizedOr('Smith John', FIELDS))).toEqual([
      'john',
      'smith',
    ]);
  });

  it('is null — never MATCHES_NOTHING — for a cleared input', () => {
    // Clearing the box must list the first page, not empty the table.
    expect(tokenizedOr('', FIELDS)).toBeNull();
    expect(tokenizedOr('   ', FIELDS)).toBeNull();
    expect(tokenizedOr(undefined, FIELDS)).toBeNull();
  });

  it('caps fan-out at four tokens', () => {
    expect(
      tokenizedOr('one two three four five six', FIELDS)?.$and,
    ).toHaveLength(4);
  });
});

describe('tokenizedOrAsync', () => {
  /** Stands in for a capped child-collection lookup. */
  const contactBranch = (token: string) =>
    Promise.resolve(
      token === 'tulsa' ? { primaryContactId: { $in: ['c1'] } } : null,
    );

  it('adds a resolved branch to that token OR, without losing the fields', async () => {
    const filter = (await tokenizedOrAsync('tulsa', FIELDS, [
      contactBranch,
    ])) as TokenizedFilter;
    const or = filter?.$and?.[0]?.$or;
    expect(or).toHaveLength(FIELDS.length + 1);
    expect(or?.at(-1)).toEqual({ primaryContactId: { $in: ['c1'] } });
  });

  it('runs each resolver once per token', async () => {
    const seen: string[] = [];
    await tokenizedOrAsync('smith tulsa', FIELDS, [
      (token) => {
        seen.push(token);
        return Promise.resolve(null);
      },
    ]);
    expect(seen).toEqual(['smith', 'tulsa']);
  });

  it('a resolver finding nothing removes a branch, never the token', async () => {
    const filter = (await tokenizedOrAsync('smith', FIELDS, [
      contactBranch,
    ])) as TokenizedFilter;
    expect(filter?.$and?.[0]?.$or).toHaveLength(FIELDS.length);
  });

  it('is null for a cleared input, before any resolver runs', async () => {
    const resolver = jest.fn(() => Promise.resolve(null));
    expect(await tokenizedOrAsync('', FIELDS, [resolver])).toBeNull();
    expect(resolver).not.toHaveBeenCalled();
  });

  it('is MATCHES_NOTHING when a real query has nowhere left to match', async () => {
    // A supplied query with no fields and no resolved branches is a genuine
    // empty result, not "no filter".
    expect(await tokenizedOrAsync('smith', [], [])).toEqual(MATCHES_NOTHING);
  });
});
