import type { LeadTemperature } from './lead-temperature';

/**
 * One row of the Unclaimed Agency Leads Pool on the Agency Command Center
 * (PAC-138) — a lead in this agency that no producer owns yet.
 *
 * ## This row crosses a scope boundary, so what is *not* on it is the contract
 *
 * The pool is read agency-wide even for an `own`-scoped producer, who cannot
 * open any of these leads (`LeadAccessService` 404s an unassigned one by
 * design). Seeing that a lead exists and being able to work it are different
 * rights — PAC-59's distinction, applied here to the one list that needs it.
 *
 * So {@link phone} and {@link email} are **redacted to `null` for a caller who
 * could not open the lead anyway**, and the row carries no address, no notes
 * and no activity narrative. It says enough to recognise the lead and decide
 * who should get it, and no more. A client cannot tell a redacted value from a
 * genuinely missing one, and does not need to: both render as unavailable.
 *
 * ⚠ Adding a contact-bearing field here widens who can read it. If a future row
 * needs one, redact it on the same rule rather than shipping it to everyone.
 */
export interface UnclaimedLeadRow {
  id: string;
  name: string;
  /** Derived from the name, so the row renders an avatar without a lookup. */
  initials: string;
  /**
   * Set by management during review, never computed (PAC-138 decision).
   *
   * The prototype drew a four-tier `fresh | warm | hot | critical` badge off
   * wall-clock age. There is no rule behind those tiers — temperature is a
   * judgement an office manager makes, and `lead-temperature.ts` records that
   * deriving it automatically is a later ticket. The row ships the stored value
   * and {@link createdAt}; it does not invent a band from the two.
   */
  temperature: LeadTemperature;
  /** Resolved `leadSources` name, never an id or a raw choice code. */
  leadSource: string;
  /** Canonical status label. */
  status: string;
  /** `null` when absent **or** withheld — see the note above. */
  phone: string | null;
  /** `null` when absent **or** withheld — see the note above. */
  email: string | null;
  /**
   * `YYYY-MM-DD` when the lead's primary contact has died (PAC-91 §7), so a row
   * that grows a Call or Text action cannot offer to contact them. Redacted
   * alongside the contact fields, for the same reason.
   */
  primaryContactDeceasedAt: string | null;
  /**
   * When the lead arrived — `createdDate` (the source system's) falling back to
   * `createdAt`. This is the sort key, and it is what the row's "3h ago" means.
   *
   * Named for the fact rather than the column because it is neither column on
   * its own: `createdAt` on a migrated lead is the night the import ran, not
   * the day the lead came in.
   */
  arrivedAt: string | null;
}

/**
 * `GET /leads/unclaimed`.
 *
 * Deliberately not the `{page, pageSize, total, totalPages, items}` envelope the
 * Leads table uses: the pool is a dashboard panel with a "top N" list and a
 * count badge, not a paged table. {@link total} is every unclaimed lead in
 * scope, so the badge can say `12` while {@link items} holds the 8 shown —
 * shipping page arithmetic would advertise paging the panel does not have.
 */
export interface UnclaimedLeadListResponse {
  items: UnclaimedLeadRow[];
  /** Every unclaimed lead in scope, not just the ones in {@link items}. */
  total: number;
}
