import type { DataExportOption } from './data-export';
import type {
  OwnerClosingRatio,
  OwnerDashboardPeriod,
  OwnerRatioGap,
  OwnerTrend,
} from './owner-dashboard';

/**
 * The Analytics page (PAC-152, part 2) — the wire contract between
 * `GET /analytics/*` and the web page.
 *
 * Sales are broken down by any one dimension (optionally split by a second),
 * charted over time at a chosen grain, and summarised with goal pacing.
 * Service tickets get the same treatment. Every sales figure comes through the
 * same pipeline as the Owner dashboard (`soldMatch` + `linesPrefix`), so the
 * page's totals equal that dashboard's for the same filters.
 *
 * ## Additive and distinct
 *
 * `premium`, `items` and `policies` are sums: a breakdown's rows always add up
 * to its totals, null-key rows ("Unassigned", "No source") included. `deals`
 * and `households` are **distinct counts**: under a per-policy dimension (line,
 * carrier) a bundle counts once in each of its lines, so those two columns do
 * not add up — the totals row is the true count.
 */

/** Dimensions a sales breakdown can be grouped by. */
export const SALES_GROUP_BY = [
  'producer',
  'leadSource',
  'policyType',
  'carrier',
  'branch',
  'zip',
  'csr',
] as const;
export type SalesGroupBy = (typeof SALES_GROUP_BY)[number];

/** Dimensions a breakdown or trend can be split into series by. */
export const SALES_SEGMENT_BY = [
  'policyType',
  'carrier',
  'leadSource',
  'producer',
  'branch',
] as const;
export type SalesSegmentBy = (typeof SALES_SEGMENT_BY)[number];

/** Dimensions a service breakdown can be grouped by. */
export const SERVICE_GROUP_BY = [
  'category',
  'policyType',
  'status',
  'priority',
  'assignee',
  'branch',
] as const;
export type ServiceGroupBy = (typeof SERVICE_GROUP_BY)[number];

/** Time grains for a trend. */
export const ANALYTICS_INTERVALS = ['day', 'week', 'month'] as const;
export type AnalyticsInterval = (typeof ANALYTICS_INTERVALS)[number];

/** What a sales row measures. `null` = not available for this grouping. */
export interface SalesMetrics {
  /** Bound premium — Σ policy-line premium, the Owner dashboard's figure. */
  premium: number;
  /**
   * Bound premium after chargebacks (`deal.premium + chargebackAdjustment`).
   * `null` under a per-policy dimension (line, carrier): a chargeback belongs
   * to the sale, not to one of its policies.
   */
  netPremium: number | null;
  items: number;
  /** Distinct sales. Not additive across per-policy rows. */
  deals: number;
  /** Policies sold (typed policy lines). */
  policies: number;
  /** Distinct households sold to. Not additive across rows. */
  households: number;
  /** Quote recaps. `null` where a quote cannot carry the dimension (carrier). */
  quotes: number | null;
  quotedPremium: number | null;
  /** Bound ÷ quoted premium, %. `null` with `closingGap` saying why. */
  closingPct: number | null;
  closingGap: OwnerRatioGap | 'not_available' | null;
}

/** A series inside a row — `segmentBy`'s split. Sold side only. */
export interface SalesSegmentMetrics {
  premium: number;
  items: number;
  policies: number;
  deals: number;
}

export interface AnalyticsSeries {
  /** `null` is the dimension's empty bucket ("Unassigned", "No source"…). */
  key: string | null;
  label: string;
}

export interface SalesSegment extends AnalyticsSeries {
  metrics: SalesSegmentMetrics;
}

/** Change per metric against the comparison window, `null` where undefined. */
export type AnalyticsChange<M> = { [K in keyof M]?: number | null };

export interface AnalyticsBreakdownRow<M, S = never> extends AnalyticsSeries {
  metrics: M;
  /** This row's share of the total of the panel's headline measure, %. */
  share: number | null;
  /** The same row in the comparison window, when `compare` was asked for. */
  previous: M | null;
  change: AnalyticsChange<M> | null;
  /** Present when `segmentBy` was asked for. */
  segments?: S[];
}

export type SalesBreakdownRow = AnalyticsBreakdownRow<
  SalesMetrics,
  SalesSegment
>;

/** `GET /analytics/sales/breakdown`. */
export interface SalesBreakdownResponse {
  period: OwnerDashboardPeriod;
  groupBy: SalesGroupBy;
  segmentBy: SalesSegmentBy | null;
  rows: SalesBreakdownRow[];
  totals: SalesMetrics;
  /** The comparison window's totals, when `compare` was asked for. */
  previousTotals: SalesMetrics | null;
  /** Every segment that appears in any row, in display order — the chart's series. */
  series: AnalyticsSeries[];
  /** Metrics `null` in every row for this grouping — the table hides them. */
  unavailable: (keyof SalesMetrics)[];
}

/**
 * One bucket's figures. Quotes are bucketed by quote date, sales by sold date.
 * Quote figures are `null` under a carrier filter — a quote records no carrier.
 */
export interface SalesTimeseriesMetrics {
  premium: number;
  items: number;
  deals: number;
  quotes: number | null;
  quotedPremium: number | null;
}

export interface AnalyticsBucket {
  /** `YYYY-MM-DD` (day / week start) or `YYYY-MM` (month). */
  key: string;
  /** Inclusive calendar bounds, clamped to the window. */
  from: string;
  to: string;
}

export interface SalesTimeseriesBucket extends AnalyticsBucket {
  metrics: SalesTimeseriesMetrics;
  /** Present when `segmentBy` was asked for, keyed by series key (`''` = null). */
  segments?: Record<string, SalesSegmentMetrics>;
}

/** `GET /analytics/sales/timeseries`. */
export interface SalesTimeseriesResponse {
  period: OwnerDashboardPeriod;
  interval: AnalyticsInterval;
  segmentBy: SalesSegmentBy | null;
  buckets: SalesTimeseriesBucket[];
  /**
   * The comparison window, bucketed the same way and aligned **by position**
   * (bucket 1 against bucket 1), when `compare` was asked for.
   */
  previous: SalesTimeseriesBucket[] | null;
  series: AnalyticsSeries[];
}

/**
 * Where the goal stands for the month the window covers. Goals are monthly
 * premium targets (`producerGoals`, PAC-116); this sums the goals of every
 * producer in the filter.
 */
export interface GoalPacing {
  /** `YYYY-MM`. */
  month: string;
  goalPremium: number;
  /** The summary's own bound premium, so the card and the KPI agree. */
  boundPremium: number;
  /** Producers in scope with a goal for the month. */
  producersWithGoals: number;
  elapsedDays: number;
  daysInMonth: number;
  elapsedPct: number;
  /** Where the goal says the month should be by now: goal × elapsed share. */
  expectedToDate: number;
  /** Bound ÷ elapsed days × days in month. `null` before the month starts. */
  projectedPremium: number | null;
  /** Bound ÷ goal, %. */
  attainmentPct: number | null;
  status: 'achieved' | 'ahead' | 'behind';
}

/**
 * Why there is no pacing card.
 *
 * - `not_one_month`: the window is not the start of a single calendar month
 *   (a goal is a month; pacing a quarter against it means nothing).
 * - `filtered`: a line, source or carrier filter is on. A goal is the whole
 *   month's premium, and a slice of the sales measured against it would read
 *   as permanently behind.
 * - `no_goals_for_month`: nobody in the filter has a goal for that month.
 */
export type GoalPacingGap = 'not_one_month' | 'filtered' | 'no_goals_for_month';

/** `GET /analytics/sales/summary` — the KPI row. */
export interface AnalyticsSalesSummary {
  period: OwnerDashboardPeriod;
  premium: OwnerTrend;
  netPremium: OwnerTrend;
  items: OwnerTrend;
  policies: OwnerTrend;
  households: OwnerTrend;
  avgPremiumPerHousehold: OwnerTrend;
  /** `null` under a carrier filter: quotes record no carrier. */
  closingRatio: OwnerClosingRatio | null;
  pacing: GoalPacing | null;
  pacingGap: GoalPacingGap | null;
}

/** What a service row measures, over tickets **opened** in the window. */
export interface ServiceMetrics {
  opened: number;
  /** Of those, resolved since. */
  resolved: number;
  /** Of those, still open now. */
  stillOpen: number;
  /** Of those, overdue now. */
  overdue: number;
  /** Mean opened → resolved, hours, over the resolved ones. */
  avgHoursToResolve: number | null;
}

export type ServiceBreakdownRow = AnalyticsBreakdownRow<ServiceMetrics>;

/** `GET /analytics/service/breakdown`. */
export interface ServiceBreakdownResponse {
  period: OwnerDashboardPeriod;
  groupBy: ServiceGroupBy;
  rows: ServiceBreakdownRow[];
  totals: ServiceMetrics;
  previousTotals: ServiceMetrics | null;
}

/** `GET /analytics/service/summary`. */
export interface ServiceSummary {
  period: OwnerDashboardPeriod;
  /** Tickets opened in the window. */
  opened: OwnerTrend;
  /** Tickets resolved in the window, whenever they were opened. */
  resolved: OwnerTrend;
  /** Mean opened → resolved, hours, over the window's resolved tickets. */
  avgHoursToResolve: OwnerTrend;
  /** A snapshot, not a window: open work right now, within the filters. */
  openNow: number;
  overdueNow: number;
  byStatusNow: { status: string; count: number }[];
}

export interface ServiceTimeseriesBucket extends AnalyticsBucket {
  /** Opened in the bucket. */
  opened: number;
  /** Resolved in the bucket, whenever opened. */
  resolved: number;
}

/** `GET /analytics/service/timeseries`. */
export interface ServiceTimeseriesResponse {
  period: OwnerDashboardPeriod;
  interval: AnalyticsInterval;
  buckets: ServiceTimeseriesBucket[];
}

/**
 * `GET /analytics/options` — what the caller may filter by, behind
 * `analytics:read` alone (a Branch Manager holds `agency:users:read`, but a
 * producer granted the page does not).
 */
export interface AnalyticsOptionsResponse {
  branches: DataExportOption[];
  producers: DataExportOption[];
  /** People tickets in scope are assigned to — the Service tab's filter. */
  assignees: DataExportOption[];
  /** Carrier display names, alias codes folded in. */
  carriers: string[];
}
