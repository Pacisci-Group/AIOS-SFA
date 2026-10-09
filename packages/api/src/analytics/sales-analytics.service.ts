import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  type AccessContext,
  type AnalyticsSalesSummary,
  type AnalyticsSeries,
  DataScope,
  type GoalPacingGap,
  type SalesBreakdownResponse,
  type SalesBreakdownRow,
  type SalesMetrics,
  type SalesSegment,
  type SalesSegmentMetrics,
  type SalesTimeseriesBucket,
  type SalesTimeseriesResponse,
} from '@sfa/shared';
import { Model, PipelineStage } from 'mongoose';
import {
  quotedMatch,
  resolvePeriod,
  salesScope,
  soldMatch,
} from '../common/sales-metrics/sales-matches';
import {
  linesPrefix,
  QUOTED_LINES,
  SOLD_LINES,
} from '../common/sales-metrics/sales-pipelines';
import { Deal, DealDocument } from '../deals/schemas/deal.schema';
import {
  roundCents,
  toClosingRatio,
  toTrend,
} from '../owner-dashboard/owner-dashboard.normalize';
import { avgPerHousehold } from '../performance/performance.normalize';
import { type YmdRange, zonedDate } from '../performance/performance.range';
import {
  ProducerGoal,
  ProducerGoalDocument,
} from '../producer-goals/schemas/producer-goal.schema';
import {
  QuoteRecap,
  QuoteRecapDocument,
} from '../quote-recaps/schemas/quote-recap.schema';
import {
  AnalyticsLabelsService,
  type LabelKind,
  UNKNOWN_LABEL,
} from './analytics-labels.service';
import {
  byMeasure,
  type Bucket,
  changeOf,
  emptyQuoted,
  emptySold,
  foldQuoted,
  foldSold,
  mapKey,
  type MetricsAvailability,
  quotedTotal,
  type RawQuoted,
  type RawSold,
  sharePct,
  type SoldAccumulator,
  soldTotal,
  toSalesMetrics,
  toSegmentMetrics,
  zeroSalesMetrics,
} from './analytics.normalize';
import type {
  SalesBreakdownQuery,
  SalesSummaryQuery,
  SalesTimeseriesQuery,
} from './dto/analytics-query.dto';
import { computePacing, pacingMonth } from './goal-pacing';
import {
  type DimensionKey,
  HOUSEHOLD_LOOKUP,
  prefixNeeds,
  quotedBreakdownStages,
  rowKey,
  SALES_DIMENSIONS,
  type SalesDimension,
  soldBreakdownStages,
  soldMetrics,
} from './sales-dimensions';
import { bucketsBetween, ymdBucketExpr } from './time-buckets';

/** Which batch a dimension's keys are labelled from. */
const LABEL_KIND: Record<DimensionKey, LabelKind> = {
  producer: 'user',
  csr: 'user',
  leadSource: 'leadSource',
  branch: 'branch',
  policyType: 'self',
  carrier: 'self',
  zip: 'self',
};

interface SoldFacet {
  rows: RawSold[];
  total: RawSold[];
  segments?: (RawSold & { _id: { k: unknown; s: unknown } })[];
}

interface QuotedFacet {
  rows: RawQuoted[];
  total: RawQuoted[];
}

/** One window's breakdown, folded but not yet labelled. */
interface BreakdownWindow {
  rows: Map<string, Bucket<SoldAccumulator>>;
  /** Row map key → segment map key → bucket. */
  segments: Map<string, Map<string, Bucket<SoldAccumulator>>> | null;
  total: SoldAccumulator;
  quotedRows: Map<string, Bucket<ReturnType<typeof emptyQuoted>>> | null;
  quotedTotal: ReturnType<typeof emptyQuoted> | null;
}

/**
 * Sales analytics (PAC-152, part 2): the KPI row, a breakdown by any
 * dimension, and a trend at any grain — over one filter.
 *
 * ## One definition of a sale
 *
 * Every figure starts from `soldMatch` / `quotedMatch` (tenancy, data scope,
 * new business only, the window on `soldDateYmd` / `quoteDateYmd`) and runs
 * through `linesPrefix` (lead source through the lead, policy lines, the LOB
 * filter). That is the Owner dashboard's pipeline, so for the same filters
 * this page's bound premium **is** that dashboard's — by construction, not by
 * a second implementation that happens to agree.
 *
 * ## Scope
 *
 * The clamp is `buildScopeFilter`'s: a branch manager sees their branch, a
 * producer granted the page sees their own sales. `branchId` narrows an
 * agency-scope caller to one office; `BranchGuard` refuses anyone else a
 * branch that is not theirs.
 */
@Injectable()
export class SalesAnalyticsService {
  constructor(
    @InjectModel(Deal.name) private readonly dealModel: Model<DealDocument>,
    @InjectModel(QuoteRecap.name)
    private readonly quoteRecapModel: Model<QuoteRecapDocument>,
    @InjectModel(ProducerGoal.name)
    private readonly goalModel: Model<ProducerGoalDocument>,
    private readonly labels: AnalyticsLabelsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------

  async summary(
    access: AccessContext,
    branchId: string | null,
    query: SalesSummaryQuery,
  ): Promise<AnalyticsSalesSummary> {
    const { period, current, previous } = resolvePeriod(query, access.timeZone);
    const quotesAvailable = !query.carriers?.length;
    const netAvailable = !query.policyTypes?.length && quotesAvailable;

    const [sold, quoted, priorSold, priorQuoted] = await Promise.all([
      this.soldTotal(access, branchId, query, current),
      quotesAvailable
        ? this.quotedTotal(access, branchId, query, current)
        : null,
      this.soldTotal(access, branchId, query, previous),
      quotesAvailable
        ? this.quotedTotal(access, branchId, query, previous)
        : null,
    ]);

    const hasPrior = priorSold.deals.size > 0;
    const premium = roundCents(sold.premium);
    const { pacing, pacingGap } = await this.pacing(
      access,
      branchId,
      query,
      current,
      premium,
    );

    return {
      period,
      premium: toTrend(premium, roundCents(priorSold.premium), hasPrior),
      netPremium: netAvailable
        ? toTrend(
            roundCents(sold.net ?? 0),
            roundCents(priorSold.net ?? 0),
            hasPrior,
          )
        : toTrend(null, null, hasPrior),
      items: toTrend(sold.items, priorSold.items, hasPrior),
      policies: toTrend(sold.policies, priorSold.policies, hasPrior),
      households: toTrend(
        sold.households.size,
        priorSold.households.size,
        hasPrior,
      ),
      avgPremiumPerHousehold: toTrend(
        avgPerHousehold(sold.premium, sold.households.size),
        avgPerHousehold(priorSold.premium, priorSold.households.size),
        hasPrior,
      ),
      closingRatio:
        quoted && priorQuoted
          ? toClosingRatio(
              {
                soldPremium: sold.premium,
                quotedPremium: quoted.quotedPremium,
                quoteCount: quoted.quotes.size,
                soldCount: sold.deals.size,
              },
              {
                soldPremium: priorSold.premium,
                quotedPremium: priorQuoted.quotedPremium,
                quoteCount: priorQuoted.quotes.size,
                soldCount: priorSold.deals.size,
              },
            )
          : null,
      pacing,
      pacingGap,
    };
  }

  /**
   * Goal pacing for the month the window covers. A goal is a month's whole
   * premium, so this needs a window that starts on the 1st inside one month,
   * and no line/source/carrier filter — see `GoalPacingGap`.
   */
  private async pacing(
    access: AccessContext,
    branchId: string | null,
    query: SalesSummaryQuery,
    current: YmdRange,
    boundPremium: number,
  ): Promise<{
    pacing: AnalyticsSalesSummary['pacing'];
    pacingGap: GoalPacingGap | null;
  }> {
    const month = pacingMonth(current);
    if (!month) return { pacing: null, pacingGap: 'not_one_month' };
    if (
      query.policyTypes?.length ||
      query.leadSourceIds?.length ||
      query.carriers?.length
    ) {
      return { pacing: null, pacingGap: 'filtered' };
    }

    // `producerGoals` is a TenantRecord keyed by `producerId`, so the sales
    // clamp applies to it unchanged: own → my goal, branch → my branch's.
    const goals = await this.goalModel
      .find(
        {
          ...this.narrow(
            salesScope<ProducerGoalDocument>(
              access,
              branchId,
              query.producerIds,
            ),
            access,
            query.branchId,
          ),
          month,
          goalPremium: { $gt: 0 },
        },
        { goalPremium: 1 },
      )
      .lean<{ goalPremium: number }[]>();
    if (goals.length === 0) {
      return { pacing: null, pacingGap: 'no_goals_for_month' };
    }

    return {
      pacing: computePacing({
        month,
        goalPremium: goals.reduce((sum, goal) => sum + goal.goalPremium, 0),
        boundPremium,
        producersWithGoals: goals.length,
        windowTo: current.to,
        today: zonedDate(new Date(), access.timeZone),
      }),
      pacingGap: null,
    };
  }

  // ---------------------------------------------------------------------------
  // Breakdown
  // ---------------------------------------------------------------------------

  async breakdown(
    access: AccessContext,
    branchId: string | null,
    query: SalesBreakdownQuery,
  ): Promise<SalesBreakdownResponse> {
    const { period, current, previous } = resolvePeriod(query, access.timeZone);
    const group = SALES_DIMENSIONS[query.groupBy];
    const segment = query.segmentBy ? SALES_DIMENSIONS[query.segmentBy] : null;
    const available: MetricsAvailability = {
      net:
        !group.perLine && !query.policyTypes?.length && !query.carriers?.length,
      quotes: group.quoted !== null && !query.carriers?.length,
    };

    const [now, before] = await Promise.all([
      this.breakdownWindow(access, branchId, query, current, group, segment),
      query.compare
        ? this.breakdownWindow(access, branchId, query, previous, group, null)
        : null,
    ]);

    // Every key either window or either side has — a producer who quoted but
    // never sold is a row, and so is one who sold only last period.
    const keys = new Map<string, string | null>();
    const collect = (map: Map<string, { key: string | null }> | null) => {
      for (const [id, bucket] of map ?? []) keys.set(id, bucket.key);
    };
    collect(now.rows);
    collect(now.quotedRows);
    collect(before?.rows ?? null);
    collect(before?.quotedRows ?? null);

    const names = await this.labelsFor(access, group, [...keys.values()]);
    const segmentNames = segment
      ? await this.labelsFor(
          access,
          segment,
          [...(now.segments?.values() ?? [])].flatMap((map) =>
            [...map.values()].map((bucket) => bucket.key),
          ),
        )
      : null;

    const metricsOf = (
      window: BreakdownWindow,
      id: string,
    ): SalesMetrics | null => {
      const sold = window.rows.get(id)?.acc;
      const quoted = window.quotedRows?.get(id)?.acc;
      if (!sold && !quoted) return null;
      return toSalesMetrics(
        sold ?? emptySold(),
        quoted ?? emptyQuoted(),
        available,
      );
    };

    const totals = toSalesMetrics(now.total, now.quotedTotal, available);
    const previousTotals = before
      ? toSalesMetrics(before.total, before.quotedTotal, available)
      : null;
    const hasPrior = (before?.total.deals.size ?? 0) > 0;

    const rows: SalesBreakdownRow[] = [...keys].map(([id, key]) => {
      const metrics = metricsOf(now, id) ?? zeroSalesMetrics(available);
      const prior = before
        ? (metricsOf(before, id) ?? zeroSalesMetrics(available))
        : null;
      const row: SalesBreakdownRow = {
        key,
        label: this.labelOf(group, key, now, before, id, names),
        metrics,
        share: sharePct(metrics.premium, totals.premium),
        previous: prior,
        change: prior ? changeOf(metrics, prior, hasPrior) : null,
      };
      if (segment && now.segments) {
        const parts = now.segments.get(id);
        row.segments = parts
          ? [...parts.values()]
              .map((bucket): SalesSegment => ({
                key: bucket.key,
                label: this.label(segment, bucket, segmentNames!),
                metrics: toSegmentMetrics(bucket.acc),
              }))
              .sort(byMeasure((s) => s.metrics.premium))
          : [];
      }
      return row;
    });
    rows.sort(byMeasure((row) => row.metrics.premium));

    return {
      period,
      groupBy: query.groupBy,
      segmentBy: query.segmentBy ?? null,
      rows,
      totals,
      previousTotals,
      series: segment ? this.seriesOf(rows) : [],
      unavailable: [
        ...(available.net ? [] : (['netPremium'] as const)),
        ...(available.quotes
          ? []
          : (['quotes', 'quotedPremium', 'closingPct'] as const)),
      ],
    };
  }

  private async breakdownWindow(
    access: AccessContext,
    branchId: string | null,
    query: SalesBreakdownQuery,
    range: YmdRange,
    group: SalesDimension,
    segment: SalesDimension | null,
  ): Promise<BreakdownWindow> {
    const needs = prefixNeeds([group, segment]);
    const quotesWanted = group.quoted !== null && !query.carriers?.length;

    const [[sold], quoted] = await Promise.all([
      this.dealModel.aggregate<SoldFacet>([
        ...linesPrefix(
          this.soldScope(access, branchId, query, range),
          SOLD_LINES,
          query,
          needs.withSource,
          { carrier: needs.carrier, carriers: query.carriers },
        ),
        ...soldBreakdownStages(group, segment),
      ]),
      quotesWanted
        ? this.quoteRecapModel.aggregate<QuotedFacet>([
            ...linesPrefix(
              this.quotedScope(access, branchId, query, range),
              QUOTED_LINES,
              query,
              group.needsSource,
            ),
            ...quotedBreakdownStages(group),
          ])
        : null,
    ]);

    // Segments are folded per row with the same merge rule as the rows, so
    // `Auto` and `PYgez` are one segment inside a producer's bar.
    let segments: BreakdownWindow['segments'] = null;
    if (segment && sold.segments) {
      const byRow = new Map<string, RawSold[]>();
      for (const raw of sold.segments) {
        const rowId = mapKey(rowKey(group.key, raw._id.k).key);
        const list = byRow.get(rowId) ?? [];
        list.push({ ...raw, _id: raw._id.s });
        byRow.set(rowId, list);
      }
      segments = new Map(
        [...byRow].map(([rowId, list]) => [rowId, foldSold(segment.key, list)]),
      );
    }

    const quotedFacet = quoted?.[0];
    return {
      rows: foldSold(group.key, sold.rows),
      segments,
      total: soldTotal(sold.total),
      quotedRows: quotedFacet ? foldQuoted(group.key, quotedFacet.rows) : null,
      quotedTotal: quotedFacet ? quotedTotal(quotedFacet.total) : null,
    };
  }

  // ---------------------------------------------------------------------------
  // Timeseries
  // ---------------------------------------------------------------------------

  async timeseries(
    access: AccessContext,
    branchId: string | null,
    query: SalesTimeseriesQuery,
  ): Promise<SalesTimeseriesResponse> {
    const { period, current, previous } = resolvePeriod(query, access.timeZone);
    const segment = query.segmentBy ? SALES_DIMENSIONS[query.segmentBy] : null;

    const [now, before] = await Promise.all([
      this.timeseriesWindow(access, branchId, query, current, segment),
      query.compare
        ? this.timeseriesWindow(access, branchId, query, previous, null)
        : null,
    ]);

    let series: AnalyticsSeries[] = [];
    if (segment) {
      // Segment keys are normalised already; label them once, then order the
      // series by their premium over the whole window.
      const totals = new Map<string, { key: string | null; premium: number }>();
      for (const bucket of now.buckets) {
        for (const [id, part] of Object.entries(bucket.segments ?? {})) {
          const entry = totals.get(id) ?? {
            key: now.segmentKeys.get(id) ?? null,
            premium: 0,
          };
          entry.premium += part.premium;
          totals.set(id, entry);
        }
      }
      const names = await this.labelsFor(
        access,
        segment,
        [...totals.values()].map((entry) => entry.key),
      );
      series = [...totals.values()]
        .map((entry) => ({
          key: entry.key,
          label: this.label(
            segment,
            {
              key: entry.key,
              label: now.segmentLabels.get(mapKey(entry.key)) ?? null,
            },
            names,
          ),
          premium: entry.premium,
        }))
        .sort(byMeasure((entry) => entry.premium))
        .map(({ key, label }) => ({ key, label }));
    }

    return {
      period,
      interval: query.interval,
      segmentBy: query.segmentBy ?? null,
      buckets: now.buckets,
      previous: before?.buckets ?? null,
      series,
    };
  }

  private async timeseriesWindow(
    access: AccessContext,
    branchId: string | null,
    query: SalesTimeseriesQuery,
    range: YmdRange,
    segment: SalesDimension | null,
  ): Promise<{
    buckets: SalesTimeseriesBucket[];
    segmentKeys: Map<string, string | null>;
    segmentLabels: Map<string, string | null>;
  }> {
    const bucket = ymdBucketExpr('soldDateYmd', query.interval);
    const quotesWanted = !query.carriers?.length;
    const needs = prefixNeeds([segment]);

    const facet: Record<string, PipelineStage.FacetPipelineStage[]> = {
      totals: [
        {
          $group: {
            _id: bucket,
            premium: { $sum: '$linePremium' },
            items: { $sum: '$lineItems' },
            deals: { $sum: 1 },
          },
        },
      ],
    };
    if (segment) {
      facet.segments = [
        ...(segment.perLine ? [{ $unwind: '$lines' } as const] : []),
        {
          $group: {
            _id: { b: bucket, s: segment.sold },
            ...soldMetrics(segment.perLine ? 'line' : 'record'),
          },
        },
      ];
    }

    const [[sold], quoted] = await Promise.all([
      this.dealModel.aggregate<{
        totals: {
          _id: string;
          premium: number;
          items: number;
          deals: number;
        }[];
        segments?: (RawSold & { _id: { b: string; s: unknown } })[];
      }>([
        ...linesPrefix(
          this.soldScope(access, branchId, query, range),
          SOLD_LINES,
          query,
          needs.withSource,
          { carrier: needs.carrier, carriers: query.carriers },
        ),
        ...(needs.household ? [HOUSEHOLD_LOOKUP] : []),
        { $facet: facet },
      ]),
      quotesWanted
        ? this.quoteRecapModel.aggregate<{
            _id: string;
            quotes: number;
            quotedPremium: number;
          }>([
            ...linesPrefix(
              this.quotedScope(access, branchId, query, range),
              QUOTED_LINES,
              query,
              false,
            ),
            {
              $group: {
                _id: ymdBucketExpr('quoteDateYmd', query.interval),
                quotes: { $sum: 1 },
                quotedPremium: { $sum: '$linePremium' },
              },
            },
          ])
        : null,
    ]);

    const totals = new Map(sold.totals.map((row) => [row._id, row]));
    const quotes = new Map((quoted ?? []).map((row) => [row._id, row]));

    // Bucket → segment map key → merged accumulator.
    const segmentKeys = new Map<string, string | null>();
    const segmentLabels = new Map<string, string | null>();
    const parts = new Map<string, Map<string, SoldAccumulator>>();
    if (segment) {
      for (const raw of sold.segments ?? []) {
        const part = rowKey(segment.key, raw._id.s);
        const id = mapKey(part.key);
        segmentKeys.set(id, part.key);
        if (part.label) segmentLabels.set(id, part.label);
        let byPart = parts.get(raw._id.b);
        if (!byPart) {
          byPart = new Map();
          parts.set(raw._id.b, byPart);
        }
        const acc = byPart.get(id) ?? emptySold();
        acc.premium += raw.premium ?? 0;
        acc.items += raw.items ?? 0;
        acc.policies += raw.policies ?? 0;
        for (const deal of raw.deals ?? []) acc.deals.add(String(deal));
        byPart.set(id, acc);
      }
    }

    const buckets = bucketsBetween(range, query.interval).map(
      (b): SalesTimeseriesBucket => {
        const row = totals.get(b.key);
        const quote = quotes.get(b.key);
        const out: SalesTimeseriesBucket = {
          ...b,
          metrics: {
            premium: roundCents(row?.premium ?? 0),
            items: row?.items ?? 0,
            deals: row?.deals ?? 0,
            quotes: quotesWanted ? (quote?.quotes ?? 0) : null,
            quotedPremium: quotesWanted
              ? roundCents(quote?.quotedPremium ?? 0)
              : null,
          },
        };
        if (segment) {
          const byPart = parts.get(b.key);
          const segments: Record<string, SalesSegmentMetrics> = {};
          for (const [id, acc] of byPart ?? []) {
            segments[id] = toSegmentMetrics(acc);
          }
          out.segments = segments;
        }
        return out;
      },
    );

    return { buckets, segmentKeys, segmentLabels };
  }

  // ---------------------------------------------------------------------------
  // Shared
  // ---------------------------------------------------------------------------

  private async soldTotal(
    access: AccessContext,
    branchId: string | null,
    query: SalesSummaryQuery,
    range: YmdRange,
  ): Promise<SoldAccumulator> {
    const rows = await this.dealModel.aggregate<RawSold>([
      ...linesPrefix(
        this.soldScope(access, branchId, query, range),
        SOLD_LINES,
        query,
        false,
        { carriers: query.carriers },
      ),
      { $group: { _id: null, ...soldMetrics('record') } },
    ]);
    return soldTotal(rows);
  }

  private async quotedTotal(
    access: AccessContext,
    branchId: string | null,
    query: SalesSummaryQuery,
    range: YmdRange,
  ) {
    const rows = await this.quoteRecapModel.aggregate<RawQuoted>([
      ...linesPrefix(
        this.quotedScope(access, branchId, query, range),
        QUOTED_LINES,
        query,
        false,
      ),
      {
        $group: {
          _id: null,
          quotedPremium: { $sum: '$linePremium' },
          quotes: { $addToSet: '$_id' },
        },
      },
    ]);
    return quotedTotal(rows);
  }

  private soldScope(
    access: AccessContext,
    branchId: string | null,
    query: SalesSummaryQuery,
    range: YmdRange,
  ) {
    return this.narrow(
      soldMatch(access, branchId, query.producerIds, range),
      access,
      query.branchId,
    );
  }

  private quotedScope(
    access: AccessContext,
    branchId: string | null,
    query: SalesSummaryQuery,
    range: YmdRange,
  ) {
    return this.narrow(
      quotedMatch(access, branchId, query.producerIds, range),
      access,
      query.branchId,
    );
  }

  /**
   * An agency-scope caller's explicit branch. Narrow-only: branch and own
   * scope are pinned already, and `BranchGuard` has refused any other branch
   * before the request got here.
   */
  private narrow<T extends object>(
    match: T,
    access: AccessContext,
    requested: string | undefined,
  ): T {
    return access.dataScope === DataScope.Agency && requested
      ? { ...match, branchId: requested }
      : match;
  }

  private labelsFor(
    access: AccessContext,
    dimension: SalesDimension,
    keys: readonly (string | null)[],
  ): Promise<Map<string, string>> {
    return this.labels.labels(
      access.agencyId!,
      LABEL_KIND[dimension.key],
      keys.filter((key): key is string => key !== null),
    );
  }

  private label(
    dimension: SalesDimension,
    bucket: { key: string | null; label: string | null },
    names: Map<string, string>,
  ): string {
    if (bucket.key === null) return dimension.nullLabel;
    if (bucket.label) return bucket.label;
    return names.get(bucket.key) ?? UNKNOWN_LABEL[LABEL_KIND[dimension.key]];
  }

  private labelOf(
    dimension: SalesDimension,
    key: string | null,
    now: BreakdownWindow,
    before: BreakdownWindow | null,
    id: string,
    names: Map<string, string>,
  ): string {
    const carried =
      now.rows.get(id)?.label ??
      now.quotedRows?.get(id)?.label ??
      before?.rows.get(id)?.label ??
      before?.quotedRows?.get(id)?.label ??
      null;
    return this.label(dimension, { key, label: carried }, names);
  }

  /** Every segment in any row, by its premium across rows; null last. */
  private seriesOf(rows: readonly SalesBreakdownRow[]): AnalyticsSeries[] {
    const totals = new Map<string, AnalyticsSeries & { premium: number }>();
    for (const row of rows) {
      for (const part of row.segments ?? []) {
        const id = mapKey(part.key);
        const entry = totals.get(id) ?? {
          key: part.key,
          label: part.label,
          premium: 0,
        };
        entry.premium += part.metrics.premium;
        totals.set(id, entry);
      }
    }
    return [...totals.values()]
      .sort(byMeasure((entry) => entry.premium))
      .map(({ key, label }) => ({ key, label }));
  }
}
