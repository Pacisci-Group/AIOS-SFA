import {
  carriedAssignment,
  carriedReview,
  type PreviousRowReview,
} from './carry-forward';

const previous = (overrides: Partial<PreviousRowReview> = {}) =>
  new Map<string, PreviousRowReview>([
    [
      'dash:900000001:new:2026-09-02',
      {
        rowId: 'r1',
        match: 'dash_only',
        issues: ['unmapped_producer', 'no_bind_id'],
        status: 'resolved',
        resolution: 'not_ours',
        note: 'Checked with Pat',
        reviewedById: 'u-owner',
        reviewedAt: new Date('2026-10-02T12:00:00Z'),
        assignment: null,
        ...overrides,
      },
    ],
  ]);

const row = {
  rowKey: 'dash:900000001:new:2026-09-02',
  match: 'dash_only' as const,
  issues: ['no_bind_id', 'unmapped_producer'] as const,
};

describe('carriedReview', () => {
  it('carries a decision to a row that still says the same thing', () => {
    expect(
      carriedReview({ ...row, issues: [...row.issues] }, previous())?.rowId,
    ).toBe('r1');
  });

  it('reopens a row whose match changed', () => {
    expect(
      carriedReview(
        { ...row, match: 'matched', issues: [...row.issues] },
        previous(),
      ),
    ).toBeNull();
  });

  it('reopens a row whose issues changed', () => {
    expect(
      carriedReview({ ...row, issues: ['no_bind_id'] }, previous()),
    ).toBeNull();
  });

  it('reopens a row decided with a resolution no longer offered', () => {
    expect(
      carriedReview(
        { ...row, issues: [...row.issues] },
        previous({ resolution: 'confirmed_1800' }),
      ),
    ).toBeNull();
  });

  it('never carries an open row', () => {
    expect(
      carriedReview(
        { ...row, issues: [...row.issues] },
        previous({ status: 'open' }),
      ),
    ).toBeNull();
  });
});

describe('carriedAssignment', () => {
  const assignment = {
    userId: 'u-pat',
    assignedById: 'u-owner',
    assignedAt: new Date('2026-10-03T09:00:00Z'),
    note: 'Enter the deal',
  };

  it('keeps the row with the same person when it still says the same thing', () => {
    expect(
      carriedAssignment(
        { ...row, issues: [...row.issues] },
        previous({ status: 'open', resolution: null, assignment }),
      ),
    ).toEqual(assignment);
  });

  it('starts a row whose classification changed with nobody on it', () => {
    expect(
      carriedAssignment(
        { ...row, issues: ['no_bind_id'] },
        previous({ status: 'open', resolution: null, assignment }),
      ),
    ).toBeNull();
    expect(
      carriedAssignment(
        { ...row, match: 'matched', issues: [...row.issues] },
        previous({ assignment }),
      ),
    ).toBeNull();
  });

  it('is null when the row was never assigned', () => {
    expect(
      carriedAssignment({ ...row, issues: [...row.issues] }, previous()),
    ).toBeNull();
  });
});
