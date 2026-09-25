/**
 * The Owner View dashboard — "Strategy Hub" (PAC-135).
 *
 * ## One filter, three reads
 *
 * The page is a KPI row, a producer leaderboard and a lead-source table, each
 * its own request so one can fail without blanking the others. All three take
 * the **same** filter and compile it to the same match, so they are different
 * groupings of one set of rows — which is what lets the page promise that the
 * leaderboard total, the lead-source total and the Total Bound Premium card
 * agree. That promise needs two rows a tidier table would drop: a producer row
 * for sales with no producer, and a source row for sales with no source.
 *
 * ## Sold numbers come from policy lines
 *
 * A deal is one sale and may hold several policies — Auto $1,200 + Home $1,800
 * is one $3,000 deal. "Line of business" is the *policy's* type, so filtering to
 * Auto must show $1,200, not $3,000. Every sold figure here is therefore summed
 * from the deal's policy rows; a deal with none contributes one untyped line
 * carrying its own totals, so it still counts when no LOB filter is on.
 *
 * ## Live, not pre-aggregated
 *
 * Distinct households are not additive across days and three multi-select
 * filters would need a cube as fine as the rows themselves, so there is no
 * rollup to build — and a live read reflects a sold-deal edit for free.
 */

/** The period chips. `custom` adds `from`/`to`. */
export const OWNER_DASHBOARD_RANGE_KEYS = [
  'mtd',
  'lastMonth',
  'last3Months',
  'ytd',
  'lastYear',
  'custom',
] as const;

export type OwnerDashboardRangeKey =
  (typeof OWNER_DASHBOARD_RANGE_KEYS)[number];

/** Chicago calendar dates, `YYYY-MM-DD`. **`to` is inclusive.** */
export interface OwnerDashboardWindow {
  from: string;
  to: string;
}

/**
 * The windows the server actually used, echoed back — the client never works
 * out what "this month" or "the same period last month" means.
 */
export interface OwnerDashboardPeriod {
  key: OwnerDashboardRangeKey;
  current: OwnerDashboardWindow;
  /** What the trend badges compare against — see `resolveComparison`. */
  previous: OwnerDashboardWindow;
}

/**
 * A figure, the same figure for the comparison window, and the movement.
 *
 * `status: 'no_prior_data'` is a **UI state, not a number**: the comparison
 * window holds nothing to compare with (the business may not have existed yet),
 * so `change` is `null` and the badge says so instead of showing `+∞%` or a red
 * arrow. `current`/`previous` are `null` only where the figure is undefined —
 * an average over zero households, a ratio over zero quoted premium.
 */
export interface OwnerTrend {
  current: number | null;
  previous: number | null;
  /**
   * `percent`: `(current − previous) ÷ previous × 100`.
   * `points`: `current − previous`, for a figure that is already a percentage.
   */
  change: number | null;
  unit: 'percent' | 'points';
  status: 'ok' | 'no_prior_data';
}

/** Premium closing ratio: sold premium ÷ quoted premium, as a percentage. */
export interface OwnerClosingRatio extends OwnerTrend {
  /** The two sides of `current`, for the card's "$ sold / $ quoted" line. */
  soldPremium: number;
  quotedPremium: number;
  /**
   * Why `current` is `null` — there is no ratio, which is not a 0% one.
   *
   * - `no_quotes`: nothing was quoted in the window.
   * - `too_few_quotes`: quotes exist, but too few against the sales beside them
   *   to mean anything (see {@link MIN_QUOTES_PER_SALE}). Quote recaps were
   *   barely recorded before 2026 — 9 of them against 1,112 deals in 2025 — and
   *   dividing one by the other is a five-figure percentage, not a closing rate.
   *
   * A real ratio may still exceed 100: deals sold in a period are not only the
   * quotes written in it.
   */
  reason: OwnerRatioGap | null;
}

export type OwnerRatioGap = 'no_quotes' | 'too_few_quotes';

/**
 * The fewest quote recaps per sale for a premium closing ratio to be shown.
 *
 * A judgement call, deliberately loose: in a normal month this agency logs
 * roughly one recap for every one or two sales, and the windows this exists to
 * catch have fewer than one per hundred. One in ten separates the two with room
 * on both sides, and it scales — a three-day window with three quotes against
 * five sales still gets its ratio.
 */
export const MIN_QUOTES_PER_SALE = 0.1;

export interface OwnerLobSlice {
  /** Canonical policy type, e.g. `Auto`. */
  policyType: string;
  policyCount: number;
  /** Share of **policies** sold — not of items, and not of premium. */
  pct: number;
}

export interface OwnerLobMix {
  /** Policies sold in the window, the denominator of every `pct`. */
  policyCount: number;
  /** The three largest policy types. */
  top: OwnerLobSlice[];
  /** Everything outside `top`, so the bar can reach 100. */
  otherPct: number;
}

/** `GET /owner-dashboard/summary` — the KPI row. */
export interface OwnerDashboardSummary {
  period: OwnerDashboardPeriod;
  /** Total Bound Premium. */
  premium: OwnerTrend;
  /** Items bound — three cars on one auto policy is three. */
  items: OwnerTrend;
  /** Sold premium ÷ distinct households with a sale. Same rule as the producer scorecard. */
  avgPremiumPerHousehold: OwnerTrend;
  closingRatio: OwnerClosingRatio;
  lobMix: OwnerLobMix;
}

export interface OwnerProducerRow {
  /** `null` = sales with no producer attached ("Unassigned"). */
  producerId: string | null;
  name: string;
  initials: string;
  /** 1-based, by premium. */
  rank: number;
  /** Quote recaps written in the window. */
  quotes: number;
  /** Items sold. */
  bound: number;
  premium: number;
  /** Always `null` until goals ship (PAC-116); the column renders a placeholder. */
  goalProgress: null;
}

/** `GET /owner-dashboard/producers` — the leaderboard. */
export interface OwnerProducersResponse {
  period: OwnerDashboardPeriod;
  rows: OwnerProducerRow[];
  /** Equals the summary's `premium.current` / `items.current` under the same filter. */
  totals: { quotes: number; bound: number; premium: number };
}

export interface OwnerLeadSourceRow {
  /** `null` = sales, quotes and leads with no source ("No source"). */
  leadSourceId: string | null;
  name: string;
  /** Leads received in the window. */
  volume: number;
  /** Sold premium. */
  premium: number;
  quotedPremium: number;
  /** Sold ÷ quoted premium × 100; `null` when there is no meaningful ratio. */
  convPct: number | null;
  /** Why `convPct` is `null`. Same rule as the closing-ratio card. */
  convGap: OwnerRatioGap | null;
}

/** `GET /owner-dashboard/lead-sources` — the lead-source matrix. */
export interface OwnerLeadSourcesResponse {
  period: OwnerDashboardPeriod;
  rows: OwnerLeadSourceRow[];
  totals: Omit<OwnerLeadSourceRow, 'leadSourceId' | 'name'>;
}
