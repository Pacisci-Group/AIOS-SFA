import { carriedReview, type PreviousRowReview } from './carry-forward';

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
