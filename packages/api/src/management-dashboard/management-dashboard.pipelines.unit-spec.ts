import { Types, type PipelineStage } from 'mongoose';
import { HOUSEHOLD_KEY_EXPR } from '../common/sales-metrics/household-key';
import type { YmdRange } from '../performance/performance.range';
import {
  agingAuditsPrefix,
  householdsByProducer,
  lobMatch,
  AUDIT_OWNER_FIELD,
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
const TIME_ZONE = 'America/Chicago';

const match = (stages: unknown[], index = 0) =>
  (stages[index] as { $match: Record<string, unknown> }).$match;

describe('stalledLeadsPrefix', () => {
  it('excludes every stored form of a terminal status and keeps untouched leads', () => {
    const stages = stalledLeadsPrefix(
      { agencyId: 'a' },
      {},
      RANGE,
      NOW,
      TIME_ZONE,
    );
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

  it('buckets the lead on the agency calendar it is given (PAC-141)', () => {
    const stages = stalledLeadsPrefix({}, {}, RANGE, NOW, 'Asia/Kolkata');
    // The `$addFields` just before the window match carries the zone into
    // Mongo's `$dateToString`; a UTC-midnight (migrated) value stays UTC.
    const added = (
      stages[stages.length - 2] as { $addFields: { createdYmd: unknown } }
    ).$addFields.createdYmd;
    expect(JSON.stringify(added)).toContain('"Asia/Kolkata"');
    expect(JSON.stringify(added)).toContain('"UTC"');
    expect(JSON.stringify(added)).not.toContain('Chicago');
    expect(() => stalledLeadsPrefix({}, {}, RANGE, NOW, '')).toThrow(
      /time zone is required/i,
    );
  });

  it('adds the source and line-of-business matches only when asked', () => {
    const bare = stalledLeadsPrefix({}, {}, RANGE, NOW, TIME_ZONE);
    const filtered = stalledLeadsPrefix(
      {},
      { leadSourceIds: ['__none__'], policyTypes: ['Auto'] },
      RANGE,
      NOW,
      TIME_ZONE,
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
  const joinsLeads = (stages: PipelineStage[]) =>
    stages.some(
      (stage) =>
        '$lookup' in stage &&
        (stage as { $lookup: { from: string } }).$lookup.from === 'leads',
    );

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
    expect(stages).toContainEqual({
      $match: { '_audit.0': { $exists: true } },
    });
  });

  it('resolves the source through the lead only under a source filter', () => {
    expect(joinsLeads(agingAuditsPrefix({}, {}))).toBe(false);
    expect(
      joinsLeads(agingAuditsPrefix({}, { leadSourceIds: ['__none__'] })),
    ).toBe(true);
  });

  /**
   * PAC-136: the producer filter narrows by who is responsible for the audit,
   * so it agrees with the team table and drawer after a work transfer.
   */
  it('computes the responsible owner and applies the producer pin to it', () => {
    const pin = { [AUDIT_OWNER_FIELD]: { $in: ['p'] } };
    const stages = agingAuditsPrefix({ agencyId: 'a' }, {}, pin);
    expect(stages[stages.length - 1]).toEqual({ $match: pin });
    const owner = stages.find(
      (stage) => '$addFields' in stage && AUDIT_OWNER_FIELD in stage.$addFields,
    ) as {
      $addFields: Record<string, { $switch: { branches: { then: string }[] } }>;
    };
    // User assignee first, else the seller on the deal itself.
    expect(
      owner.$addFields[AUDIT_OWNER_FIELD].$switch.branches.map((b) => b.then),
    ).toEqual(['$_agingAudit.auditAssignee.id', '$producerId']);
  });

  it('adds no owner pin without a producer selection', () => {
    const stages = agingAuditsPrefix({ agencyId: 'a' }, {});
    expect(
      stages.some(
        (stage) => '$match' in stage && AUDIT_OWNER_FIELD in stage.$match,
      ),
    ).toBe(false);
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
  it('starts from audits with open items and groups by the responsible owner', () => {
    const stages = openAuditItemsByProducer('agency', { _owner: 'p' });
    expect(match(stages)).toEqual({
      agencyId: 'agency',
      isTestRecord: { $ne: true },
      openFailedCount: { $gt: 0 },
    });
    // The clamp applies to the computed owner, not to the deal's seller —
    // a transferred audit counts against the successor (PAC-136).
    expect(match(stages, 4)).toEqual({ _owner: 'p' });
    expect((stages[5] as { $group: { _id: string } }).$group._id).toBe(
      `$${AUDIT_OWNER_FIELD}`,
    );
  });

  it('owns a user-assigned audit by its assignee, an unassigned one by the seller, a role-owned one by nobody', () => {
    const stages = openAuditItemsByProducer('agency', {});
    const owner = (
      stages[3] as {
        $addFields: Record<
          string,
          { $switch: { branches: { then: string }[]; default: unknown } }
        >;
      }
    ).$addFields[AUDIT_OWNER_FIELD].$switch;
    expect(owner.branches.map((b) => b.then)).toEqual([
      '$$ROOT.auditAssignee.id',
      '$_deal.producerId',
    ]);
    expect(owner.default).toBeNull();
  });
});

describe('lobMatch', () => {
  it('is empty without a selection', () => {
    expect(lobMatch('policyTypes', undefined)).toEqual([]);
    expect(lobMatch('policyTypes', [])).toEqual([]);
  });
});
