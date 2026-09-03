import { listHouseholdsSchema } from './list-households.dto';

const parse = (query: Record<string, unknown>) =>
  listHouseholdsSchema.parse(query);

describe('listHouseholdsSchema', () => {
  it('defaults to the first page, sorted by name', () => {
    expect(parse({})).toEqual({ page: 1, pageSize: 50, sort: 'name' });
  });

  it('coerces the numeric params, which arrive as strings', () => {
    const parsed = parse({ page: '3', pageSize: '25' });
    expect(parsed.page).toBe(3);
    expect(parsed.pageSize).toBe(25);
  });

  it('caps pageSize so a client cannot ask for the whole book', () => {
    expect(() => parse({ pageSize: '500' })).toThrow();
  });

  /*
   * `?firstName=` is what a cleared input sends. Left as an empty string it
   * reads as a filter every contact satisfies, so clearing one field would
   * return the first 500 households in the agency as if they had all matched.
   */
  describe('blank means absent, not "matches everything"', () => {
    it.each([
      'q',
      'firstName',
      'lastName',
      'householdRef',
      'policyNumber',
      'dateOfBirth',
    ])('drops a blank %s', (field) => {
      expect(parse({ [field]: '' })[field as 'q']).toBeUndefined();
    });

    it('drops a whitespace-only term', () => {
      expect(parse({ firstName: '   ' }).firstName).toBeUndefined();
    });
  });

  it('trims a real term', () => {
    expect(parse({ firstName: '  Jane  ' }).firstName).toBe('Jane');
  });

  describe('dateOfBirth', () => {
    it('accepts the ISO shape', () => {
      expect(parse({ dateOfBirth: '1985-03-12' }).dateOfBirth).toBe(
        '1985-03-12',
      );
    });

    it('rejects any other shape with a 400 rather than an empty result', () => {
      expect(() => parse({ dateOfBirth: '03/12/1985' })).toThrow();
      expect(() => parse({ dateOfBirth: 'yesterday' })).toThrow();
    });
  });

  describe('status', () => {
    it('accepts a single value', () => {
      expect(parse({ status: 'Active' }).status).toEqual(['Active']);
    });

    it('accepts the comma-separated and repeated forms alike', () => {
      expect(parse({ status: 'Active,Inactive' }).status).toEqual([
        'Active',
        'Inactive',
      ]);
      expect(parse({ status: ['Active', 'Inactive'] }).status).toEqual([
        'Active',
        'Inactive',
      ]);
    });

    it('treats a cleared filter as no filter, never an empty $in', () => {
      expect(parse({ status: '' }).status).toBeUndefined();
    });

    it('rejects a value outside the vocabulary', () => {
      expect(() => parse({ status: 'Lapsed' })).toThrow();
    });
  });

  it('rejects an unknown sort', () => {
    expect(() => parse({ sort: 'premium' })).toThrow();
  });
});
