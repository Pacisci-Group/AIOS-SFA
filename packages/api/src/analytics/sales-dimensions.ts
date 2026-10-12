import {
  carrierSlug,
  normalizeCarrier,
  normalizePolicyType,
  type SalesGroupBy,
  type SalesSegmentBy,
} from '@sfa/shared';
import type { PipelineStage } from 'mongoose';
import { HOUSEHOLD_KEY_EXPR } from '../common/sales-metrics/household-key';
import { keyText } from './key-text';

/**
 * The dimensions a sale can be broken down by (PAC-152, part 2).
 *
 * Every pipeline here runs **after** `linesPrefix`, so each document is one
 * sale (or quote) with its `lines[]`, `linePremium`, `lineItems` and — when
 * the dimension asks for it — `sourceId` and per-line `carrier`.
 *
 * ## Record-level and per-line
 *
 * Most dimensions are a fact about the sale (its producer, its branch, its
 * lead's source). Two are a fact about each **policy** in it: its line and its
 * carrier. Those unwind `lines[]` before grouping, so an Auto+Home bundle puts
 * its Auto premium in the Auto row and its Home premium in the Home row. Sums
 * stay additive either way; distinct counts (sales, households) do not, which
 * is why each row carries the distinct ids rather than a count until the
 * service has merged and labelled the rows.
 */
export type DimensionKey = SalesGroupBy | SalesSegmentBy;

export interface SalesDimension {
  key: DimensionKey;
  /** Groups on a field of `lines[]`, so needs `$unwind: '$lines'` first. */
  perLine: boolean;
  /** Needs `sourceId` resolved through the lead (`linesPrefix(withSource)`). */
  needsSource: boolean;
  /** Needs each line's carrier (`linesPrefix({ carrier: true })`). */
  needsCarrier: boolean;
  /** Needs the sale's household (`$lookup households` as `_hh`). */
  needsHousehold: boolean;
  /** The `$group` key on a sale. */
  sold: unknown;
  /** On a quote recap, or `null` where a quote cannot carry the dimension. */
  quoted: unknown;
  /** What the empty bucket is called. */
  nullLabel: string;
}

/** A trimmed, non-empty string, else `null`. */
function trimmedOrNull(expr: unknown) {
  return {
    $let: {
      vars: {
        value: { $trim: { input: { $toString: { $ifNull: [expr, ''] } } } },
      },
      in: { $cond: [{ $eq: ['$$value', ''] }, null, '$$value'] },
    },
  };
}

const HOUSEHOLD_ZIP = { $first: '$_hh.propertyAddress.zip' };
const HOUSEHOLD_CSR = { $first: '$_hh.assignedCrmId' };

export const SALES_DIMENSIONS: Record<DimensionKey, SalesDimension> = {
  producer: {
    key: 'producer',
    perLine: false,
    needsSource: false,
    needsCarrier: false,
    needsHousehold: false,
    sold: { $ifNull: ['$producerId', null] },
    quoted: { $ifNull: ['$producerId', null] },
    nullLabel: 'Unassigned',
  },
  leadSource: {
    key: 'leadSource',
    perLine: false,
    needsSource: true,
    needsCarrier: false,
    needsHousehold: false,
    sold: { $ifNull: ['$sourceId', null] },
    quoted: { $ifNull: ['$sourceId', null] },
    nullLabel: 'No source',
  },
  policyType: {
    key: 'policyType',
    perLine: true,
    needsSource: false,
    needsCarrier: false,
    needsHousehold: false,
    sold: { $ifNull: ['$lines.policyType', null] },
    quoted: { $ifNull: ['$lines.policyType', null] },
    nullLabel: 'Unspecified',
  },
  carrier: {
    key: 'carrier',
    perLine: true,
    needsSource: false,
    needsCarrier: true,
    needsHousehold: false,
    sold: { $ifNull: ['$lines.carrier', null] },
    // A quote recap records no carrier.
    quoted: null,
    nullLabel: 'Unknown carrier',
  },
  branch: {
    key: 'branch',
    perLine: false,
    needsSource: false,
    needsCarrier: false,
    needsHousehold: false,
    sold: { $ifNull: ['$branchId', null] },
    quoted: { $ifNull: ['$branchId', null] },
    nullLabel: 'No branch',
  },
  zip: {
    key: 'zip',
    perLine: false,
    needsSource: false,
    needsCarrier: false,
    needsHousehold: true,
    sold: trimmedOrNull(HOUSEHOLD_ZIP),
    // A recap carries its own property address; the household's wins.
    quoted: trimmedOrNull({
      $ifNull: [HOUSEHOLD_ZIP, '$propertyAddress.zip'],
    }),
    nullLabel: 'No ZIP',
  },
  csr: {
    key: 'csr',
    perLine: false,
    needsSource: false,
    needsCarrier: false,
    needsHousehold: true,
    // The CRM the sale was handed to, else the household's.
    sold: { $ifNull: ['$assignedCrmId', HOUSEHOLD_CSR, null] },
    quoted: { $ifNull: [HOUSEHOLD_CSR, null] },
    nullLabel: 'Unassigned',
  },
};

/** The sale's household, with only what ZIP and CSR need. */
export const HOUSEHOLD_LOOKUP: PipelineStage = {
  $lookup: {
    from: 'households',
    localField: 'householdId',
    foreignField: '_id',
    pipeline: [
      { $project: { _id: 0, 'propertyAddress.zip': 1, assignedCrmId: 1 } },
    ],
    as: '_hh',
  },
};

/** What `linesPrefix` must provide for these dimensions. */
export function prefixNeeds(dimensions: readonly (SalesDimension | null)[]) {
  const present = dimensions.filter((d): d is SalesDimension => d !== null);
  return {
    withSource: present.some((d) => d.needsSource),
    carrier: present.some((d) => d.needsCarrier),
    household: present.some((d) => d.needsHousehold),
  };
}

/** Net of chargebacks — the sale's own total, so record-level only. */
const NET_EXPR = {
  $add: [
    { $ifNull: ['$premium', 0] },
    { $ifNull: ['$chargebackAdjustment', 0] },
  ],
};

/**
 * Sold metrics per group. `record`: one document per sale. `line`: one per
 * policy line (after `$unwind`). Sales and households are collected as
 * distinct ids, counted once the rows are merged.
 */
export function soldMetrics(level: 'record' | 'line') {
  return level === 'record'
    ? {
        premium: { $sum: '$linePremium' },
        items: { $sum: '$lineItems' },
        policies: {
          $sum: {
            $size: {
              $filter: { input: '$lines', as: 'l', cond: '$$l.typed' },
            },
          },
        },
        net: { $sum: NET_EXPR },
        deals: { $addToSet: '$_id' },
        households: { $addToSet: HOUSEHOLD_KEY_EXPR },
      }
    : {
        premium: { $sum: '$lines.premium' },
        items: { $sum: '$lines.items' },
        policies: { $sum: { $cond: ['$lines.typed', 1, 0] } },
        deals: { $addToSet: '$_id' },
        households: { $addToSet: HOUSEHOLD_KEY_EXPR },
      };
}

/** Quoted metrics per group, on the same two levels. */
export function quotedMetrics(level: 'record' | 'line') {
  return level === 'record'
    ? {
        quotedPremium: { $sum: '$linePremium' },
        quotes: { $addToSet: '$_id' },
      }
    : {
        quotedPremium: { $sum: '$lines.premium' },
        quotes: { $addToSet: '$_id' },
      };
}

const UNWIND: PipelineStage.Unwind = { $unwind: '$lines' };

/**
 * The sold breakdown's tail: one `$facet` with the rows, the segments (when
 * asked for) and the window's total, each at the level its dimension needs.
 *
 * The total is always record-level, so its sales and households are true
 * distinct counts and its net premium is computable.
 */
export function soldBreakdownStages(
  group: SalesDimension,
  segment: SalesDimension | null,
): PipelineStage[] {
  const needs = prefixNeeds([group, segment]);
  const segmentPerLine = group.perLine || Boolean(segment?.perLine);
  const facet: Record<string, PipelineStage.FacetPipelineStage[]> = {
    rows: [
      ...(group.perLine ? [UNWIND] : []),
      {
        $group: {
          _id: group.sold,
          ...soldMetrics(group.perLine ? 'line' : 'record'),
        },
      },
    ],
    total: [{ $group: { _id: null, ...soldMetrics('record') } }],
  };
  if (segment) {
    facet.segments = [
      ...(segmentPerLine ? [UNWIND] : []),
      {
        $group: {
          _id: { k: group.sold, s: segment.sold },
          ...soldMetrics(segmentPerLine ? 'line' : 'record'),
        },
      },
    ];
  }
  return [...(needs.household ? [HOUSEHOLD_LOOKUP] : []), { $facet: facet }];
}

/** The quoted twin: rows and total, never segments. */
export function quotedBreakdownStages(group: SalesDimension): PipelineStage[] {
  if (group.quoted === null) return [];
  return [
    ...(group.needsHousehold ? [HOUSEHOLD_LOOKUP] : []),
    {
      $facet: {
        rows: [
          ...(group.perLine ? [UNWIND] : []),
          {
            $group: {
              _id: group.quoted,
              ...quotedMetrics(group.perLine ? 'line' : 'record'),
            },
          },
        ],
        total: [{ $group: { _id: null, ...quotedMetrics('record') } }],
      },
    },
  ];
}

/**
 * A raw group key as the row key the page sees, plus the label a
 * self-describing key already carries. Ids are labelled later, in a batch.
 *
 * Per-line keys are **normalised here** so the service can merge buckets that
 * are one thing stored several ways: `Auto` / `PYgez`, `Allstate` / `B4tEH`.
 * A carrier's key is its slug, so `Allstate` and `allstate` are one row.
 */
export function rowKey(
  dimension: DimensionKey,
  raw: unknown,
): { key: string | null; label: string | null } {
  const text = keyText(raw);
  if (text === null) return { key: null, label: null };
  switch (dimension) {
    case 'policyType': {
      const label = normalizePolicyType(text);
      return label ? { key: label, label } : { key: null, label: null };
    }
    case 'carrier': {
      const label = normalizeCarrier(text);
      const slug = carrierSlug(label);
      return slug ? { key: slug, label } : { key: null, label: null };
    }
    case 'zip':
      return { key: text, label: text };
    default:
      // An id: producer, CSR, lead source, branch — labelled in a batch.
      return { key: text, label: null };
  }
}
