/**
 * The Motivation Hub on the Producer Dashboard (PAC-13).
 *
 * Month-scoped, never range-scoped. `producerGoals` stores one `goalPremium`
 * per producer per month, so a "% to goal" for a week or an arbitrary window
 * would mean prorating a monthly target — a product decision nobody has made,
 * and a fabricated number on a motivation panel is worse than no number. The
 * dashboard's time chips drive the Sold and Quoted scorecards only.
 */

/**
 * One ranked row.
 *
 * **Note what is not here: no `premium`, and no `goalPremium`.** A producer may
 * see another producer's *rank* and *goal attainment*, which are a position and
 * a ratio, and never their premium in dollars. The only aggregate dollar figure
 * on this response is `officeTotalPremium`; per-producer dollars appear solely
 * on `self`, which is the caller's own data.
 *
 * This is the whole privacy contract of the endpoint. Adding a premium field
 * here would silently widen what every producer in the agency can see.
 */
export interface LeaderboardEntry {
  producerId: string;
  name: string;
  initials: string;
  /** 1-based. Ties share a rank and the next rank skips (competition ranking). */
  rank: number;
  /** `null` when the producer has no goal row for the month, or the goal is 0. */
  attainmentPct: number | null;
  isSelf: boolean;
}

/** The caller's own row. Dollars are allowed here — it is their own data. */
export interface LeaderboardSelf {
  producerId: string;
  /** `null` when the caller recorded no sales and has no goal for the month. */
  rank: number | null;
  premium: number;
  goalPremium: number | null;
  attainmentPct: number | null;
  /** True when the caller fell outside the top `limit` and was appended. */
  isOutsideTop: boolean;
}

export interface LeaderboardResponse {
  /** `YYYY-MM`, in the agency timezone. */
  month: string;
  /** The one aggregate dollar figure on this response. */
  officeTotalPremium: number;
  /** Producers with sales or a goal this month — the size of the field. */
  producerCount: number;
  /**
   * How many of them have a goal for this month (PAC-80).
   *
   * `0` is the migrated state: SmartSuite's "Monthly Goal" is empty for every
   * user, so every `attainmentPct` is `null` and every progress bar is empty.
   * The card needs to *say* that rather than render a column of em dashes, which
   * reads as universal failure rather than as missing configuration.
   *
   * An aggregate count, so it touches none of the privacy contract above — it is
   * not a dollar figure and names nobody.
   */
  goalsConfigured: number;
  /** `null` for a caller who is not a producer (an owner or manager looking on). */
  self: LeaderboardSelf | null;
  entries: LeaderboardEntry[];
}
