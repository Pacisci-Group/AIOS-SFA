import {
  carriedAssignment,
  carriedOutcome,
  carriedReview,
  type CarriedRow,
  type PreviousRowReview,
  type RowOutcome,
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
        outcome: null,
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

describe('carriedOutcome', () => {
  const assignment = {
    userId: 'u-pat',
    assignedById: 'u-owner',
    assignedAt: new Date('2026-10-03T09:00:00Z'),
    note: null,
  };
  const outcome = (overrides: Partial<RowOutcome> = {}): RowOutcome => ({
    kind: 'sold',
    status: 'in_progress',
    step: 'record_sale',
    note: null,
    leadId: 'l1',
    dealId: null,
    policyId: null,
    householdId: null,
    replacementPolicyId: null,
    chargebackId: null,
    startedById: 'u-pat',
    startedAt: new Date('2026-10-04T09:00:00Z'),
    completedById: null,
    completedAt: null,
    ...overrides,
  });

  it('keeps an unfinished outcome with its assignee, so they resume where they were', () => {
    const inProgress = outcome();
    expect(
      carriedOutcome(
        { ...row, issues: [...row.issues] },
        previous({
          status: 'open',
          resolution: null,
          assignment,
          outcome: inProgress,
        }),
      ),
    ).toEqual(inProgress);
  });

  it('carries a finished outcome with the decision it resolved the row with', () => {
    const done = outcome({
      kind: 'other',
      status: 'done',
      step: null,
      note: 'Client cancelled before issue',
      leadId: null,
      completedById: 'u-pat',
      completedAt: new Date('2026-10-04T10:00:00Z'),
    });
    const before = previous({
      resolution: 'other_recorded',
      reviewedById: 'u-pat',
      assignment,
      outcome: done,
    });
    const same = { ...row, issues: [...row.issues] };

    expect(carriedOutcome(same, before)).toEqual(done);
    // An outcome resolution is not retired: the decision carries alongside.
    expect(carriedReview(same, before)?.resolution).toBe('other_recorded');
  });

  it('starts a row whose classification changed with no outcome', () => {
    expect(
      carriedOutcome(
        { ...row, match: 'matched', issues: [...row.issues] },
        previous({
          status: 'open',
          resolution: null,
          assignment,
          outcome: outcome(),
        }),
      ),
    ).toBeNull();
    expect(
      carriedOutcome(
        { ...row, issues: ['no_bind_id'] },
        previous({
          status: 'open',
          resolution: null,
          assignment,
          outcome: outcome(),
        }),
      ),
    ).toBeNull();
  });

  it('is null when nobody recorded one', () => {
    expect(
      carriedOutcome({ ...row, issues: [...row.issues] }, previous()),
    ).toBeNull();
  });

  // PAC-173 PR 5: the line now matches the policy its service intake created.
  describe('a 1-800 line set up for service since', () => {
    const serviced = outcome({
      kind: 'service_intake',
      status: 'done',
      step: null,
      leadId: null,
      policyId: 'p-direct',
      householdId: 'h1',
      csrId: 'u-casey',
      onboardingId: 'o1',
      ticketId: 't1',
      completedById: 'u-pat',
      completedAt: new Date('2026-10-04T09:01:00Z'),
    });
    const before = () =>
      previous({
        match: 'dash_only',
        issues: ['not_staff_bind_id'],
        status: 'resolved',
        resolution: 'service_intake_recorded',
        assignment,
        outcome: serviced,
      });
    const matchedNow: CarriedRow = {
      ...row,
      match: 'matched',
      issues: ['direct_1800', 'not_staff_bind_id'],
      app: { policyId: 'p-direct', origin: 'carrier_direct' },
      needsReview: false,
    };

    it('carries the finished outcome, its decision and its assignee', () => {
      expect(carriedOutcome(matchedNow, before())).toEqual(serviced);
      expect(carriedReview(matchedNow, before())?.resolution).toBe(
        'service_intake_recorded',
      );
      expect(carriedAssignment(matchedNow, before())).toEqual(assignment);
    });

    it('only when the line matched the very policy it created', () => {
      expect(
        carriedOutcome(
          {
            ...matchedNow,
            app: { policyId: 'p-other', origin: 'carrier_direct' },
          },
          before(),
        ),
      ).toBeNull();
      expect(
        carriedOutcome(
          { ...matchedNow, app: { policyId: 'p-direct', origin: null } },
          before(),
        ),
      ).toBeNull();
    });

    it('not onto a row that asks something new — a premium Dash now disagrees on', () => {
      const premiumOff: CarriedRow = {
        ...matchedNow,
        issues: ['direct_1800', 'not_staff_bind_id', 'premium_mismatch'],
        needsReview: true,
      };
      expect(carriedOutcome(premiumOff, before())).toBeNull();
      expect(carriedReview(premiumOff, before())).toBeNull();
    });

    it('an unfinished one travels too, so its welcome call can still be opened', () => {
      const pending = {
        ...serviced,
        status: 'in_progress' as const,
        step: 'start_onboarding' as const,
        onboardingId: null,
        ticketId: null,
        completedById: null,
        completedAt: null,
      };
      const waiting = previous({
        match: 'dash_only',
        issues: ['not_staff_bind_id'],
        status: 'open',
        resolution: null,
        assignment,
        outcome: pending,
      });
      expect(carriedOutcome(matchedNow, waiting)).toEqual(pending);
      expect(carriedAssignment(matchedNow, waiting)).toEqual(assignment);
      // Nothing was decided: the new row asks again.
      expect(carriedReview(matchedNow, waiting)).toBeNull();
    });
  });
});
