import { LEAD_SOURCE_NONE, policyTypeQueryValues } from '@sfa/shared';
import { PipelineStage, Types } from 'mongoose';
import { AGENCY_TIME_ZONE } from '../../performance/performance.range';
import type { YmdRange } from '../../performance/performance.range';

/**
 * The shared front half of every Owner dashboard aggregation (PAC-135).
 *
 * A sale and a quote are both turned into the same thing — a record carrying
 * `lines[]` of `{ policyType, premium, items }` plus an effective `sourceId` —
 * and only then filtered and grouped. That is what makes "every card and table
 * is a different grouping of one matched set" true in code rather than by
 * convention: the KPI row, the leaderboard and the lead-source table all start
 * from {@link linesPrefix} with the same arguments.
 *
 * Pure functions of their inputs, so the stage lists can be unit-tested without
 * a database.
 */

/** Which collection the prefix is being built for. */
export interface LinesSource {
  /** Where the per-policy rows live. */
  lines:
    | { kind: 'lookup'; from: string; foreignField: string; itemsField: string }
    | { kind: 'embedded'; path: string; itemsField: string };
  /** The record's own premium / item totals — the fallback line. */
  itemsField: string;
  /** The record's own list of policy types — what a lineless record matches on. */
  typesField: string;
  /** `true` when the record itself carries a fallback `leadSourceId`. */
  ownSource: boolean;
}

/** Sold deals: lines are the `policies` rows pointing back at the deal. */
export const SOLD_LINES: LinesSource = {
  lines: {
    kind: 'lookup',
    from: 'policies',
    foreignField: 'dealId',
    itemsField: 'items',
  },
  itemsField: 'itemCount',
  typesField: 'policyTypes',
  ownSource: true,
};

/** Quote recaps: lines are embedded. Migrated recaps have none. */
export const QUOTED_LINES: LinesSource = {
  lines: { kind: 'embedded', path: 'policies', itemsField: 'itemCount' },
  itemsField: 'itemCount',
  typesField: 'productsQuoted',
  ownSource: false,
};

export interface OwnerFilterClauses {
  /** Canonical policy-type labels, or none for "every line of business". */
  policyTypes?: readonly string[];
  /** `leadSources` ids and/or `LEAD_SOURCE_NONE`, or none for "every source". */
  leadSourceIds?: readonly string[];
}

/**
 * Every stored spelling of the selected policy types.
 *
 * `deals.policyTypes` holds labels, `quoteRecaps.productsQuoted` raw SmartSuite
 * codes on migrated rows, and `policies.policyType` either — so a filter on the
 * canonical label alone would silently miss most of history.
 */
export function policyTypeValues(
  policyTypes: readonly string[] | undefined,
): string[] | null {
  if (!policyTypes?.length) return null;
  return [...new Set(policyTypes.flatMap(policyTypeQueryValues))];
}

/**
 * Stages that resolve `sourceId`, the lead source a record is attributed to.
 *
 * **The lead owns the source.** A sale and the quotes that led to it must land
 * under the same source or a conversion rate is meaningless, so both resolve it
 * through their lead; correcting the lead moves all of them at once. The record's
 * own `leadSourceId` — only deals have one — is the fallback for a deal with no
 * lead, *and* for a lead that has no source of its own: a lead that says nothing
 * is not evidence against what the sale recorded.
 *
 * A `$lookup` on `leads._id` — the primary key — over rows a date range already
 * narrowed. Included only when something downstream needs it.
 */
export function sourceStages(ownSource: boolean): PipelineStage[] {
  return [
    {
      $lookup: {
        from: 'leads',
        localField: 'leadId',
        foreignField: '_id',
        pipeline: [{ $project: { _id: 0, leadSourceId: 1 } }],
        as: '_lead',
      },
    },
    {
      $addFields: {
        sourceId: {
          $ifNull: [
            { $first: '$_lead.leadSourceId' },
            ...(ownSource ? ['$leadSourceId'] : []),
            null,
          ],
        },
      },
    },
  ];
}

/** The `$match` for a lead-source selection, `LEAD_SOURCE_NONE` included. */
export function sourceMatch(
  leadSourceIds: readonly string[] | undefined,
  field = 'sourceId',
): PipelineStage[] {
  if (!leadSourceIds?.length) return [];
  const values: (Types.ObjectId | null)[] = leadSourceIds
    .filter((id) => id !== LEAD_SOURCE_NONE && Types.ObjectId.isValid(id))
    .map((id) => new Types.ObjectId(id));
  // `null` in an `$in` matches an absent field as well as an explicit null.
  if (leadSourceIds.includes(LEAD_SOURCE_NONE)) values.push(null);
  return [{ $match: { [field]: { $in: values } } }];
}

/**
 * `match` → (source) → lines → (LOB filter) → per-record totals.
 *
 * After this prefix every document carries:
 *  - `sourceId` — when `withSource`
 *  - `lines[]` — the policy lines that survived the LOB filter
 *  - `linePremium`, `lineItems` — summed from those lines, **not** the record's
 *    own totals, so an Auto+Home sale filtered to Auto contributes only Auto
 *
 * ## A record with no lines
 *
 * 10 of ~1,700 migrated deals have no policy rows, and no migrated quote recap
 * has embedded lines at all. Such a record becomes **one untyped line** holding
 * its own totals, so it counts in full when no LOB filter is on. Under a filter
 * it is kept when its own type list *contains* a selected type — the whole
 * amount, because there is nothing to split it by. That makes LOB-filtered
 * quoted premium approximate on historic data, which is the honest limit of
 * what was recorded.
 */
export function linesPrefix(
  match: Record<string, unknown>,
  source: LinesSource,
  filter: OwnerFilterClauses,
  withSource: boolean,
): PipelineStage[] {
  const stages: PipelineStage[] = [{ $match: match }];

  const needsSource = withSource || Boolean(filter.leadSourceIds?.length);
  if (needsSource) {
    stages.push(...sourceStages(source.ownSource));
    stages.push(...sourceMatch(filter.leadSourceIds));
  }

  if (source.lines.kind === 'lookup') {
    stages.push({
      $lookup: {
        from: source.lines.from,
        localField: '_id',
        foreignField: source.lines.foreignField,
        pipeline: [
          { $match: { isTestRecord: { $ne: true } } },
          { $project: { _id: 0, policyType: 1, premium: 1, items: 1 } },
        ],
        as: '_rows',
      },
    });
  } else {
    stages.push({
      $addFields: { _rows: { $ifNull: [`$${source.lines.path}`, []] } },
    });
  }

  const rowItems = `$$row.${source.lines.itemsField}`;
  stages.push({
    $addFields: {
      lines: {
        $cond: [
          { $gt: [{ $size: '$_rows' }, 0] },
          {
            $map: {
              input: '$_rows',
              as: 'row',
              in: {
                policyType: '$$row.policyType',
                premium: { $ifNull: ['$$row.premium', 0] },
                items: { $ifNull: [rowItems, 0] },
                typed: true,
              },
            },
          },
          [
            {
              policyType: null,
              premium: { $ifNull: ['$premium', 0] },
              items: { $ifNull: [`$${source.itemsField}`, 0] },
              typed: false,
            },
          ],
        ],
      },
    },
  });

  const values = policyTypeValues(filter.policyTypes);
  if (values) {
    const ownTypes = { $ifNull: [`$${source.typesField}`, []] };
    stages.push(
      {
        $addFields: {
          lines: {
            $filter: {
              input: '$lines',
              as: 'line',
              cond: {
                $or: [
                  { $in: ['$$line.policyType', values] },
                  {
                    $and: [
                      { $eq: ['$$line.typed', false] },
                      {
                        $gt: [
                          { $size: { $setIntersection: [ownTypes, values] } },
                          0,
                        ],
                      },
                    ],
                  },
                ],
              },
            },
          },
        },
      },
      // Nothing of the selected types on this record at all.
      { $match: { 'lines.0': { $exists: true } } },
    );
  }

  stages.push({
    $addFields: {
      linePremium: { $sum: '$lines.premium' },
      lineItems: { $sum: '$lines.items' },
    },
  });

  return stages;
}

/**
 * A lead's creation day as a `YYYYMMDD` integer, comparable with the windows
 * {@link YmdRange} describes.
 *
 * Leads carry an instant, not a calendar day, and the instant has two
 * provenances: the app writes a real one, while the migration wrote SmartSuite's
 * **date-only** value as UTC midnight. Reading a UTC-midnight value in Chicago
 * lands it on the previous day — the same trap `quoteDateYmd` documents in
 * `quote.normalize.ts`, solved the same way: exactly-midnight-UTC is read as a
 * UTC date, anything else as a Chicago one.
 */
export const LEAD_CREATED_YMD_EXPR = {
  $let: {
    vars: { created: { $ifNull: ['$createdDate', '$createdAt'] } },
    in: {
      $toInt: {
        $dateToString: {
          date: '$$created',
          format: '%Y%m%d',
          timezone: {
            $cond: [
              { $eq: [{ $mod: [{ $toLong: '$$created' }, 86_400_000] }, 0] },
              'UTC',
              AGENCY_TIME_ZONE,
            ],
          },
        },
      },
    },
  },
} as const;

/** The half-open Ymd window as a `$match` clause on `field`. */
export function ymdWindow(
  field: string,
  range: YmdRange,
): Record<string, unknown> {
  return { [field]: { $gte: range.startYmd, $lt: range.endYmd } };
}
