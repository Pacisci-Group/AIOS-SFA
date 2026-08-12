/**
 * What kind of production a `Deal` represents.
 *
 * The first classification dimension on the sold log. Until now every deal was
 * implicitly new business, and both `PerformanceService` and `LeaderboardService`
 * sum `deals.premium` with no notion of *what kind* of business it is — so a
 * package change recorded by a CSR would have inflated the producer scorecard.
 *
 * `company_transfer` is an intra-book move: the client changes package or tier,
 * a new `Policy` is written and the old one retired, but no new business was
 * sold. It is reported as its own figure beside Sold and Quoted rather than
 * being hidden, because the agency still did the work.
 */
export const BUSINESS_TYPES = ['new_business', 'company_transfer'] as const;

export type BusinessType = (typeof BUSINESS_TYPES)[number];

/**
 * What a deal is when nobody said otherwise.
 *
 * Every deal written before this field existed, and every deal the Sold form
 * writes, is new business — so the default is the one that leaves existing
 * numbers untouched. Same reasoning as `QUOTE_ADVANCEABLE_LEAD_STATUSES`:
 * default to the behaviour that cannot silently reclassify historic data.
 */
export const DEFAULT_BUSINESS_TYPE: BusinessType = 'new_business';

export const BUSINESS_TYPE_LABELS: Record<BusinessType, string> = {
  new_business: 'New Business',
  company_transfer: 'Company Transfer',
};

/**
 * The Mongo clause for "everything that counts as new business".
 *
 * **Deliberately `$ne` rather than an equality match, and this is load-bearing.**
 * `businessType` was added after the fact, so every deal already in the database
 * has no such field at all — a Mongoose default applies on write, never to
 * stored documents. `{ businessType: 'new_business' }` would therefore match
 * *zero* historic deals and read the Sold scorecard and the whole leaderboard as
 * $0. Absent must count as new business, which is exactly what `$ne` does.
 *
 * A backfill is still worth running, but every read has to be correct without
 * one.
 */
export const NEW_BUSINESS_MATCH = {
  businessType: { $ne: 'company_transfer' as const },
};

/** The complement of {@link NEW_BUSINESS_MATCH}. */
export const COMPANY_TRANSFER_MATCH = {
  businessType: 'company_transfer' as const,
};
