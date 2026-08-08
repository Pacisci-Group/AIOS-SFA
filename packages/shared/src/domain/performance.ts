/**
 * The Producer Dashboard scorecards — Sold (PAC-11) and Quoted (PAC-10).
 *
 * Both cards are served by one request, because they always show the same time
 * range and splitting them would let the two halves of a single visual row
 * disagree mid-refresh.
 */

export const PERFORMANCE_RANGE_KEYS = [
  'today',
  'week',
  'mtd',
  'lastMonth',
  'custom',
] as const;

export type PerformanceRangeKey = (typeof PERFORMANCE_RANGE_KEYS)[number];

/**
 * The window the server actually used, echoed back.
 *
 * The client sends a key and gets dates in return, so a preset and a custom
 * window render through one code path and the browser never has to work out
 * what "this month" means in the agency's timezone.
 */
export interface PerformanceRange {
  key: PerformanceRangeKey;
  /** Chicago calendar dates, `YYYY-MM-DD`. **`to` is inclusive.** */
  from: string;
  to: string;
}

export interface PerformanceMetric {
  premium: number;
  /** Items, not records — a deal with three policies counts three. */
  itemCount: number;
  /** Matching documents. Exposed so the averages below are auditable. */
  recordCount: number;
  /** Distinct households across those documents — the averages' denominator. */
  householdCount: number;
  /**
   * `null`, never `0`, when there are no households: an average of nothing is
   * not zero. The UI renders an em dash.
   */
  avgPremiumPerHousehold: number | null;
  avgItemsPerHousehold: number | null;
}

export interface PerformanceResponse {
  range: PerformanceRange;
  sold: PerformanceMetric;
  quoted: PerformanceMetric;
}
