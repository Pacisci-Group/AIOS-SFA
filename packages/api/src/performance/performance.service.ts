import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { AccessContext, PerformanceResponse } from '@sfa/shared';
import { FilterQuery, Model, PipelineStage } from 'mongoose';
import { buildScopeFilter } from '../common/access/scope-filter';
import { Deal, DealDocument } from '../deals/schemas/deal.schema';
import {
  QuoteRecap,
  QuoteRecapDocument,
} from '../quote-recaps/schemas/quote-recap.schema';
import { GetPerformanceDto } from './dto/get-performance.dto';
import { PerformanceAggregate, toMetric } from './performance.normalize';
import { YmdRange, resolveRange } from './performance.range';

/**
 * The Producer Dashboard scorecards (PAC-10 quoted / PAC-11 sold).
 *
 * **This is the first `.aggregate()` in the API**, so it sets two conventions
 * worth following rather than re-deciding:
 *
 *  1. An aggregation's `$match` is built by the same `buildScopeFilter` a
 *     `find()` would use. A pipeline is not a reason to hand-roll the tenancy
 *     and data-scope clamp a second time — that duplication is exactly what
 *     `common/access/scope-filter` exists to prevent.
 *  2. Results are typed through the `aggregate<T>()` generic, mirroring the
 *     `.lean<T[]>()` discipline the `find()`-based services already use.
 */
@Injectable()
export class PerformanceService {
  constructor(
    @InjectModel(Deal.name) private dealModel: Model<DealDocument>,
    @InjectModel(QuoteRecap.name)
    private quoteRecapModel: Model<QuoteRecapDocument>,
  ) {}

  async get(
    access: AccessContext,
    branchId: string | null,
    query: GetPerformanceDto,
  ): Promise<PerformanceResponse> {
    const range = resolveRange(query.range, {
      from: query.from,
      to: query.to,
    });

    const scope = buildScopeFilter<DealDocument | QuoteRecapDocument>(
      access,
      branchId,
      { requestedScope: query.scope },
    );

    // Two single-collection pipelines rather than one: `$facet` cannot span
    // collections, and there is nothing to facet *within* either of them.
    const [sold, quoted] = await Promise.all([
      this.rollup(this.dealModel, scope, 'soldDateYmd', range),
      this.rollup(this.quoteRecapModel, scope, 'quoteDateYmd', range),
    ]);

    return {
      range: { key: query.range, from: range.from, to: range.to },
      sold: toMetric(sold),
      quoted: toMetric(quoted),
    };
  }

  /**
   * Roll one collection up over the range. Identical shape for deals and
   * recaps — the only differences are the model and the date field, which is
   * why `Deal.soldDateYmd` and `QuoteRecap.quoteDateYmd` were given the same
   * `YYYYMMDD` representation in the first place.
   */
  private async rollup(
    model: Model<DealDocument> | Model<QuoteRecapDocument>,
    scope: FilterQuery<DealDocument | QuoteRecapDocument>,
    dateField: 'soldDateYmd' | 'quoteDateYmd',
    range: YmdRange,
  ): Promise<PerformanceAggregate | undefined> {
    const pipeline: PipelineStage[] = [
      {
        $match: {
          ...scope,
          [dateField]: { $gte: range.startYmd, $lt: range.endYmd },
        },
      },
      {
        $group: {
          _id: null,
          premium: { $sum: { $ifNull: ['$premium', 0] } },
          itemCount: { $sum: { $ifNull: ['$itemCount', 0] } },
          recordCount: { $sum: 1 },
          /*
           * Distinct household identity, with a fallback ladder.
           *
           * `$toString` of a missing field is null and `$concat` with a null
           * operand is null, so the three-arm `$ifNull` reads as: the real ref
           * if present, else the legacy string id, else the row's own id.
           *
           * That last arm means an unattributed row counts as *its own*
           * household. The alternatives are both worse: collapsing every
           * null-household row into one bucket inflates the average without
           * bound on migrated data, and dropping them counts their premium in
           * the numerator while omitting them from the denominator. Counting
           * each separately can only understate the average, and it converges
           * on the true value as `backfill:deal-refs` fills the refs in.
           *
           * The `h:`/`l:`/`r:` prefixes stop a legacy string id from ever
           * colliding with a stringified ObjectId.
           */
          households: {
            $addToSet: {
              $ifNull: [
                { $concat: ['h:', { $toString: '$householdId' }] },
                { $concat: ['l:', '$legacyHouseholdId'] },
                { $concat: ['r:', { $toString: '$_id' }] },
              ],
            },
          },
        },
      },
      {
        $project: {
          _id: 0,
          premium: 1,
          itemCount: 1,
          recordCount: 1,
          householdCount: { $size: '$households' },
        },
      },
    ];

    const [row] = await model.aggregate<PerformanceAggregate>(pipeline);
    // Undefined when the range matched nothing — `$group` on a `_id: null`
    // emits zero documents, not a row of zeroes. `toMetric` handles it.
    return row;
  }
}
