import {
  AUDIT_ITEM_VERDICTS,
  DEAL_AUDIT_QUEUE_RANGE_KEYS,
  DEAL_AUDIT_QUEUE_SORTS,
  DEAL_AUDIT_QUEUE_SORT_LABELS,
  DEAL_AUDIT_QUEUE_STATUSES,
  DEAL_AUDIT_QUEUE_STATUS_LABELS,
  approveBlockers,
  isProducerActionable,
  reviewCounts,
} from './deal-audit-review';
import type { AuditItemVerdict } from './deal-audit-review';

const item = (id: string, verdict: AuditItemVerdict | null) => ({
  id,
  itemName: `Item ${id}`,
  review: { verdict },
});

/**
 * The manager's review (PAC-106).
 *
 * These rules are shared on purpose: the API's 409 and the page's disabled
 * Approve button both come from `approveBlockers`, and the producer board's
 * filter has a Mongo twin of `isProducerActionable` (`audit-counters.ts`).
 */
describe('deal audit review vocabulary', () => {
  it('has exactly two verdicts; "not reviewed" is null, never a third value', () => {
    expect(AUDIT_ITEM_VERDICTS).toEqual(['pass', 'fail']);
  });

  it('labels every queue status', () => {
    for (const status of DEAL_AUDIT_QUEUE_STATUSES) {
      expect(DEAL_AUDIT_QUEUE_STATUS_LABELS[status].length).toBeGreaterThan(0);
    }
  });

  it('defaults the queue to everything but approved', () => {
    expect(DEAL_AUDIT_QUEUE_STATUSES[0]).toBe('open');
  });

  it('labels every sort, longest waiting first', () => {
    expect(DEAL_AUDIT_QUEUE_SORTS[0]).toBe('waiting');
    for (const sort of DEAL_AUDIT_QUEUE_SORTS) {
      expect(DEAL_AUDIT_QUEUE_SORT_LABELS[sort].length).toBeGreaterThan(0);
    }
  });

  it('offers all time first, then the dashboards\' periods', () => {
    expect(DEAL_AUDIT_QUEUE_RANGE_KEYS[0]).toBe('all');
    expect(DEAL_AUDIT_QUEUE_RANGE_KEYS).toContain('mtd');
    expect(DEAL_AUDIT_QUEUE_RANGE_KEYS).toContain('custom');
  });
});

describe('isProducerActionable', () => {
  it.each([
    // producerVisible, verdict, expected
    [true, null, true],
    [true, 'pass', true],
    [true, 'fail', true],
    [undefined, null, true],
    [null, null, true],
    [false, null, false],
    [false, 'pass', false],
    // A failed manager-only item is the producer's to fix — it carries the
    // manager's note and the Fix it action.
    [false, 'fail', true],
  ] as const)(
    'producerVisible=%s, verdict=%s → %s',
    (producerVisible, reviewVerdict, expected) => {
      expect(isProducerActionable({ producerVisible, reviewVerdict })).toBe(
        expected,
      );
    },
  );
});

describe('reviewCounts', () => {
  it('splits passed, failed and not yet reviewed', () => {
    expect(
      reviewCounts([
        item('a', 'pass'),
        item('b', 'pass'),
        item('c', 'fail'),
        item('d', null),
      ]),
    ).toEqual({ passed: 2, failed: 1, remaining: 1 });
  });

  it('reads an empty checklist as nothing to do', () => {
    expect(reviewCounts([])).toEqual({ passed: 0, failed: 0, remaining: 0 });
  });
});

describe('approveBlockers', () => {
  it('lists every item not passed — failed and unreviewed alike', () => {
    // Strict gate (decided 19 Oct 2026): an item that does not apply is
    // passed with a note, never skipped.
    expect(
      approveBlockers([item('a', 'pass'), item('b', 'fail'), item('c', null)]),
    ).toEqual([
      { id: 'b', itemName: 'Item b' },
      { id: 'c', itemName: 'Item c' },
    ]);
  });

  it('clears the gate once everything has passed', () => {
    expect(approveBlockers([item('a', 'pass'), item('b', 'pass')])).toEqual([]);
  });

  it('does not block an audit with no items', () => {
    expect(approveBlockers([])).toEqual([]);
  });
});
