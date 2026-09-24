import type { OwnerDashboardPeriod } from "./owner-dashboard";
import type { UserAvailability } from "./user-availability";

/**
 * The Manager View dashboard — "Action Hub" (PAC-139).
 *
 * A **read-only summary** for the Office / Branch Manager. David's words
 * (22 Sep 2026, 00:18): "this page … is just a summary of information … this
 * is not actionable information … this is to tell if all of our data is
 * flowing like it's supposed to be flowing." Nothing here approves, sends back
 * or edits anything; the Deal Audits page (PAC-106) is where that happens.
 *
 * ## Headers say exactly what they count
 *
 * A hard rule from the same call (00:06:53–00:11:59): every figure names the
 * thing it counts — households, items, policies, quotes or premium — never a
 * bare "Quotes" or "Closed". The field names below carry that rule into the
 * contract so the web cannot lose it: `householdsQuoted`, not `quotes`.
 *
 * ## One filter, several reads
 *
 * The page takes the Owner view's filter (period, producers, lead sources,
 * lines of business) and answers it with separate reads so one can fail
 * without blanking the rest. Each alert card's count is computed by the same
 * pipeline as its drawer's list, so **the card's number is always the drawer's
 * row count** — that is a property of the code, not a promise the web keeps.
 */

/** A lead nobody has touched for longer than this is "stalled". */
export const MANAGEMENT_STALLED_HOURS = 48;

/**
 * How long, in **business days** (weekends and US federal holidays excluded),
 * a producer has after the sold date to get the deal's audit to `Pass`.
 * David, 00:26:49: "greater than five business days. That's your aging audits."
 */
export const MANAGEMENT_AUDIT_SLA_BUSINESS_DAYS = 5;

/** The three alert cards, and the `?drawer=` vocabulary the web keys on. */
export const MANAGEMENT_DRAWER_KEYS = ["stalled", "aging", "overdue"] as const;

export type ManagementDrawerKey = (typeof MANAGEMENT_DRAWER_KEYS)[number];

/** `GET /management-dashboard/alerts` — the three cards. */
export interface ManagementAlerts {
  period: OwnerDashboardPeriod;
  /** Leads created in the window with no update for more than 48 hours. */
  stalledLeads: number;
  /** Deals sold in the window whose audit is still not `Pass` after the SLA. */
  agingAudits: number;
  /** Service tickets opened in the window that are past their due date. */
  overdueTickets: number;
}

/**
 * One row of the Stalled Leads drawer.
 *
 * A lead is stalled on its own `lastActivityAt` — the field every lead edit,
 * assignment and logged activity moves forward — **not** the Mongoose
 * `updatedAt`, which the migration stamped with the import time on every
 * historic lead. Terminal statuses (Sold, Lost, Closed, …) are excluded: a
 * closed lead that nobody touches again is finished, not stalled.
 */
export interface StalledLeadRow {
  leadId: string;
  name: string;
  /** Canonical lead status, or `Unknown`. */
  status: string;
  producerId: string | null;
  producerName: string | null;
  householdId: string | null;
  leadSourceName: string | null;
  /** ISO instant, or `null` when the lead has never been touched at all. */
  lastActivityAt: string | null;
  /** Whole hours since `lastActivityAt`; `null` when there is none. */
  hoursSinceActivity: number | null;
}

/**
 * One row of the Aging Audits drawer. One row per **deal**, never per audit
 * item — the manager does not need to see the same client eight times.
 */
export interface AgingAuditRow {
  dealAuditId: string;
  dealId: string;
  householdId: string | null;
  clientName: string;
  producerId: string | null;
  producerName: string | null;
  /** `Not Submitted` | `Pending` | `Fail` — never `Pass`, by definition. */
  auditStatus: string;
  /** Items still failed and unresolved on this audit. */
  openFailedCount: number;
  /** ISO date of the sale; the clock starts here. */
  soldDate: string | null;
  /** Business days elapsed since the sold date. Always more than the SLA. */
  businessDaysOpen: number;
}

/**
 * One row of the Overdue Tickets drawer — the Service dashboard's tickets,
 * past their due date. Overdue is partly *derived*: an onboarding or renewal
 * call is overdue when its step's `dueAt` has passed and it is not complete,
 * whatever the stored status says; every other ticket is overdue when a CSR
 * marked it so.
 */
export interface OverdueTicketRow {
  ticketId: string;
  ticketNumber: string;
  clientName: string;
  category: string;
  assignedUserId: string | null;
  assignedRep: string;
  householdId: string | null;
  /** The step's due instant, ISO; `null` for a hand-marked overdue ticket. */
  dueAt: string | null;
  openedAt: string;
  /** Whole days past `dueAt`; `null` when there is no due date to measure. */
  daysOverdue: number | null;
}

/** A paged drawer list. `total` is exactly the matching card's number. */
export interface ManagementAlertList<T> {
  period: OwnerDashboardPeriod;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  items: T[];
}

/**
 * The four figures a producer's row and the producer drawer's stats strip
 * share. Same fields, same labels, so the two can never disagree.
 */
export interface TeamActivityStats {
  /** Distinct households with a quote recap in the window. */
  householdsQuoted: number;
  /** Distinct households with a new-business sale in the window. */
  householdsSold: number;
  /**
   * `householdsSold ÷ householdsQuoted`, as a percentage. `null` when nothing
   * was quoted — that is "no ratio", not 0%. Named *household* close ratio so
   * it cannot be read as the Owner view's premium closing ratio.
   */
  householdCloseRatio: number | null;
  /**
   * Every audit item still outstanding on the producer's deals — an
   * **all-time backlog**, not narrowed to the period. The one figure on the
   * page the period chips do not move; the web says so under the header.
   */
  openAuditItems: number;
}

/** `GET /management-dashboard/team` — one row per producer. */
export interface TeamActivityRow extends TeamActivityStats {
  producerId: string;
  name: string;
  initials: string;
  /**
   * The producer's own "taking leads or not" switch (PAC-139 §6). `null` for
   * a deactivated producer who still has sales in the window — the switch
   * means nothing for someone who is gone.
   */
  availability: UserAvailability | null;
}

export interface TeamActivityResponse {
  period: OwnerDashboardPeriod;
  rows: TeamActivityRow[];
  /** The "Team Total" row: sums, and the ratio recomputed from the sums. */
  totals: TeamActivityStats;
}

/**
 * One lead the producer is currently working, for the drawer's Active
 * Pipeline. The stage is the lead's own Status field — "go to your status
 * field … those are your stat[us]" (David, 00:24:04).
 */
export interface ProducerPipelineLead {
  leadId: string;
  name: string;
  householdId: string | null;
  /** Canonical lead status, or `Unknown`. */
  status: string;
  /**
   * What the lead asked to have quoted, joined with " · "; `null` when the
   * intake recorded nothing (every migrated lead, and any lead submitted
   * before PAC-56 #2).
   */
  lineOfBusiness: string | null;
  /** Whole days since the lead was created. */
  ageDays: number;
  /** The most recent quote recap's premium, or `null` when none was written. */
  value: number | null;
  lastActivityAt: string | null;
}

/** One outstanding audit item on one of the producer's deals. */
export interface ProducerOpenAuditItem {
  dealAuditId: string;
  dealId: string;
  householdId: string | null;
  clientName: string;
  itemTitle: string;
  /** Whole days since the item was raised. */
  daysOpen: number;
  soldDate: string | null;
}

/** `GET /management-dashboard/producers/:producerId`. */
export interface ProducerDrawerResponse {
  period: OwnerDashboardPeriod;
  producer: {
    producerId: string;
    name: string;
    initials: string;
    availability: UserAvailability | null;
  };
  /** The same four figures as the producer's Team Activity row. */
  stats: TeamActivityStats;
  activePipeline: ProducerPipelineLead[];
  /** The items `stats.openAuditItems` counts, one row each. */
  openAuditItems: ProducerOpenAuditItem[];
}
