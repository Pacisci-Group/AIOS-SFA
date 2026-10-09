import type {
  AnalyticsChange,
  OwnerTrend,
  SalesMetrics,
  SalesSegmentMetrics,
  ServiceMetrics,
} from '@sfa/shared';
import {
  closingPct,
  roundCents,
  toTrend,
} from '../owner-dashboard/owner-dashboard.normalize';
import { type DimensionKey, rowKey } from './sales-dimensions';

/**
 * Folding raw `$group` rows into the page's rows (PAC-152, part 2). Pure, so
 * the merge and reconciliation rules are unit-tested without a database.
 */

/** A sold `$group` row as Mongo returns it. */
export interface RawSold {
  _id: unknown;
  premium: number;
  items: number;
  policies: number;
  /** Record-level groups only. */
  net?: number;
  deals: unknown[];
  households: string[];
}

/** A quoted `$group` row. */
export interface RawQuoted {
  _id: unknown;
  quotedPremium: number;
  quotes: unknown[];
}

/** One merged bucket: sums plus the distinct ids behind the counts. */
export interface SoldAccumulator {
  premium: number;
  items: number;
  policies: number;
  net: number | null;
  deals: Set<string>;
  households: Set<string>;
}

export interface QuotedAccumulator {
  quotedPremium: number;
  quotes: Set<string>;
}

export function emptySold(): SoldAccumulator {
  return {
    premium: 0,
    items: 0,
    policies: 0,
    net: null,
    deals: new Set(),
    households: new Set(),
  };
}

export function emptyQuoted(): QuotedAccumulator {
  return { quotedPremium: 0, quotes: new Set() };
}

function addSold(into: SoldAccumulator, row: RawSold): void {
  into.premium += row.premium ?? 0;
  into.items += row.items ?? 0;
  into.policies += row.policies ?? 0;
  if (typeof row.net === 'number') into.net = (into.net ?? 0) + row.net;
  for (const id of row.deals ?? []) into.deals.add(String(id));
  for (const key of row.households ?? []) into.households.add(key);
}

function addQuoted(into: QuotedAccumulator, row: RawQuoted): void {
  into.quotedPremium += row.quotedPremium ?? 0;
  for (const id of row.quotes ?? []) into.quotes.add(String(id));
}

export interface Bucket<A> {
  key: string | null;
  /** The label a self-describing key carries; ids are labelled later. */
  label: string | null;
  acc: A;
}

/** `''` is the null bucket's map key. */
export const mapKey = (key: string | null) => key ?? '';

/**
 * Merge raw sold rows into one bucket per **normalised** key — `Auto` and its
 * SmartSuite code `PYgez` are one row, `Allstate` and `B4tEH` are one row.
 * Sums add; sales and households are unions, so a merged row never counts
 * the same sale twice.
 */
export function foldSold(
  dimension: DimensionKey,
  rows: readonly RawSold[],
): Map<string, Bucket<SoldAccumulator>> {
  const buckets = new Map<string, Bucket<SoldAccumulator>>();
  for (const row of rows) {
    const { key, label } = rowKey(dimension, row._id);
    const id = mapKey(key);
    let bucket = buckets.get(id);
    if (!bucket) {
      bucket = { key, label, acc: emptySold() };
      buckets.set(id, bucket);
    }
    addSold(bucket.acc, row);
  }
  return buckets;
}

export function foldQuoted(
  dimension: DimensionKey,
  rows: readonly RawQuoted[],
): Map<string, Bucket<QuotedAccumulator>> {
  const buckets = new Map<string, Bucket<QuotedAccumulator>>();
  for (const row of rows) {
    const { key, label } = rowKey(dimension, row._id);
    const id = mapKey(key);
    let bucket = buckets.get(id);
    if (!bucket) {
      bucket = { key, label, acc: emptyQuoted() };
      buckets.set(id, bucket);
    }
    addQuoted(bucket.acc, row);
  }
  return buckets;
}

/** A single total row (`_id: null`) as an accumulator. */
export function soldTotal(rows: readonly RawSold[]): SoldAccumulator {
  const acc = emptySold();
  for (const row of rows) addSold(acc, row);
  return acc;
}

export function quotedTotal(rows: readonly RawQuoted[]): QuotedAccumulator {
  const acc = emptyQuoted();
  for (const row of rows) addQuoted(acc, row);
  return acc;
}

export interface MetricsAvailability {
  /** Net premium is a sale's total: undefined per policy, or under a line filter. */
  net: boolean;
  /** A quote cannot carry a carrier, so quote figures are undefined there. */
  quotes: boolean;
}

/** An accumulator pair as the metrics the page shows. */
export function toSalesMetrics(
  sold: SoldAccumulator,
  quoted: QuotedAccumulator | null,
  available: MetricsAvailability,
): SalesMetrics {
  const premium = roundCents(sold.premium);
  const deals = sold.deals.size;
  if (!available.quotes || !quoted) {
    return {
      premium,
      netPremium: available.net ? roundCents(sold.net ?? 0) : null,
      items: sold.items,
      deals,
      policies: sold.policies,
      households: sold.households.size,
      quotes: null,
      quotedPremium: null,
      closingPct: null,
      closingGap: 'not_available',
    };
  }
  const quotedPremium = roundCents(quoted.quotedPremium);
  const { pct, gap } = closingPct({
    soldPremium: premium,
    quotedPremium,
    quoteCount: quoted.quotes.size,
    soldCount: deals,
  });
  return {
    premium,
    netPremium: available.net ? roundCents(sold.net ?? 0) : null,
    items: sold.items,
    deals,
    policies: sold.policies,
    households: sold.households.size,
    quotes: quoted.quotes.size,
    quotedPremium,
    closingPct: pct,
    closingGap: gap,
  };
}

export function toSegmentMetrics(sold: SoldAccumulator): SalesSegmentMetrics {
  return {
    premium: roundCents(sold.premium),
    items: sold.items,
    policies: sold.policies,
    deals: sold.deals.size,
  };
}

/** Zero metrics with the same availability — a row only the other window has. */
export function zeroSalesMetrics(available: MetricsAvailability): SalesMetrics {
  return toSalesMetrics(emptySold(), emptyQuoted(), available);
}

/** `part ÷ whole` as a percentage, one decimal; `null` over nothing. */
export function sharePct(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;
}

/** Metrics whose change is in points, not percent. */
const POINT_METRICS = new Set(['closingPct']);

/**
 * Change per numeric metric against the comparison window. `hasPrior` is the
 * Owner dashboard's rule: asked of the *window*, not of the row — a producer
 * with no sales last month against a window that had sales is "up from
 * nothing" (`null`), while a window that had nothing at all is no comparison.
 */
export function changeOf<M extends object>(
  current: M,
  previous: M,
  hasPrior: boolean,
): AnalyticsChange<M> {
  const change: AnalyticsChange<M> = {};
  for (const metric of Object.keys(current) as (keyof M)[]) {
    const now = current[metric];
    const then = previous[metric];
    if (typeof now !== 'number' && now !== null) continue;
    if (typeof then !== 'number' && then !== null) continue;
    const unit: OwnerTrend['unit'] = POINT_METRICS.has(String(metric))
      ? 'points'
      : 'percent';
    change[metric] = toTrend(
      (now as number | null) ?? null,
      (then as number | null) ?? null,
      hasPrior,
      unit,
    ).change;
  }
  return change;
}

/** Service metrics as returned by the `$group`. */
export interface RawService {
  _id: unknown;
  opened: number;
  resolved: number;
  stillOpen: number;
  overdue: number;
  hoursSum: number;
}

export function toServiceMetrics(row: RawService | undefined): ServiceMetrics {
  if (!row) {
    return {
      opened: 0,
      resolved: 0,
      stillOpen: 0,
      overdue: 0,
      avgHoursToResolve: null,
    };
  }
  return {
    opened: row.opened,
    resolved: row.resolved,
    stillOpen: row.stillOpen,
    overdue: row.overdue,
    avgHoursToResolve:
      row.resolved > 0
        ? Math.round((row.hoursSum / row.resolved) * 10) / 10
        : null,
  };
}

/** Sort: headline measure desc, then label; the null bucket last. */
export function byMeasure<T extends { key: string | null; label: string }>(
  measure: (row: T) => number,
) {
  return (a: T, b: T) =>
    Number(a.key === null) - Number(b.key === null) ||
    measure(b) - measure(a) ||
    a.label.localeCompare(b.label);
}
