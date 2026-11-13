import type { RowOutcome } from './carry-forward';
import { HELD_OPEN_OUTCOME, hasBooked, isHeldOpen } from './outcome-state';

/**
 * Evaluates the two operators `HELD_OPEN_OUTCOME` uses — equality, `$or` and
 * `$type: 'string'` — against a row, the way MongoDB would. Enough to pin the
 * filter to its JS twin; a new operator in the filter fails here first.
 */
function matches(filter: Record<string, unknown>, doc: unknown): boolean {
  return Object.entries(filter).every(([key, expected]) => {
    if (key === '$or') {
      return (expected as Record<string, unknown>[]).some((branch) =>
        matches(branch, doc),
      );
    }
    const value = key
      .split('.')
      .reduce<unknown>(
        (at, part) =>
          at && typeof at === 'object'
            ? (at as Record<string, unknown>)[part]
            : undefined,
        doc,
      );
    if (expected && typeof expected === 'object' && '$type' in expected) {
      return typeof value === 'string';
    }
    return value === expected;
  });
}

const base: RowOutcome = {
  kind: 'cancel_rewrite',
  status: 'in_progress',
  step: 'record_sale',
  note: null,
  leadId: null,
  dealId: null,
  policyId: null,
  householdId: null,
  replacementPolicyId: null,
  chargebackId: null,
  startedById: 'u1',
  startedAt: new Date('2026-11-01T00:00:00Z'),
  completedById: null,
  completedAt: null,
};

const cases: [string, RowOutcome | null][] = [
  ['no outcome', null],
  ['a sale not booked yet', base],
  ['a sale not booked yet, lead made', { ...base, leadId: 'l1' }],
  ['a sale held on its policy number', { ...base, leadId: 'l1', dealId: 'd1' }],
  [
    'a cancel rewrite waiting on its replacement',
    {
      ...base,
      step: 'write_replacement',
      leadId: 'l1',
      dealId: 'd1',
      policyId: 'p1',
    },
  ],
  [
    'a finished sale',
    {
      ...base,
      kind: 'sold',
      status: 'done',
      step: null,
      dealId: 'd1',
      policyId: 'p1',
    },
  ],
  ['other', { ...base, kind: 'other', status: 'done', step: null }],
];

describe('outcome state', () => {
  it.each(cases)('the filter agrees with isHeldOpen for %s', (_label, o) => {
    expect(matches(HELD_OPEN_OUTCOME, { outcome: o })).toBe(isHeldOpen(o));
  });

  it('holds open only what is under way and booked', () => {
    expect(cases.filter(([, o]) => isHeldOpen(o)).map(([l]) => l)).toEqual([
      'a sale held on its policy number',
      'a cancel rewrite waiting on its replacement',
    ]);
  });

  it('counts a finished sale as booked', () => {
    expect(hasBooked(cases[5][1])).toBe(true);
    expect(hasBooked(base)).toBe(false);
  });
});
