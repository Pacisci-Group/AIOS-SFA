import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  PRODUCER_NONE,
  QUOTE_BACKLOG_DAYS,
  normalizeLeadStatus,
} from '@sfa/shared';
import type {
  AccessContext,
  OwnerDashboardSummary,
  OwnerLeadSourceRow,
  OwnerLeadSourcesResponse,
  OwnerOpenQuotesResponse,
  OwnerProducerQuotesResponse,
  OwnerProducerQuotesRow,
  OwnerProducerRow,
  OwnerProducersResponse,
} from '@sfa/shared';
import { Model, PipelineStage, Types } from 'mongoose';
import { initialsFrom } from '../common/domain/initials';
import { displayNamesFor } from '../common/domain/user-names';
import { HOUSEHOLD_KEY_EXPR } from '../common/sales-metrics/household-key';
import { Deal, DealDocument } from '../deals/schemas/deal.schema';
import { LeadSourcesService } from '../lead-sources/lead-sources.service';
import { Lead, LeadDocument } from '../leads/schemas/lead.schema';
import { avgPerHousehold } from '../performance/performance.normalize';
import {
  YmdRange,
  addDays,
  customRange,
  instantWindow,
  parseIsoDate,
  toIsoDate,
} from '../performance/performance.range';
import { businessDaysDiff } from '../common/dates/business-dates';
import {
  loadConversionDeals,
  resolveQuoteConversions,
} from '../common/sales-metrics/quote-conversion';
import {
  QuoteRecap,
  QuoteRecapDocument,
} from '../quote-recaps/schemas/quote-recap.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import type {
  OwnerDashboardQueryDto,
  OwnerOpenQuotesQueryDto,
} from './dto/owner-dashboard-query.dto';
import {
  closingPct,
  round1,
  roundCents,
  toBlendedClosingRatio,
  toClosingRatio,
  toLobMix,
  toQuoteClosingRatio,
  toTrend,
  toUnsoldQuotesClosed,
} from './owner-dashboard.normalize';
import {
  type CohortLead,
  type CohortQuote,
  type Conversions,
  EMPTY_COUNTS,
  backlogStats,
  clientNameOf,
  outcomeOf,
  producerQuoteCounts,
  productsOf,
} from './quote-cohort';
import {
  leadCreatedYmdExpr,
  QUOTED_LINES,
  SOLD_LINES,
  linesPrefix,
  sourceMatch,
  ymdWindow,
} from '../common/sales-metrics/sales-pipelines';
import {
  quotedMatch,
  resolvePeriod,
  salesScope,
  soldMatch,
} from '../common/sales-metrics/sales-matches';

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

const key = (id: GroupKey | undefined): string => (id ? id.toString() : '');

/**
 * The quotes written in the `QUOTE_BACKLOG_DAYS` before `range` starts — the
 * span the "Unsold quotes closed" card looks back over.
 */
function backlogSpan(range: YmdRange): YmdRange {
  const start = parseIsoDate(range.from);
  return customRange(
    toIsoDate(addDays(start, -QUOTE_BACKLOG_DAYS)),
    toIsoDate(addDays(start, -1)),
  );
}

/** One copy of each quote, for a request that reads overlapping cohorts. */
function uniqueQuotes(...cohorts: CohortQuote[][]): CohortQuote[] {
  const out = new Map<string, CohortQuote>();
  for (const quote of cohorts.flat()) out.set(key(quote._id), quote);
  return [...out.values()];
}

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
 * `{ agencyId, soldDate }`; and distinct households are not additive across
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
    const { period, current, previous } = resolvePeriod(query, access.timeZone);

    const [
      sold,
      quoted,
      priorSold,
      priorQuoted,
      cohort,
      priorCohort,
      backlog,
      priorBacklog,
    ] = await Promise.all([
      this.soldWindow(access, branchId, query, current),
      this.quotedWindow(access, branchId, query, current),
      this.soldWindow(access, branchId, query, previous),
      this.quotedWindow(access, branchId, query, previous),
      this.quoteCohort(access, branchId, query, current),
      this.quoteCohort(access, branchId, query, previous),
      this.quoteCohort(access, branchId, query, backlogSpan(current)),
      this.quoteCohort(access, branchId, query, backlogSpan(previous)),
    ]);

    // One conversion pass over every quote the card row reads; lead statuses
    // only for the backlog, the one place "lost" enters a summary figure.
    const backlogQuotes = uniqueQuotes(backlog, priorBacklog);
    const [conversions, leads] = await Promise.all([
      this.conversionsFor(
        access,
        uniqueQuotes(cohort, priorCohort, backlogQuotes),
      ),
      this.leadsFor(access, backlogQuotes),
    ]);
    const quoteSide = (quotes: CohortQuote[]) => ({
      written: quotes.length,
      sold: quotes.filter((q) => conversions.has(key(q._id))).length,
    });

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
      closingRatio: toBlendedClosingRatio(
        toClosingRatio(
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
        toQuoteClosingRatio(quoteSide(cohort), quoteSide(priorCohort)),
      ),
      lobMix: toLobMix(sold.lob),
      unsoldQuotesClosed: toUnsoldQuotesClosed(
        backlogStats(
          backlog,
          conversions,
          leads,
          instantWindow(current, access.timeZone),
        ),
        backlogStats(
          priorBacklog,
          conversions,
          leads,
          instantWindow(previous, access.timeZone),
        ),
      ),
    };
  }

  /** The leaderboard: quotes, items bound and premium per producer. */
  async producers(
    access: AccessContext,
    branchId: string | null,
    query: OwnerDashboardQueryDto,
  ): Promise<OwnerProducersResponse> {
    const { period, current } = resolvePeriod(query, access.timeZone);

    const [sold, quoted] = await Promise.all([
      this.soldBy(access, branchId, query, current, '$producerId', false),
      this.quotedBy(access, branchId, query, current, '$producerId', false),
    ]);

    const quotedByKey = new Map(quoted.map((row) => [key(row._id), row]));
    const ids = new Set([...sold, ...quoted].map((row) => key(row._id)));
    const soldByKey = new Map(sold.map((row) => [key(row._id), row]));
    const names = await displayNamesFor(
      this.userModel,
      [...ids].filter(Boolean),
    );

    const rows: Omit<OwnerProducerRow, 'rank'>[] = [...ids].map((id) => {
      // `''` is the null group: sales or quotes with no producer attached. Kept
      // as a row so the table's total equals the Total Bound Premium card.
      const name = id ? (names.get(id) ?? 'Unknown Producer') : 'Unassigned';
      return {
        producerId: id || null,
        name,
        // `initialsFrom('')` is `?` — the app-wide "nobody to name" value. The
        // web draws an icon for this row rather than rendering it.
        initials: initialsFrom(id ? name : ''),
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
    const { period, current } = resolvePeriod(query, access.timeZone);

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

  /**
   * Quotes by producer: written, sold, open and lost, with the open premium —
   * the card David asked for under the tables (15 Oct 2026).
   *
   * Same cohort as the summary's quote closing ratio and the leaderboard's
   * Quotes written column, so `totals.written` equals both under any filter.
   */
  async producerQuotes(
    access: AccessContext,
    branchId: string | null,
    query: OwnerDashboardQueryDto,
  ): Promise<OwnerProducerQuotesResponse> {
    const { period, current } = resolvePeriod(query, access.timeZone);
    const cohort = await this.quoteCohort(access, branchId, query, current);
    const [conversions, leads] = await Promise.all([
      this.conversionsFor(access, cohort),
      this.leadsFor(access, cohort),
    ]);

    const counts = producerQuoteCounts(cohort, conversions, leads);
    const names = await displayNamesFor(
      this.userModel,
      [...counts.keys()].filter(Boolean),
    );

    const rows: OwnerProducerQuotesRow[] = [...counts.entries()].map(
      ([id, row]) => {
        const name = id ? (names.get(id) ?? 'Unknown Producer') : 'Unassigned';
        return {
          producerId: id || null,
          name,
          initials: initialsFrom(id ? name : ''),
          ...row,
          openPremium: roundCents(row.openPremium),
          closePct: closePct(row.sold, row.written),
        };
      },
    );

    // Most open quotes first — the card exists to show uncaptured revenue —
    // then most written, then name; "Unassigned" always last.
    rows.sort(
      (a, b) =>
        Number(a.producerId === null) - Number(b.producerId === null) ||
        b.open - a.open ||
        b.written - a.written ||
        a.name.localeCompare(b.name),
    );

    const totals = rows.reduce(
      (sum, row) => ({
        written: sum.written + row.written,
        sold: sum.sold + row.sold,
        open: sum.open + row.open,
        lost: sum.lost + row.lost,
        openPremium: sum.openPremium + row.openPremium,
      }),
      { ...EMPTY_COUNTS },
    );

    return {
      period,
      rows,
      totals: {
        ...totals,
        openPremium: roundCents(totals.openPremium),
        closePct: closePct(totals.sold, totals.written),
      },
    };
  }

  /**
   * One producer's open quotes for the window, newest first, paged — the
   * drawer the Quotes by producer card opens.
   *
   * Paged in Node, not with `$skip`/`$limit`: whether a quote is open depends
   * on its conversion and its lead's status, both resolved here after the read,
   * so a database page would be a page of the wrong set. A window holds
   * hundreds of quotes, not thousands.
   *
   * `producer` narrows within the caller's scope like the bar's multi-select;
   * one outside it gets an empty page, the same answer as a producer with none.
   */
  async openQuotes(
    access: AccessContext,
    branchId: string | null,
    query: OwnerOpenQuotesQueryDto,
  ): Promise<OwnerOpenQuotesResponse> {
    const { period, current } = resolvePeriod(query, access.timeZone);
    const none = query.producer === PRODUCER_NONE;
    const pinned =
      query.producer && !none ? [query.producer] : query.producerIds;

    const cohort = await this.quoteCohort(
      access,
      branchId,
      { ...query, producerIds: pinned },
      current,
      // `null` matches a missing field too: "no producer" either way.
      none ? { producerId: null } : undefined,
    );
    const [conversions, leads, names] = await Promise.all([
      this.conversionsFor(access, cohort),
      this.leadsFor(access, cohort),
      query.producer && !none
        ? displayNamesFor(this.userModel, [query.producer])
        : Promise.resolve(new Map<string, string>()),
    ]);

    const open = cohort
      .filter((quote) => outcomeOf(quote, conversions, leads) === 'open')
      .sort(
        (a, b) =>
          b.quoteDate.getTime() - a.quoteDate.getTime() ||
          key(b._id).localeCompare(key(a._id)),
      );

    const now = new Date();
    const start = (query.page - 1) * query.pageSize;
    const name = none
      ? 'Unassigned'
      : query.producer
        ? (names.get(query.producer) ?? 'Unknown Producer')
        : 'All producers';

    return {
      period,
      producer: {
        producerId: none ? null : (query.producer ?? null),
        name,
        initials: initialsFrom(none ? '' : name),
      },
      page: query.page,
      pageSize: query.pageSize,
      total: open.length,
      totalPages: Math.ceil(open.length / query.pageSize),
      items: open.slice(start, start + query.pageSize).map((quote) => {
        const lead = leads.get(key(quote.leadId));
        return {
          quoteRecapId: key(quote._id),
          leadId: key(quote.leadId) || null,
          householdId: key(quote.householdId) || null,
          clientName: clientNameOf(lead),
          quoteDate: quote.quoteDate.toISOString(),
          productsQuoted: productsOf(quote),
          quotedPremium: roundCents(quote.linePremium ?? 0),
          leadStatus: normalizeLeadStatus(lead?.status),
          daysOpen: Math.max(
            0,
            businessDaysDiff(quote.quoteDate, now, access.timeZone),
          ),
        };
      }),
    };
  }

  // ---------------------------------------------------------------------------
  // Quotes
  // ---------------------------------------------------------------------------

  /**
   * The quote recaps written in `range`, exactly the rows the leaderboard's
   * Quotes written column counts (`quotedBy` over the same prefix), trimmed to
   * what the quote figures read. `extraMatch` narrows after the prefix.
   */
  private quoteCohort(
    access: AccessContext,
    branchId: string | null,
    query: OwnerDashboardQueryDto,
    range: YmdRange,
    extraMatch?: Record<string, unknown>,
  ): Promise<CohortQuote[]> {
    return this.quoteRecapModel.aggregate<CohortQuote>([
      ...linesPrefix(
        quotedMatch(access, branchId, query.producerIds, range),
        QUOTED_LINES,
        query,
        false,
      ),
      ...(extraMatch ? [{ $match: extraMatch }] : []),
      {
        $project: {
          producerId: 1,
          leadId: 1,
          householdId: 1,
          quoteDate: 1,
          linePremium: 1,
          productsQuoted: 1,
          'policies.policyType': 1,
        },
      },
    ]);
  }

  /** Each quote's sale, by the one quote-to-sale rule. */
  private async conversionsFor(
    access: AccessContext,
    quotes: readonly CohortQuote[],
  ): Promise<Conversions> {
    if (!quotes.length) return new Map();
    const deals = await loadConversionDeals(
      { deal: this.dealModel, quoteRecap: this.quoteRecapModel },
      access.agencyId ?? '',
      quotes,
    );
    return resolveQuoteConversions(quotes, deals, access.timeZone);
  }

  /** The quotes' leads — name and current status — by id. */
  private async leadsFor(
    access: AccessContext,
    quotes: readonly CohortQuote[],
  ): Promise<Map<string, CohortLead>> {
    const ids = [...new Set(quotes.map((q) => key(q.leadId)).filter(Boolean))];
    if (!ids.length) return new Map();
    const rows = await this.leadModel
      .find(
        {
          agencyId: access.agencyId,
          _id: { $in: ids.map((id) => new Types.ObjectId(id)) },
        },
        { firstName: 1, lastName: 1, status: 1 },
      )
      .lean<CohortLead[]>();
    return new Map(rows.map((row) => [key(row._id), row]));
  }

  // ---------------------------------------------------------------------------
  // Windows
  // ---------------------------------------------------------------------------

  private async soldWindow(
    access: AccessContext,
    branchId: string | null,
    query: OwnerDashboardQueryDto,
    range: YmdRange,
  ): Promise<SoldWindow> {
    const pipeline: PipelineStage[] = [
      ...linesPrefix(
        soldMatch(access, branchId, query.producerIds, range),
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
        quotedMatch(access, branchId, query.producerIds, range),
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
        soldMatch(access, branchId, query.producerIds, range),
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
        quotedMatch(access, branchId, query.producerIds, range),
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
      { $match: salesScope<LeadDocument>(access, branchId, query.producerIds) },
      ...sourceMatch(query.leadSourceIds, 'leadSourceId'),
      { $addFields: { createdYmd: leadCreatedYmdExpr(access.timeZone) } },
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
}

/** `sold ÷ written × 100`, or `null` when nothing was written. */
function closePct(sold: number, written: number): number | null {
  return written > 0 ? round1((sold / written) * 100) : null;
}
