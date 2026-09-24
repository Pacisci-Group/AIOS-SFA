import { Types } from 'mongoose';
import { HOUSEHOLD_KEY_EXPR } from '../common/sales-metrics/household-key';
import type { YmdRange } from '../performance/performance.range';
import {
  agingAuditsPrefix,
  householdsByProducer,
  lobMatch,
  openAuditItemsByProducer,
  overdueTicketsPrefix,
  pagedFacet,
  stalledLeadsPrefix,
} from './management-dashboard.pipelines';

const RANGE: YmdRange = {
  startYmd: 20260901,
  endYmd: 20261001,
  from: '2026-09-01',
  to: '2026-09-30',
};

const NOW = new Date('2026-09-23T12:00:00.000Z');

const match = (stages: unknown[], index = 0) =>
  (stages[index] as { $match: Record<string, unknown> }).$match;

describe('stalledLeadsPrefix', () => {
  it('excludes every stored form of a terminal status and keeps untouched leads', () => {
    const stages = stalledLeadsPrefix({ agencyId: 'a' }, {}, RANGE, NOW);
    const first = match(stages);

    const nin = (first.status as { $nin: string[] }).$nin;
    expect(nin).toEqual(expect.arrayContaining(['Sold', 'Lost', 'jp76g']));
    expect(nin).not.toContain('New');

    // `$not $gte`: a lead with no `lastActivityAt` at all is stalled too.
    expect(first.lastActivityAt).toEqual({
      $not: { $gte: new Date('2026-09-21T12:00:00.000Z') },
    });
    // Ends with the created-in-window match.
    expect(match(stages, stages.length - 1)).toEqual({
      createdYmd: { $gte: 20260901, $lt: 20261001 },
    });
  });

  it('adds the source and line-of-business matches only when asked', () => {
    const bare = stalledLeadsPrefix({}, {}, RANGE, NOW);
    const filtered = stalledLeadsPrefix(
      {},
      { leadSourceIds: ['__none__'], policyTypes: ['Auto'] },
      RANGE,
      NOW,
    );
    expect(filtered).toHaveLength(bare.length + 2);
    expect(match(filtered, 1)).toEqual({ leadSourceId: { $in: [null] } });
    expect(
      (match(filtered, 2)['policiesOfInterest.policyType'] as { $in: string[] })
        .$in,
    ).toContain('Auto');
  });
});

describe('agingAuditsPrefix', () => {
  it('joins the newest non-Pass audit and drops deals without one', () => {
    const stages = agingAuditsPrefix({ agencyId: 'a' }, {});
    const lookup = stages.find((stage) => '$lookup' in stage) as {
      $lookup: { from: string; pipeline: unknown[] };
    };
    expect(lookup.$lookup.from).toBe('dealAudits');
    expect(match(lookup.$lookup.pipeline)).toEqual({
      isTestRecord: { $ne: true },
      auditStatus: { $ne: 'Pass' },
    });
    expect(stages[stages.length - 1]).toEqual({
      $match: { '_audit.0': { $exists: true } },
    });
  });

  it('resolves the source through the lead only under a source filter', () => {
    expect(
      agingAuditsPrefix({}, {}).some((stage) => '$addFields' in stage),
    ).toBe(false);
    expect(
      agingAuditsPrefix({}, { leadSourceIds: ['__none__'] }).some(
        (stage) => '$addFields' in stage,
      ),
    ).toBe(true);
  });
});

describe('overdueTicketsPrefix', () => {
  const window = {
    from: new Date('2026-09-01T05:00:00.000Z'),
    to: new Date('2026-10-01T05:00:00.000Z'),
  };
  const producer = new Types.ObjectId().toString();

  it('windows on openedAt and matches the stored status only', () => {
    const first = match(overdueTicketsPrefix({}, {}, window));
    expect(first.openedAt).toEqual({ $gte: window.from, $lt: window.to });
    // The column is materialised (PAC-102); no derived `$or` over `dueAt`.
    expect(first.status).toBe('overdue');
    expect(first.$or).toBeUndefined();
  });

  it('applies the person filter to the assignee, unless own scope pinned it', () => {
    const agency = match(
      overdueTicketsPrefix({}, { producerIds: [producer] }, window),
    );
    expect(agency.assignedUserId).toEqual({
      $in: [new Types.ObjectId(producer)],
    });

    const self = new Types.ObjectId();
    const own = match(
      overdueTicketsPrefix(
        { assignedUserId: self },
        { producerIds: [producer] },
        window,
      ),
    );
    expect(own.assignedUserId).toBe(self);
  });

  it('filters line of business on the ticket policy type', () => {
    const first = match(
      overdueTicketsPrefix({}, { policyTypes: ['Home'] }, window),
    );
    expect((first.policyType as { $in: string[] }).$in).toContain('Home');
  });
});

describe('pagedFacet', () => {
  it('skips whole pages', () => {
    const facet = pagedFacet({ openedAt: 1 }, 3, 25) as {
      $facet: { items: unknown[]; total: unknown[] };
    };
    expect(facet.$facet.items).toEqual([
      { $sort: { openedAt: 1 } },
      { $skip: 50 },
      { $limit: 25 },
    ]);
    expect(facet.$facet.total).toEqual([{ $count: 'count' }]);
  });
});

describe('householdsByProducer', () => {
  it('counts distinct households, grouping a missing producer with null', () => {
    const stages = householdsByProducer([{ $match: {} }]);
    expect(stages[1]).toEqual({
      $group: {
        _id: { $ifNull: ['$producerId', null] },
        households: { $addToSet: HOUSEHOLD_KEY_EXPR },
      },
    });
    expect(stages[2]).toEqual({
      $project: { _id: 1, count: { $size: '$households' } },
    });
  });
});

describe('openAuditItemsByProducer', () => {
  it('starts from audits with open items and attributes through the deal', () => {
    const stages = openAuditItemsByProducer('agency', { producerId: 'p' });
    expect(match(stages)).toEqual({
      agencyId: 'agency',
      isTestRecord: { $ne: true },
      openFailedCount: { $gt: 0 },
    });
    const lookup = stages[1] as { $lookup: { pipeline: unknown[] } };
    expect(match(lookup.$lookup.pipeline)).toEqual({ producerId: 'p' });
  });
});

describe('lobMatch', () => {
  it('is empty without a selection', () => {
    expect(lobMatch('policyTypes', undefined)).toEqual([]);
    expect(lobMatch('policyTypes', [])).toEqual([]);
  });
});
