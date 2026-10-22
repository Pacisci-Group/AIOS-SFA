/**
 * The Owner View dashboard — "Strategy Hub" (PAC-135).
 *
 * ## One filter, five reads
 *
 * The page is a KPI row, a producer leaderboard, a lead-source table, a
 * quotes-by-producer table and that table's open-quotes drawer, each its own
 * request so one can fail without blanking the others. All of them take the
 * **same** filter and compile it to the same match, so they are different
 * groupings of one set of rows — which is what lets the page promise that the
 * leaderboard total, the lead-source total and the Total Bound Premium card
 * agree, and that the quotes the leaderboard counts are the quotes the quote
 * closing ratio and the quotes-by-producer table count. That promise needs two
 * rows a tidier table would drop: a producer row for sales with no producer,
 * and a source row for sales with no source.
 *
 * ## Quotes are uncaptured revenue
 *
 * David, 15 Oct 2026: "the biggest item is the ability to see the quotes
 * because this is uncaptured revenue". Every quote written in a window is
 * **sold**, **open** or **lost**:
 *
 * - *sold*: it converted to a new-business sale, by the one quote-to-sale rule
 *   (`common/sales-metrics/quote-conversion.ts` in the API) — as of now, so a
 *   May quote sold in June reads as sold when May is viewed in July;
 * - *lost*: not sold, and its lead is Not Qualified, Lost or Closed
 *   (`LOST_LEAD_STATUSES`) — finished without a sale;
 * - *open*: everything else, including a quote with no lead, and one whose lead
 *   is marked Sold with no deal behind it (a data gap the owner should see).
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

/**
 * The producer-filter value for "no producer" — quotes and sales with nobody
 * attached, the "Unassigned" row. Mirrors `LEAD_SOURCE_NONE`.
 */
export const PRODUCER_NONE = '__none__';

/**
 * How far back, in days before a window starts, a quote still counts as part
 * of the open backlog the "Unsold quotes closed" card measures.
 *
 * A year because a quote stays live until the client's current policy renews,
 * which the Quote form records as a month (`insuranceRenewalMonth`) — so at
 * most twelve months out. An older quote is a new conversation, not a recovery.
 */
export const QUOTE_BACKLOG_DAYS = 365;

/** The period chips. `custom` adds `from`/`to`. */
export const OWNER_DASHBOARD_RANGE_KEYS = [
  /**
   * A single agency day — the "Today" and "Yesterday" chips David asked for
   * (14 Oct 2026). Offered by the Owner, Manager and Analytics bars alike; only
   * the Producer dashboard keeps its own vocabulary (`RANGE_KEYS`).
   */
  'today',
  'yesterday',
  'mtd',
  'lastMonth',
  'last3Months',
  'ytd',
  'lastYear',
  /**
   * The twelve complete calendar months before this one (PAC-152, part 2) —
   * the Analytics page's service trend. Accepted by every endpoint on this
   * vocabulary; the Owner and Manager chip lists simply do not offer it.
   */
  'last12Months',
  'custom',
] as const;

export type OwnerDashboardRangeKey =
  (typeof OWNER_DASHBOARD_RANGE_KEYS)[number];

/** Calendar dates in the agency's timezone, `YYYY-MM-DD`. **`to` is inclusive.** */
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
 * Quote closing ratio: of the quote recaps **written in the window**, the share
 * that has converted to a new-business sale **as of now**, as a percentage.
 *
 * A cohort, not "sales in the window ÷ quotes in the window": that is what lets
 * this figure, the quotes-by-producer table and the open-quotes drawer agree.
 * It follows that `sold ≤ written`, so it never exceeds 100 and needs no
 * {@link MIN_QUOTES_PER_SALE} guard. It also follows that an older window has
 * had longer to convert than a fresh one — the trend badge compares the two as
 * they stand today.
 */
export interface OwnerQuoteClosingRatio extends OwnerTrend {
  /** Quote recaps written in the window — the leaderboard's `totals.quotes`. */
  written: number;
  /** Of those, converted to a sale as of now. */
  sold: number;
  /** `no_quotes` when nothing was written in the window. */
  reason: 'no_quotes' | null;
}

/** Which of the two ratios the headline is made from. */
export type OwnerClosingRatioBasis = 'both' | 'premium' | 'quote' | 'none';

/**
 * The Agency Closing Ratio card: the **average of the premium closing ratio and
 * the quote closing ratio** (David, 14 Oct 2026).
 *
 * The headline (`current`/`previous`/`change`, in points) is the mean when both
 * sides have a figure, the one that does when only one has (the premium side is
 * N/A on most single days, where too few quotes stand against the sales), and
 * `null` when neither does — `reason` is then the premium side's.
 */
export interface OwnerBlendedClosingRatio extends OwnerTrend {
  basis: OwnerClosingRatioBasis;
  /** Sold ÷ quoted premium — unchanged, and still what Analytics shows. */
  premium: OwnerClosingRatio;
  /** Quotes sold ÷ quotes written. */
  quote: OwnerQuoteClosingRatio;
  reason: OwnerRatioGap | null;
}

/**
 * "Unsold quotes closed" — the card behind "we increased the sale of unsold
 * quotes by 30% a month" (David, 15 Oct 2026).
 *
 * The backlog is the quotes written in the {@link QUOTE_BACKLOG_DAYS} before the
 * window that were still open when it started: not yet sold (or sold only once
 * the window had begun), and not on a lost lead. `recovered` is how many of
 * them sold **inside** the window. Lost is judged on the lead's status today —
 * history does not say what it was on the first of the month — and prunes only
 * unsold quotes, so `recovered ≤ backlogAtStart` always holds.
 */
export interface OwnerUnsoldQuotesClosed {
  /** Backlog quotes sold in the window, against the comparison window's. */
  recovered: OwnerTrend;
  /**
   * Premium of the sales they became — each deal once, and the **whole**
   * deal's premium: no policy lines are read for it, so a line-of-business
   * filter narrows which quotes count but not this sum.
   */
  recoveredPremium: number;
  /** Quotes open at the start of the window. */
  backlogAtStart: number;
  /** `recovered ÷ backlogAtStart × 100`; `null` when the backlog is empty. */
  ratePct: number | null;
}

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
  /** The average of the premium and quote closing ratios. */
  closingRatio: OwnerBlendedClosingRatio;
  lobMix: OwnerLobMix;
  unsoldQuotesClosed: OwnerUnsoldQuotesClosed;
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

/** One producer's quotes in the window: what sold, what is open, what is lost. */
export interface OwnerProducerQuotesRow {
  /** `null` = quotes with no producer attached ("Unassigned"). */
  producerId: string | null;
  name: string;
  initials: string;
  /** Quote recaps written in the window. */
  written: number;
  /** Of those, converted to a sale as of now. */
  sold: number;
  /** Neither sold nor on a lost lead — the uncaptured revenue. */
  open: number;
  /** Not sold, on a lead that is Not Qualified, Lost or Closed. */
  lost: number;
  /** Quoted premium on the open quotes (respecting a line-of-business filter). */
  openPremium: number;
  /** `sold ÷ written × 100`; `null` when nothing was written. */
  closePct: number | null;
}

/**
 * `GET /owner-dashboard/producer-quotes` — the Quotes by producer card.
 *
 * `totals.written` equals `GET /owner-dashboard/producers` `totals.quotes`, and
 * the summary's `closingRatio.quote.written`, under the same filter; on every
 * row `sold + open + lost === written`.
 */
export interface OwnerProducerQuotesResponse {
  period: OwnerDashboardPeriod;
  rows: OwnerProducerQuotesRow[];
  totals: Omit<OwnerProducerQuotesRow, 'producerId' | 'name' | 'initials'>;
}

/** One open quote in the drawer. */
export interface OwnerOpenQuoteRow {
  quoteRecapId: string;
  leadId: string | null;
  householdId: string | null;
  /** The lead's name; `Unknown lead` when the quote has none. */
  clientName: string;
  /** When the quote was given, an ISO instant. */
  quoteDate: string;
  /** Lines of business quoted, canonical labels. */
  productsQuoted: string[];
  /** Quoted premium, narrowed by a line-of-business filter. */
  quotedPremium: number;
  /** The lead's current status, normalized; `Unknown` when there is no lead. */
  leadStatus: string;
  /** Agency-calendar days since the quote date. */
  daysOpen: number;
}

/** `GET /owner-dashboard/open-quotes` — one producer's open quotes, paged. */
export interface OwnerOpenQuotesResponse {
  period: OwnerDashboardPeriod;
  producer: { producerId: string | null; name: string; initials: string };
  page: number;
  pageSize: number;
  /** Open quotes in all; `totalPages` is 0 when there are none. */
  total: number;
  totalPages: number;
  items: OwnerOpenQuoteRow[];
}
