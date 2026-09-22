import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { NEW_BUSINESS_MATCH } from '@sfa/shared';
import type {
  AccessContext,
  OwnerDashboardPeriod,
  OwnerDashboardSummary,
  OwnerLeadSourceRow,
  OwnerLeadSourcesResponse,
  OwnerProducerRow,
  OwnerProducersResponse,
} from '@sfa/shared';
import { Model, PipelineStage, Types } from 'mongoose';
import { buildScopeFilter } from '../common/access/scope-filter';
import { initialsFrom } from '../common/domain/initials';
import { HOUSEHOLD_KEY_EXPR } from '../common/sales-metrics/household-key';
import { Deal, DealDocument } from '../deals/schemas/deal.schema';
import { LeadSourcesService } from '../lead-sources/lead-sources.service';
import { Lead, LeadDocument } from '../leads/schemas/lead.schema';
import { avgPerHousehold } from '../performance/performance.normalize';
import {
  YmdRange,
  resolveComparison,
  resolveRange,
} from '../performance/performance.range';
import {
  QuoteRecap,
  QuoteRecapDocument,
} from '../quote-recaps/schemas/quote-recap.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { OwnerDashboardQueryDto } from './dto/owner-dashboard-query.dto';
import {
  closingPct,
  roundCents,
  toClosingRatio,
  toLobMix,
  toTrend,
} from './owner-dashboard.normalize';
import {
  LEAD_CREATED_YMD_EXPR,
  QUOTED_LINES,
  SOLD_LINES,
  linesPrefix,
  sourceMatch,
  ymdWindow,
} from './owner-dashboard.pipelines';

/** A `$group` key that may be null — sales with no producer, or no source. */
type GroupKey = Types.ObjectId | null;

interface SoldTotals {
  premium: number;
  items: number;
  recordCount: number;
  householdCount: number;
}

interface SoldWindow extends SoldTotals {
  lob: { policyType: string | null; count: number }[];
}

interface QuotedWindow {
  premium: number;
  recordCount: number;
}

interface KeyedSold {
  _id: GroupKey;
  premium: number;
  items: number;
  count: number;
}

interface KeyedQuoted {
  _id: GroupKey;
  premium: number;
  count: number;
}

const EMPTY_SOLD: SoldWindow = {
  premium: 0,
  items: 0,
  recordCount: 0,
  householdCount: 0,
  lob: [],
};

const key = (id: GroupKey): string => (id ? id.toString() : '');

/**
 * The Owner View dashboard — "Strategy Hub" (PAC-135).
 *
 * Three reads over one filter; see `owner-dashboard.ts` in `@sfa/shared` for why
 * they are three, and `linesPrefix` for why every sold figure is summed from
 * policy lines.
 *
 * ## Scope
 *
 * Every match starts from `buildScopeFilter`, exactly like `PerformanceService`,
 * so the page is "the whole agency" only for a caller whose `DataScope` reaches
 * that far: a branch-scoped holder of `owner_dashboard:read` sees their branch,
 * and the producer multi-select can narrow but never widen. `LeaderboardService`
 * bypasses the clamp for a product reason that does not apply here.
 *
 * ## Live
 *
 * No rollup collection and no job. An agency-year is a few thousand rows behind
 * `{ agencyId, soldDateYmd }`; and distinct households are not additive across
 * days, so there is nothing a rollup could pre-compute that survives an
 * arbitrary range plus three multi-select filters.
 */
@Injectable()
export class OwnerDashboardService {
  constructor(
    @InjectModel(Deal.name) private readonly dealModel: Model<DealDocument>,
    @InjectModel(QuoteRecap.name)
    private readonly quoteRecapModel: Model<QuoteRecapDocument>,
    @InjectModel(Lead.name) private readonly leadModel: Model<LeadDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly leadSources: LeadSourcesService,
  ) {}

  /** The KPI row: each figure for the window and for its comparison window. */
  async summary(
    access: AccessContext,
    branchId: string | null,
    query: OwnerDashboardQueryDto,
  ): Promise<OwnerDashboardSummary> {
    const { period, current, previous } = this.resolvePeriod(query);

    const [sold, quoted, priorSold, priorQuoted] = await Promise.all([
      this.soldWindow(access, branchId, query, current),
      this.quotedWindow(access, branchId, query, current),
      this.soldWindow(access, branchId, query, previous),
      this.quotedWindow(access, branchId, query, previous),
    ]);

    // "Was there anything to compare with?" is asked of the window's sales.
    const hasPrior = priorSold.recordCount > 0;

    return {
      period,
      premium: toTrend(
        roundCents(sold.premium),
        roundCents(priorSold.premium),
        hasPrior,
      ),
      items: toTrend(sold.items, priorSold.items, hasPrior),
      avgPremiumPerHousehold: toTrend(
        avgPerHousehold(sold.premium, sold.householdCount),
        avgPerHousehold(priorSold.premium, priorSold.householdCount),
        hasPrior,
      ),
      closingRatio: toClosingRatio(
        {
          soldPremium: sold.premium,
          quotedPremium: quoted.premium,
          quoteCount: quoted.recordCount,
          soldCount: sold.recordCount,
        },
        {
          soldPremium: priorSold.premium,
          quotedPremium: priorQuoted.premium,
          quoteCount: priorQuoted.recordCount,
          soldCount: priorSold.recordCount,
        },
      ),
      lobMix: toLobMix(sold.lob),
    };
  }

  /** The leaderboard: quotes, items bound and premium per producer. */
  async producers(
    access: AccessContext,
    branchId: string | null,
    query: OwnerDashboardQueryDto,
  ): Promise<OwnerProducersResponse> {
    const { period, current } = this.resolvePeriod(query);

    const [sold, quoted] = await Promise.all([
      this.soldBy(access, branchId, query, current, '$producerId', false),
      this.quotedBy(access, branchId, query, current, '$producerId', false),
    ]);

    const quotedByKey = new Map(quoted.map((row) => [key(row._id), row]));
    const ids = new Set([...sold, ...quoted].map((row) => key(row._id)));
    const soldByKey = new Map(sold.map((row) => [key(row._id), row]));
    const names = await this.namesFor([...ids].filter(Boolean));

    const rows: Omit<OwnerProducerRow, 'rank'>[] = [...ids].map((id) => {
      // `''` is the null group: sales or quotes with no producer attached. Kept
      // as a row so the table's total equals the Total Bound Premium card.
      const name = id ? (names.get(id) ?? 'Unknown Producer') : 'Unassigned';
      return {
        producerId: id || null,
        name,
        initials: id ? initialsFrom(name) : '—',
        quotes: quotedByKey.get(id)?.count ?? 0,
        bound: soldByKey.get(id)?.items ?? 0,
        premium: roundCents(soldByKey.get(id)?.premium ?? 0),
        goalProgress: null,
      };
    });

    // Premium desc, then name, so equal producers never swap between loads.
    // "Unassigned" is not a competitor: it always sits last, unranked-looking.
    rows.sort(
      (a, b) =>
        Number(a.producerId === null) - Number(b.producerId === null) ||
        b.premium - a.premium ||
        a.name.localeCompare(b.name),
    );

    return {
      period,
      rows: rows.map((row, index) => ({ ...row, rank: index + 1 })),
      totals: {
        quotes: rows.reduce((sum, row) => sum + row.quotes, 0),
        bound: rows.reduce((sum, row) => sum + row.bound, 0),
        premium: roundCents(rows.reduce((sum, row) => sum + row.premium, 0)),
      },
    };
  }

  /** The lead-source matrix: volume, premium and premium conversion per source. */
  async leadSourceMatrix(
    access: AccessContext,
    branchId: string | null,
    query: OwnerDashboardQueryDto,
  ): Promise<OwnerLeadSourcesResponse> {
    const { period, current } = this.resolvePeriod(query);

    const [sold, quoted, volume, labels] = await Promise.all([
      this.soldBy(access, branchId, query, current, '$sourceId', true),
      this.quotedBy(access, branchId, query, current, '$sourceId', true),
      this.leadVolume(access, branchId, query, current),
      this.leadSources.labelsFor(access.agencyId),
    ]);

    const soldByKey = new Map(sold.map((row) => [key(row._id), row]));
    const quotedByKey = new Map(quoted.map((row) => [key(row._id), row]));
    const ids = new Set([
      ...soldByKey.keys(),
      ...quotedByKey.keys(),
      ...volume.keys(),
    ]);

    const sides = [...ids].map((id) => ({
      id,
      soldPremium: soldByKey.get(id)?.premium ?? 0,
      quotedPremium: quotedByKey.get(id)?.premium ?? 0,
      quoteCount: quotedByKey.get(id)?.count ?? 0,
      soldCount: soldByKey.get(id)?.count ?? 0,
    }));

    const rows: OwnerLeadSourceRow[] = sides.map((side) => {
      const { id } = side;
      const premium = roundCents(side.soldPremium);
      const quotedPremium = roundCents(side.quotedPremium);
      const { pct, gap } = closingPct(side);
      return {
        leadSourceId: id || null,
        // A dangling id renders as its own bucket rather than vanishing into
        // "No source", which would misstate both.
        name: id ? (labels.get(id) ?? 'Unknown source') : 'No source',
        volume: volume.get(id) ?? 0,
        premium,
        quotedPremium,
        convPct: pct,
        convGap: gap,
      };
    });

    // Premium desc; "No source" last — it is the gap in the data, not a channel.
    rows.sort(
      (a, b) =>
        Number(a.leadSourceId === null) - Number(b.leadSourceId === null) ||
        b.premium - a.premium ||
        a.name.localeCompare(b.name),
    );

    const premium = roundCents(rows.reduce((sum, r) => sum + r.premium, 0));
    const quotedPremium = roundCents(
      rows.reduce((sum, r) => sum + r.quotedPremium, 0),
    );
    // The total row is judged as a whole, by the same rule as the card.
    const total = closingPct({
      soldPremium: premium,
      quotedPremium,
      quoteCount: sides.reduce((sum, side) => sum + side.quoteCount, 0),
      soldCount: sides.reduce((sum, side) => sum + side.soldCount, 0),
    });

    return {
      period,
      rows,
      totals: {
        volume: rows.reduce((sum, r) => sum + r.volume, 0),
        premium,
        quotedPremium,
        convPct: total.pct,
        convGap: total.gap,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Windows
  // ---------------------------------------------------------------------------

  private resolvePeriod(query: OwnerDashboardQueryDto): {
    period: OwnerDashboardPeriod;
    current: YmdRange;
    previous: YmdRange;
  } {
    const custom = { from: query.from, to: query.to };
    const current = resolveRange(query.range, custom);
    const previous = resolveComparison(query.range, custom);
    return {
      current,
      previous,
      period: {
        key: query.range,
        current: { from: current.from, to: current.to },
        previous: { from: previous.from, to: previous.to },
      },
    };
  }

  /** Tenancy + data scope + the producer multi-select. Narrow-only. */
  private scope<T>(
    access: AccessContext,
    branchId: string | null,
    query: OwnerDashboardQueryDto,
  ) {
    return buildScopeFilter<T>(access, branchId, {
      producerIds: query.producerIds,
    });
  }

  private soldMatch(
    access: AccessContext,
    branchId: string | null,
    query: OwnerDashboardQueryDto,
    range: YmdRange,
  ): Record<string, unknown> {
    return {
      ...this.scope<DealDocument>(access, branchId, query),
      // `$ne`, never `$eq`: `businessType` is absent on every historic deal.
      ...NEW_BUSINESS_MATCH,
      ...ymdWindow('soldDateYmd', range),
    };
  }

  private quotedMatch(
    access: AccessContext,
    branchId: string | null,
    query: OwnerDashboardQueryDto,
    range: YmdRange,
  ): Record<string, unknown> {
    return {
      ...this.scope<QuoteRecapDocument>(access, branchId, query),
      ...ymdWindow('quoteDateYmd', range),
    };
  }

  private async soldWindow(
    access: AccessContext,
    branchId: string | null,
    query: OwnerDashboardQueryDto,
    range: YmdRange,
  ): Promise<SoldWindow> {
    const pipeline: PipelineStage[] = [
      ...linesPrefix(
        this.soldMatch(access, branchId, query, range),
        SOLD_LINES,
        query,
        false,
      ),
      {
        // One pass, two groupings of the same matched rows.
        $facet: {
          totals: [
            {
              $group: {
                _id: null,
                premium: { $sum: '$linePremium' },
                items: { $sum: '$lineItems' },
                recordCount: { $sum: 1 },
                households: { $addToSet: HOUSEHOLD_KEY_EXPR },
              },
            },
            {
              $project: {
                _id: 0,
                premium: 1,
                items: 1,
                recordCount: 1,
                householdCount: { $size: '$households' },
              },
            },
          ],
          lob: [
            { $unwind: '$lines' },
            // The untyped fallback line is a sale, but not a *policy of a type*.
            { $match: { 'lines.typed': true } },
            { $group: { _id: '$lines.policyType', count: { $sum: 1 } } },
            { $project: { _id: 0, policyType: '$_id', count: 1 } },
          ],
        },
      },
    ];

    const [row] = await this.dealModel.aggregate<{
      totals: SoldTotals[];
      lob: SoldWindow['lob'];
    }>(pipeline);

    // `$group` on `_id: null` over no rows emits nothing, not a row of zeroes.
    return { ...EMPTY_SOLD, ...row?.totals[0], lob: row?.lob ?? [] };
  }

  private async quotedWindow(
    access: AccessContext,
    branchId: string | null,
    query: OwnerDashboardQueryDto,
    range: YmdRange,
  ): Promise<QuotedWindow> {
    const [row] = await this.quoteRecapModel.aggregate<QuotedWindow>([
      ...linesPrefix(
        this.quotedMatch(access, branchId, query, range),
        QUOTED_LINES,
        query,
        false,
      ),
      {
        $group: {
          _id: null,
          premium: { $sum: '$linePremium' },
          recordCount: { $sum: 1 },
        },
      },
      { $project: { _id: 0, premium: 1, recordCount: 1 } },
    ]);
    return row ?? { premium: 0, recordCount: 0 };
  }

  private soldBy(
    access: AccessContext,
    branchId: string | null,
    query: OwnerDashboardQueryDto,
    range: YmdRange,
    groupBy: '$producerId' | '$sourceId',
    withSource: boolean,
  ): Promise<KeyedSold[]> {
    return this.dealModel.aggregate<KeyedSold>([
      ...linesPrefix(
        this.soldMatch(access, branchId, query, range),
        SOLD_LINES,
        query,
        withSource,
      ),
      {
        $group: {
          // A missing field groups with an explicit null.
          _id: { $ifNull: [groupBy, null] },
          premium: { $sum: '$linePremium' },
          items: { $sum: '$lineItems' },
          count: { $sum: 1 },
        },
      },
    ]);
  }

  private quotedBy(
    access: AccessContext,
    branchId: string | null,
    query: OwnerDashboardQueryDto,
    range: YmdRange,
    groupBy: '$producerId' | '$sourceId',
    withSource: boolean,
  ): Promise<KeyedQuoted[]> {
    return this.quoteRecapModel.aggregate<KeyedQuoted>([
      ...linesPrefix(
        this.quotedMatch(access, branchId, query, range),
        QUOTED_LINES,
        query,
        withSource,
      ),
      {
        $group: {
          _id: { $ifNull: [groupBy, null] },
          premium: { $sum: '$linePremium' },
          count: { $sum: 1 },
        },
      },
    ]);
  }

  /**
   * Leads received in the window, by source.
   *
   * The producer and lead-source filters apply; the **line-of-business filter
   * cannot**: a lead is not a policy, and `policiesOfInterest` is empty on every
   * migrated lead, so filtering on it would zero the column for all of history.
   * Volume therefore answers "how many leads did this source send", whatever
   * they went on to buy.
   */
  private async leadVolume(
    access: AccessContext,
    branchId: string | null,
    query: OwnerDashboardQueryDto,
    range: YmdRange,
  ): Promise<Map<string, number>> {
    const rows = await this.leadModel.aggregate<{
      _id: GroupKey;
      count: number;
    }>([
      { $match: this.scope<LeadDocument>(access, branchId, query) },
      ...sourceMatch(query.leadSourceIds, 'leadSourceId'),
      { $addFields: { createdYmd: LEAD_CREATED_YMD_EXPR } },
      { $match: ymdWindow('createdYmd', range) },
      {
        $group: {
          _id: { $ifNull: ['$leadSourceId', null] },
          count: { $sum: 1 },
        },
      },
    ]);
    return new Map(rows.map((row) => [key(row._id), row.count]));
  }

  /**
   * Display names, **deactivated users included**: someone who sold in March and
   * left in June still sold in March, and dropping their row would make the
   * table total disagree with the card above it.
   */
  private async namesFor(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();

    const users = await this.userModel
      .find(
        { _id: { $in: ids.map((id) => new Types.ObjectId(id)) } },
        { firstName: 1, lastName: 1, email: 1 },
      )
      .lean<
        {
          _id: Types.ObjectId;
          firstName?: string;
          lastName?: string;
          email: string;
        }[]
      >();

    return new Map(
      users.map((user) => {
        const name = [user.firstName, user.lastName]
          .filter(Boolean)
          .join(' ')
          .trim();
        return [user._id.toString(), name || user.email.split('@')[0]];
      }),
    );
  }
}
