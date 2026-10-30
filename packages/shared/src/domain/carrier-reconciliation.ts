/**
 * Dash Reconciliation — the wire contract between `/carrier-reconciliation/*`
 * and the web page.
 *
 * Each month the agency owner uploads Allstate's **Dash** export "Sold — New
 * Business Details (All)": every policy the carrier says the agency wrote in
 * the period. A **run** parses that file and reconciles it against the
 * policies on the agency's sales, producing one **row** per Dash line plus one
 * per app policy the file does not show.
 *
 * Every row lands in zero or more **tabs** (views, not partitions):
 *
 * - `missing_from_app` — a Dash sale with no matching app policy, bound by one
 *   of the agency's own producers. Someone has to enter the deal.
 * - `not_in_dash` — an app policy sold in the file's window that Dash does
 *   not show: a mistyped number, a policy not yet issued, or the wrong carrier.
 * - `review_1800` — a Dash row bound by an Allstate login that is on **no**
 *   staff user **and** that Dash prints no Bind ID Name for (on a new policy,
 *   or any line through the 1-800 / allstate.com channel): business Allstate
 *   sold directly and assigned to the agency to service. A login Dash *does*
 *   name is a former employee's, never 1-800 (David, 27 Oct 2026). A 1-800
 *   policy the app has on a deal is here too (`direct_recorded_as_sale`): it
 *   is serviced, never sold.
 * - `premium_mismatch` — matched, but the app's premium is not Dash's written
 *   premium to the cent. Any difference flags; the app is the source of truth.
 * - `producer_mismatch` — matched, but bound in Dash by someone other than the
 *   app deal's producer.
 * - `matched` — in both.
 * - `ignored` — Dash lines that are not new policies (add-item endorsements,
 *   Motor Club), kept so the file's line count reconciles.
 *
 * The owner works the open rows, or hands one to a Producer or CSR
 * (`assignment`), who is notified and sees it on their own page and records
 * what became of it (`outcome`): **Sold** (entered as a sale), **Cancel
 * rewrite** (entered, then rewritten through the normal replacement chain),
 * **Service intake** (a 1-800 policy set up for service: household, a
 * `carrier_direct` policy, and a CSR's welcome call — never a sale) or
 * **Other** (a note). Finishing one resolves the row.
 *
 * Who a line belongs to is the user holding its **Bind ID** — the login that
 * bound the policy, entered on the user (`allstate-codes.ts`). Dash's
 * sub-producer column is not read (owner, 28 Oct 2026): grouping by it listed
 * people twice whenever the code was not on their user, and it named the
 * binder on nearly every sale anyway.
 */

import { ModuleKey } from '../enums/module-key.enum';
import { modulePermission } from '../permissions/permission.constants';
import type { PolicySummary } from '../clients/client-records';
import type { PolicyCancellationReason } from './policy-cancellation';
import type { PolicyOrigin } from './policy-origin';
import type { PolicyType } from './policy-type';
import type { ServiceTicketAssignee } from '../service/service-ticket';

export const RECONCILIATION_RUN_STATUSES = [
  'processing',
  'ready',
  'failed',
] as const;
export type ReconciliationRunStatus =
  (typeof RECONCILIATION_RUN_STATUSES)[number];

/** Whether a row was found on both sides. `null` on an `ignored` Dash line. */
export const RECONCILIATION_MATCHES = [
  'matched',
  'dash_only',
  'app_only',
] as const;
export type ReconciliationMatch = (typeof RECONCILIATION_MATCHES)[number];

export const RECONCILIATION_TABS = [
  'missing_from_app',
  'not_in_dash',
  'review_1800',
  'premium_mismatch',
  'producer_mismatch',
  'matched',
  'ignored',
] as const;
export type ReconciliationTab = (typeof RECONCILIATION_TABS)[number];

export const RECONCILIATION_TAB_LABELS: Record<ReconciliationTab, string> = {
  missing_from_app: 'Missing from app',
  not_in_dash: 'Not in Dash',
  review_1800: '1-800 review',
  premium_mismatch: 'Premium differs',
  producer_mismatch: 'Producer mismatch',
  matched: 'Matched',
  ignored: 'Not new business',
};

/** Why a Dash line is not reconciled as a new policy. */
export const RECONCILIATION_IGNORED_REASONS = [
  'endorsement',
  'motor_club',
  'not_new_policy',
  'duplicate_line',
] as const;
export type ReconciliationIgnoredReason =
  (typeof RECONCILIATION_IGNORED_REASONS)[number];

export const RECONCILIATION_IGNORED_REASON_LABELS: Record<
  ReconciliationIgnoredReason,
  string
> = {
  endorsement: 'Endorsement (item added to an existing policy)',
  motor_club: 'Motor Club',
  not_new_policy: 'Not a new policy issue',
  duplicate_line: 'Repeat of a policy already listed',
};

/**
 * How the row's Bind ID resolved against the agency's users.
 *
 * - `staff` — the Bind ID of one of the agency's users (active or not: an old
 *   sale keeps its binder).
 * - `former_staff` — on no user, but Dash prints a **Bind ID Name** beside it.
 *   The owner's rule: a named login is always a person who worked here — a
 *   leaver with no account, or someone whose Bind ID has not been entered on
 *   their user yet — so the line is the agency's business, never 1-800.
 * - `not_staff` — on no user and unnamed: Allstate's call centre or an
 *   automated system. The only status that can make a line 1-800.
 * - `blank` — the carrier sent no Bind ID. Agency business in practice (Non
 *   Standard Auto, bound outside the Allstate portal), so never 1-800.
 */
export const BIND_ID_STATUSES = [
  'staff',
  'former_staff',
  'not_staff',
  'blank',
] as const;
export type BindIdStatus = (typeof BIND_ID_STATUSES)[number];

/**
 * Everything worth pointing out on a row. Some put the row in a tab
 * (`not_staff_bind_id`, `direct_channel`, `premium_mismatch`,
 * `producer_mismatch`); the rest are context shown beside it.
 * `direct_recorded_as_sale` says why a matched row is in 1-800 review;
 * `item_count_mismatch` and `direct_1800` are context only.
 */
export const RECONCILIATION_ISSUES = [
  'not_staff_bind_id',
  'former_staff_bind_id',
  'no_bind_id',
  'direct_channel',
  'direct_recorded_as_sale',
  'direct_1800',
  'premium_mismatch',
  'item_count_mismatch',
  'producer_mismatch',
  'unmapped_producer',
  'no_app_producer',
  'number_format',
  'missing_policy_number',
  'outside_window',
  'duplicate_in_dash',
  'duplicate_in_app',
] as const;
export type ReconciliationIssue = (typeof RECONCILIATION_ISSUES)[number];

export const RECONCILIATION_ISSUE_LABELS: Record<ReconciliationIssue, string> =
  {
    not_staff_bind_id: 'Bind ID is not on any staff user',
    former_staff_bind_id:
      'Bind ID on no user, but named in Dash (a former employee, or a code not entered yet)',
    no_bind_id: 'No Bind ID in Dash',
    direct_channel: 'Sold through 1-800 / allstate.com',
    direct_recorded_as_sale:
      'Allstate sold it directly, but the app has it on a sale — a 1-800 policy is serviced, never sold',
    direct_1800:
      'Allstate direct policy — set up for service in the app, not sold',
    premium_mismatch: 'Premium in the app differs from Dash',
    item_count_mismatch: 'Item count in the app differs from Dash',
    producer_mismatch: 'Bound in Dash by someone other than the app’s producer',
    // Raised only on runs classified while sub-producer codes were read.
    unmapped_producer: 'Sub-producer code is not on any staff user',
    no_app_producer: 'App policy has no producer',
    number_format: 'Policy number looks mistyped',
    missing_policy_number: 'App policy has no policy number',
    outside_window: 'Sold outside the report period',
    duplicate_in_dash: 'Policy number appears more than once in Dash',
    duplicate_in_app: 'Policy number is on more than one app policy',
  };

export const RECONCILIATION_REVIEW_STATUSES = [
  'open',
  'resolved',
  'dismissed',
] as const;
export type ReconciliationReviewStatus =
  (typeof RECONCILIATION_REVIEW_STATUSES)[number];

export const RECONCILIATION_REVIEW_STATUS_LABELS: Record<
  ReconciliationReviewStatus,
  string
> = {
  open: 'Open',
  resolved: 'Resolved',
  dismissed: 'Dismissed',
};

/**
 * What the reviewer concluded — the values a review may set. Free text goes in
 * the note.
 */
export const RECONCILIATION_RESOLUTIONS = [
  'entered_in_app',
  'number_corrected',
  'credit_corrected',
  'premium_corrected',
  'carrier_figure_wrong',
  'service_set_up',
  'timing',
  'not_ours',
  'duplicate',
  'other',
] as const;
export type ReconciliationResolution =
  (typeof RECONCILIATION_RESOLUTIONS)[number];

/**
 * Resolutions no longer offered that a stored row may still hold.
 * `confirmed_1800` ("yes, Allstate sold it", with nothing done) went with v2:
 * a 1-800 policy is now set up for service, or it is not the agency's. Read
 * paths label it; a review can no longer set it, and a re-upload does not
 * carry it forward.
 */
export const RETIRED_RECONCILIATION_RESOLUTIONS = ['confirmed_1800'] as const;
export type RetiredReconciliationResolution =
  (typeof RETIRED_RECONCILIATION_RESOLUTIONS)[number];

/**
 * What an assignee's finished outcome resolves the row with, so the owner's
 * tabs read the same. Never picked by hand — the owner's review refuses them —
 * but read paths label them and a re-upload carries them like any decision.
 */
export const RECONCILIATION_OUTCOME_RESOLUTIONS = [
  'sold_recorded',
  'cancel_rewrite_recorded',
  'chargeback_recorded',
  'service_intake_recorded',
  'other_recorded',
] as const;
export type ReconciliationOutcomeResolution =
  (typeof RECONCILIATION_OUTCOME_RESOLUTIONS)[number];

/** Any resolution a stored row may hold. */
export type StoredReconciliationResolution =
  | ReconciliationResolution
  | RetiredReconciliationResolution
  | ReconciliationOutcomeResolution;

export const RECONCILIATION_RESOLUTION_LABELS: Record<
  StoredReconciliationResolution,
  string
> = {
  entered_in_app: 'Deal entered in the app',
  number_corrected: 'Policy number corrected',
  credit_corrected: 'Producer credit corrected',
  premium_corrected: 'Premium corrected in the app',
  carrier_figure_wrong: 'Dash’s figure is wrong — the app is right',
  service_set_up: 'Set up for service',
  confirmed_1800: 'Confirmed 1-800 policy',
  timing: 'Timing — recheck next month',
  not_ours: 'Not this agency’s business',
  duplicate: 'Duplicate',
  other: 'Other',
  sold_recorded: 'Sold recorded',
  cancel_rewrite_recorded: 'Cancel rewrite recorded',
  chargeback_recorded: 'Chargeback recorded',
  service_intake_recorded: 'Service intake recorded',
  other_recorded: 'Other recorded',
};

/** The resolutions that make sense on a row in each tab, in display order. */
export const RECONCILIATION_RESOLUTIONS_BY_TAB: Record<
  ReconciliationTab,
  readonly ReconciliationResolution[]
> = {
  missing_from_app: ['entered_in_app', 'number_corrected', 'not_ours', 'other'],
  not_in_dash: ['number_corrected', 'timing', 'not_ours', 'duplicate', 'other'],
  review_1800: ['service_set_up', 'not_ours', 'other'],
  premium_mismatch: ['premium_corrected', 'carrier_figure_wrong', 'other'],
  producer_mismatch: ['credit_corrected', 'other'],
  matched: ['other'],
  ignored: ['other'],
};

/**
 * App premium minus Dash's written premium, to the cent; `null` unless both
 * sides have one. Compared in whole cents, so `1234.5` and `1234.50` agree and
 * float noise never reads as a difference. Any non-zero result is a
 * `premium_mismatch`: any difference at all flags (David, 27 Oct 2026).
 */
export function reconciliationPremiumDelta(
  dashPremium: number | null | undefined,
  appPremium: number | null | undefined,
): number | null {
  if (dashPremium == null || appPremium == null) return null;
  return (Math.round(appPremium * 100) - Math.round(dashPremium * 100)) / 100;
}

/**
 * A per-producer summary key as a filter value: `user:<id>`, `bind:<Bind ID>`
 * or `none` — and `code:<sub-producer>` on a run classified before
 * sub-producer codes were set aside, until it is re-checked. Shared so the rows
 * endpoint and the page's URL guard accept the same keys.
 */
export const RECONCILIATION_PRODUCER_KEY_PATTERN =
  /^(user:[a-f0-9]{24}|code:[A-Z0-9-]{1,12}|bind:[A-Z0-9._-]{1,32}|none)$/i;

/**
 * The tab a row is filed under when one has to be named — in a notification,
 * on the assignee's page: the first of its tabs in page order, so a matched
 * row whose premium differs reads "Premium differs", not "Matched".
 */
export function primaryReconciliationTab(
  tabs: readonly ReconciliationTab[],
): ReconciliationTab | null {
  return RECONCILIATION_TABS.find((tab) => tabs.includes(tab)) ?? null;
}

/**
 * Who a row can be assigned to: the agency's active **Producers and CSRs** —
 * users holding a role with one of these slugs (David, 27 Oct 2026). The
 * owner assigns; the assignee works the row from their own page.
 */
export const RECONCILIATION_ASSIGNEE_ROLE_SLUGS = ['producer', 'csr'] as const;

/**
 * The rows endpoint's `assignee` filter: a user id, `me`, or `unassigned`.
 * Shared so the API and the page's URL guard accept the same values.
 */
export const RECONCILIATION_ASSIGNEE_FILTER_PATTERN =
  /^([a-f0-9]{24}|me|unassigned)$/i;

/** Error codes the page maps to copy (`ApiError.body.code`). */
export const RECONCILIATION_DUPLICATE_FILE = 'RECONCILIATION_DUPLICATE_FILE';
export const RECONCILIATION_WRONG_AGENCY = 'RECONCILIATION_WRONG_AGENCY';
export const RECONCILIATION_NO_APPOINTMENT = 'RECONCILIATION_NO_APPOINTMENT';
export const RECONCILIATION_UNREADABLE_FILE = 'RECONCILIATION_UNREADABLE_FILE';

/** Upload limits, shared so the dropzone and the API refuse the same files. */
export const MAX_RECONCILIATION_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_RECONCILIATION_ROWS = 20_000;
export const RECONCILIATION_FILE_EXTENSIONS = ['.xlsx'] as const;

/** The note left with an assignment, so the form and the API refuse alike. */
export const MAX_RECONCILIATION_ASSIGNMENT_NOTE_LENGTH = 1000;

// ---------------------------------------------------------------------------
// Outcomes — what the assignee records on a row (PAC-173 v2, PR 4)
// ---------------------------------------------------------------------------

/**
 * - `sold` — the policy was the agency's sale: enter it (New Lead, then Sold,
 *   prefilled from the Dash line).
 * - `cancel_rewrite` — it was sold and later rewritten: enter it as `sold`
 *   does, then write its replacement through the normal cancel-rewrite chain,
 *   so the trail and the chargeback exist.
 * - `chargeback` — it was sold and the carrier later cancelled it (PAC-173
 *   PR 6): enter it as `sold` does, then cancel it through the household
 *   page's Cancel dialog with **Record a chargeback** ticked and the carrier's
 *   cancellation date, which decides the one-month clawback window.
 * - `service_intake` — a 1-800 policy (PAC-173 PR 5): Allstate sold it, the
 *   agency services it. Its form creates the household (captured like a lead,
 *   but no lead), a `carrier_direct` policy with its NBA and no deal, and a
 *   CSR onboarding opening on the welcome call. Never a sale.
 * - `other` — anything else, in a note. Done at once.
 */
export const RECONCILIATION_OUTCOME_KINDS = [
  'sold',
  'cancel_rewrite',
  'chargeback',
  'service_intake',
  'other',
] as const;
export type ReconciliationOutcomeKind =
  (typeof RECONCILIATION_OUTCOME_KINDS)[number];

export const RECONCILIATION_OUTCOME_KIND_LABELS: Record<
  ReconciliationOutcomeKind,
  string
> = {
  sold: 'Sold',
  cancel_rewrite: 'Cancel rewrite',
  chargeback: 'Chargeback',
  service_intake: 'Service intake',
  other: 'Other',
};

/** The resolution each kind leaves on the row once it is done. */
export const RECONCILIATION_OUTCOME_RESOLUTION: Record<
  ReconciliationOutcomeKind,
  ReconciliationOutcomeResolution
> = {
  sold: 'sold_recorded',
  cancel_rewrite: 'cancel_rewrite_recorded',
  chargeback: 'chargeback_recorded',
  service_intake: 'service_intake_recorded',
  other: 'other_recorded',
};

export const RECONCILIATION_OUTCOME_STATUSES = ['in_progress', 'done'] as const;
export type ReconciliationOutcomeStatus =
  (typeof RECONCILIATION_OUTCOME_STATUSES)[number];

/**
 * Where an unfinished outcome stands: `record_sale` until the sale is booked,
 * then — for a cancel rewrite — `write_replacement` until its replacement is,
 * or — for a chargeback — `cancel_policy` until the policy is cancelled with
 * its chargeback. A service intake is `start_onboarding` only between saving
 * the household and policy and opening the welcome call; it stays there when
 * that failed, and Continue opens it.
 */
export const RECONCILIATION_OUTCOME_STEPS = [
  'record_sale',
  'write_replacement',
  'cancel_policy',
  'start_onboarding',
] as const;
export type ReconciliationOutcomeStep =
  (typeof RECONCILIATION_OUTCOME_STEPS)[number];

export const RECONCILIATION_OUTCOME_STEP_LABELS: Record<
  ReconciliationOutcomeStep,
  string
> = {
  record_sale: 'Recording the sale',
  write_replacement: 'Writing the replacement',
  cancel_policy: 'Cancelling the policy',
  start_onboarding: 'Opening the welcome call',
};

/**
 * The kinds that book a sale, and so need the caller to be able to. A
 * chargeback books one before it cancels it.
 */
export const RECONCILIATION_SALE_OUTCOME_KINDS = [
  'sold',
  'cancel_rewrite',
  'chargeback',
] as const satisfies readonly ReconciliationOutcomeKind[];

/**
 * The outcomes a row can take:
 *
 * - a Dash sale missing from the app: Sold, a Cancel rewrite, a Chargeback
 *   (PAC-173 PR 6) or Other;
 * - a 1-800 policy the app does not have (`review_1800`, `dash_only`): Set up
 *   for service, or Other;
 * - anything else — a 1-800 policy the app already has included (on a deal or
 *   not; owner, 29 Oct 2026) — only Other.
 */
export function reconciliationOutcomeKinds(row: {
  tabs: readonly ReconciliationTab[];
  match: ReconciliationMatch | null;
}): readonly ReconciliationOutcomeKind[] {
  if (row.tabs.includes('missing_from_app')) {
    return ['sold', 'cancel_rewrite', 'chargeback', 'other'];
  }
  if (row.tabs.includes('review_1800') && row.match === 'dash_only') {
    return ['service_intake', 'other'];
  }
  return ['other'];
}

/**
 * Whether someone holding these permissions can book a sale: a lead, then the
 * sale on it. Recording Sold, a Cancel rewrite or a Chargeback takes both (a
 * chargeback's cancel step too, as part of the same outcome), and only people
 * who can are given a `missing_from_app` row (owner, 28 Oct 2026) — checked by
 * permission, not role, so a CSR an agency lets sell qualifies.
 */
export function canRecordReconciliationSale(
  permissions: readonly string[],
): boolean {
  return (
    permissions.includes(modulePermission(ModuleKey.Leads, 'write')) &&
    permissions.includes(modulePermission(ModuleKey.DealAudits, 'write'))
  );
}

/**
 * Whether someone holding these permissions can set a 1-800 policy up for
 * service: `leads:write` (owner, 29 Oct 2026), which both the Producer and the
 * CSR templates carry. It captures a household as a lead does, and only people
 * who can are given a row that offers it — checked by permission, not role.
 */
export function canSetUpReconciliationService(
  permissions: readonly string[],
): boolean {
  return permissions.includes(modulePermission(ModuleKey.Leads, 'write'));
}

/**
 * The rows endpoint's `outcome` filter: by status (`in_progress`, `done`) or
 * by kind.
 */
export const RECONCILIATION_OUTCOME_FILTERS = [
  'in_progress',
  'done',
  ...RECONCILIATION_OUTCOME_KINDS,
] as const;
export type ReconciliationOutcomeFilter =
  (typeof RECONCILIATION_OUTCOME_FILTERS)[number];

/** The note an outcome carries, so the form and the API refuse alike. */
export const MAX_RECONCILIATION_OUTCOME_NOTE_LENGTH = 2000;

/** Error codes for outcomes and the assignment rule they bring. */
export const RECONCILIATION_ASSIGNEE_CANNOT_SELL =
  'RECONCILIATION_ASSIGNEE_CANNOT_SELL';
export const RECONCILIATION_ASSIGNEE_CANNOT_SERVICE =
  'RECONCILIATION_ASSIGNEE_CANNOT_SERVICE';
/**
 * A service intake named a household the caller cannot see (PAC-173 PR 5):
 * the form keeps what was typed and asks for another client.
 */
export const RECONCILIATION_HOUSEHOLD_NOT_VISIBLE =
  'RECONCILIATION_HOUSEHOLD_NOT_VISIBLE';
export const RECONCILIATION_OUTCOME_NOT_ALLOWED =
  'RECONCILIATION_OUTCOME_NOT_ALLOWED';
export const RECONCILIATION_OUTCOME_FORBIDDEN =
  'RECONCILIATION_OUTCOME_FORBIDDEN';
export const RECONCILIATION_OUTCOME_LOCKED = 'RECONCILIATION_OUTCOME_LOCKED';
/**
 * A Chargeback's sale links no policy numbered as the Dash line (PAC-173 PR 6),
 * so there is nothing it may cancel: the assignee corrects the number on the
 * sale, then Continues.
 */
export const RECONCILIATION_CHARGEBACK_POLICY_UNMATCHED =
  'RECONCILIATION_CHARGEBACK_POLICY_UNMATCHED';

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export interface ReconciliationTotals {
  /** Every data line in the file. */
  dashRows: number;
  /** Lines that are new policies (the rest are `ignored`). */
  dashSales: number;
  ignored: number;
  matched: number;
  missing: number;
  appOnly: number;
  review1800: number;
  premiumMismatch: number;
  producerMismatch: number;
  /** Written premium of every new-policy line. */
  dashPremium: number;
  matchedPremium: number;
  missingPremium: number;
  appOnlyPremium: number;
  /** Written premium of 1-800 new policies. */
  review1800Premium: number;
  /**
   * How far apart the premiums are on the `premium_mismatch` rows, summed as
   * absolute differences (`Σ |Dash − app|`), so a policy over and one under
   * never cancel out.
   */
  premiumMismatchDelta: number;
  /** `matched / (matched + missing)`; `null` with nothing to divide. */
  captureRate: number | null;
}

/** One producer's line in the run summary — the workbook's "By Carrier Producer". */
export interface ReconciliationProducerSummary {
  /**
   * `user:<id>`, `bind:<Bind ID>` (a former employee Dash names, whose Bind
   * ID is on no user) or `none` (no Bind ID).
   */
  producerKey: string;
  userId: string | null;
  /** The app user's name, else the name Dash prints for the Bind ID. */
  name: string;
  dashSales: number;
  dashPremium: number;
  matched: number;
  missing: number;
  missingPremium: number;
  appOnly: number;
  appOnlyPremium: number;
  mismatches: number;
  captureRate: number | null;
}

export interface ReconciliationFileMeta {
  /** Allstate agent number from the file header, e.g. `0B9049`. */
  agentNumber: string | null;
  agentName: string | null;
  downloadedBy: string | null;
  downloadedAt: string | null;
  /** The report period, `YYYY-MM-DD`. */
  startDate: string | null;
  endDate: string | null;
  rowCount: number;
}

export interface ReconciliationRunView {
  id: string;
  status: ReconciliationRunStatus;
  error: string | null;
  filename: string;
  fileMeta: ReconciliationFileMeta;
  totals: ReconciliationTotals | null;
  /** Rows still awaiting a decision. */
  openReviews: number;
  supersedesRunId: string | null;
  supersededByRunId: string | null;
  createdAt: string;
  createdBy: { id: string; name: string } | null;
}

export interface ReconciliationRunDetail extends ReconciliationRunView {
  byProducer: ReconciliationProducerSummary[];
  /** Rows per tab, and how many of those still need a decision. */
  tabCounts: Record<ReconciliationTab, { total: number; open: number }>;
  /** Rows still waiting on a decision that are assigned to someone. */
  assigned: number;
  /** Of those, the ones whose assignee has an outcome under way. */
  inProgress: number;
  /** Parser notes worth showing (a missing metadata row, a fallback window). */
  warnings: string[];
}

export interface ReconciliationRunListResponse {
  items: ReconciliationRunView[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** A Dash line as parsed. Dates are calendar dates, `YYYY-MM-DD`. */
export interface ReconciliationDashSide {
  rowNumber: number;
  agentNumber: string | null;
  subProducerCode: string | null;
  subProducerName: string | null;
  bindId: string | null;
  bindIdName: string | null;
  policyNumber: string | null;
  customerName: string | null;
  issuedDate: string | null;
  dateWritten: string | null;
  product: string | null;
  productDescription: string | null;
  lineGroup: string | null;
  packageName: string | null;
  transactionType: string | null;
  dispositionCode: string | null;
  itemCount: number | null;
  writtenPremium: number | null;
  channel: string | null;
  channelIndicator: string | null;
  scenarioName: string | null;
}

/** The app policy a row matched, or the app-only policy it is. */
export interface ReconciliationAppSide {
  policyId: string;
  dealId: string | null;
  householdId: string | null;
  producerId: string | null;
  producerName: string | null;
  policyNumber: string | null;
  policyType: string | null;
  carrier: string | null;
  policyStatus: string | null;
  /** The deal's sold date on the agency's calendar, `YYYY-MM-DD`. */
  soldDay: string | null;
  premium: number;
  items: number;
  clientName: string | null;
  businessType: string | null;
  /** `carrier_direct` for a 1-800 policy set up for service; `null` = the agency's own. */
  origin: PolicyOrigin | null;
}

/** A likely counterpart for an unmatched row — usually a mistyped number. */
export interface ReconciliationSuggestion {
  kind: 'app_policy' | 'dash_row';
  /** The app policy, for `app_policy`. */
  policyId: string | null;
  dealId: string | null;
  householdId: string | null;
  /** The Dash row's id within this run, for `dash_row`. */
  rowId: string | null;
  policyNumber: string | null;
  name: string | null;
  premium: number | null;
  day: string | null;
  reasons: ('number_close' | 'same_surname' | 'premium_close' | 'date_close')[];
}

export interface ReconciliationReview {
  status: ReconciliationReviewStatus;
  /**
   * A retired value only on a row decided before it was retired; an outcome
   * resolution only when an assignee's outcome finished it.
   */
  resolution: StoredReconciliationResolution | null;
  note: string | null;
  reviewedBy: { id: string; name: string } | null;
  reviewedAt: string | null;
  /** Carried from the same row of the run this one superseded. */
  carriedForward: boolean;
}

export interface ReconciliationRowView {
  id: string;
  side: 'dash' | 'app' | 'both';
  match: ReconciliationMatch | null;
  isSale: boolean;
  ignoredReason: ReconciliationIgnoredReason | null;
  bindIdStatus: BindIdStatus | null;
  issues: ReconciliationIssue[];
  tabs: ReconciliationTab[];
  needsReview: boolean;
  dash: ReconciliationDashSide | null;
  app: ReconciliationAppSide | null;
  /** Who the line belongs to: the user holding its Bind ID, else the name Dash prints. */
  credit: {
    name: string | null;
    userId: string | null;
    userName: string | null;
  };
  suggestions: ReconciliationSuggestion[];
  review: ReconciliationReview;
  /** The run the row belongs to. */
  runId: string;
  /** Who the owner handed the row to, if anyone. */
  assignment: ReconciliationAssignment | null;
  /** What the assignee recorded, or is recording. */
  outcome: ReconciliationOutcome | null;
}

/**
 * An assignee's outcome. The ids link what it created: the lead and deal of
 * the sale, the policy that is the Dash line, and — for a cancel rewrite — the
 * replacement policy and the chargeback the rewrite wrote; for a chargeback,
 * the ledger row its cancellation wrote; for a service intake, the household,
 * the policy, and the onboarding with its welcome call.
 */
export interface ReconciliationOutcome {
  kind: ReconciliationOutcomeKind;
  status: ReconciliationOutcomeStatus;
  /** `null` once done, and for `other`. */
  step: ReconciliationOutcomeStep | null;
  note: string | null;
  leadId: string | null;
  dealId: string | null;
  policyId: string | null;
  householdId: string | null;
  replacementPolicyId: string | null;
  chargebackId: string | null;
  /** A service intake's onboarding, and its welcome-call ticket. */
  onboardingId: string | null;
  ticketId: string | null;
  startedBy: { id: string; name: string } | null;
  startedAt: string;
  completedBy: { id: string; name: string } | null;
  completedAt: string | null;
}

/** A row handed to a Producer or CSR to work. */
export interface ReconciliationAssignment {
  user: { id: string; name: string };
  assignedBy: { id: string; name: string } | null;
  assignedAt: string;
  note: string | null;
}

export interface ReconciliationRowListResponse {
  items: ReconciliationRowView[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** Someone a row can be assigned to. `roles` are the role slugs that qualify them. */
export interface ReconciliationAssignee {
  id: string;
  name: string;
  email: string;
  roles: string[];
  /**
   * Whether they can book a sale (`canRecordReconciliationSale`). Only they
   * can be given a `missing_from_app` row.
   */
  canRecordSale: boolean;
  /**
   * Whether they can set a 1-800 policy up for service
   * (`canSetUpReconciliationService`: `leads:write`). Only they can be given
   * a row that offers it. Whether the agency has CRM service on is checked
   * when they set it up — `prefill.serviceIntake` is `null` and the intake a
   * 409 while it is off — so the owner can still hand such a row over for
   * Other.
   */
  canSetUpService: boolean;
}

export interface ReconciliationOptionsResponse {
  /** The agency's active Producers and CSRs, by name. */
  assignees: ReconciliationAssignee[];
}

/** A row on the assignee's page, with the upload it came from. */
export interface ReconciliationAssignedRow extends ReconciliationRowView {
  assignment: ReconciliationAssignment;
  run: {
    id: string;
    filename: string;
    startDate: string | null;
    endDate: string | null;
  };
}

/**
 * The Dash line as the New Lead and Sold forms want it, so the assignee
 * confirms rather than retypes. Calendar dates are `YYYY-MM-DD`.
 */
export interface ReconciliationPrefill {
  /** From Dash's `FIRST LAST` customer name; `null` without one. */
  lead: {
    firstName: string;
    lastName: string;
    /**
     * The lead's date: the day Dash says the policy was written. A sale may
     * not predate its lead, so a lead dated today could not carry the Dash
     * sold date.
     */
    createdDate: string | null;
  } | null;
  policy: {
    policyNumber: string | null;
    /** `null` when Dash's product maps to no app policy type — the form asks. */
    policyType: PolicyType | null;
    /** The carrier the run was uploaded for, by its catalog name. */
    carrier: string | null;
    premium: number | null;
    itemCount: number;
    effectiveDate: string | null;
    soldDate: string | null;
  };
  /**
   * The service-intake form's hand-off note for the welcome call, written
   * from the Dash line; `null` unless the row offers a service intake.
   */
  serviceIntake: { openingNote: string } | null;
}

/** `GET carrier-reconciliation/assigned/:rowId`. */
export interface ReconciliationAssignedRowDetail
  extends ReconciliationAssignedRow {
  /** `null` on a row with no Dash line. */
  prefill: ReconciliationPrefill | null;
  /**
   * A Chargeback waiting at `cancel_policy` (PAC-173 PR 6): the policy its
   * cancel will cancel, as the app has it — so the dialog names what it acts
   * on, not the Dash line's number. `null` for any other row, and while the
   * sale links no policy numbered as the Dash line.
   */
  chargebackPolicy: ReconciliationChargebackPolicy | null;
}

/** The booked policy a Chargeback's cancel acts on. */
export interface ReconciliationChargebackPolicy {
  id: string;
  policyNumber: string | null;
  policyType: string | null;
  carrier: string | null;
  premium: number;
}

/** `PATCH carrier-reconciliation/assigned/:rowId/outcome`. */
export interface RecordReconciliationOutcomeInput {
  kind: ReconciliationOutcomeKind;
  /** Required for `other`. */
  note?: string | null;
}

/**
 * `POST carrier-reconciliation/assigned/:rowId/cancel-policy` — a Chargeback
 * outcome's second step (PAC-173 PR 6): cancel the policy the sale booked, with
 * the chargeback. The reason is the Cancel button's (`note` required for
 * `other`); `cancelledOn` is the carrier's cancellation date, `YYYY-MM-DD`,
 * which decides the one-month clawback window.
 */
export interface ReconciliationCancelPolicyInput {
  reason: PolicyCancellationReason;
  note?: string | null;
  cancelledOn: string;
}

export interface ReconciliationCancelPolicyResponse {
  /** The row, finished — as `GET assigned/:rowId` answers it. */
  row: ReconciliationAssignedRowDetail;
  /** The cancelled policy as the household page lists it, chargeback linked. */
  policy: PolicySummary;
}

/** The signed application a service intake attaches to its policy. */
export interface ReconciliationServiceDocument {
  key: string;
  filename: string;
  contentType: string;
  size: number;
}

/**
 * `POST carrier-reconciliation/assigned/:rowId/service-intake` — the 1-800
 * row set up for service. The client is captured as a lead's household is
 * (DOB, phone and email on the primary), or pinned to an existing household.
 * Calendar dates are `YYYY-MM-DD`.
 */
export interface ReconciliationServiceIntakeInput {
  /** An existing client to add the policy to; omitted to resolve one. */
  householdId?: string | null;
  primaryContact: {
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    phone: string;
    email: string;
  };
  address?: { street?: string; city?: string; state?: string; zip?: string };
  members: {
    firstName: string;
    lastName: string;
    dateOfBirth?: string;
    role: string;
  }[];
  policy: {
    policyNumber: string;
    policyType: PolicyType;
    premium: number;
    itemCount: number;
    effectiveDate: string;
    newBusinessApplication: ReconciliationServiceDocument;
  };
  /** The CSR whose welcome call opens. */
  assignedCsrId: string;
  /** The welcome call's first timeline entry; the prefill's when omitted. */
  openingNote?: string | null;
}

export interface ReconciliationServiceIntakeResponse {
  /** What this request created — said even if the row moved meanwhile. */
  householdId: string;
  policyId: string;
  /**
   * `null` when the household and policy were saved but the welcome call could
   * not be opened: the row waits at `start_onboarding`, and Continue opens it.
   */
  onboardingId: string | null;
  ticketId: string | null;
  /**
   * The row as the caller now sees it; `null` once it is no longer theirs —
   * the owner took it back between saving and the hand-off.
   */
  row: ReconciliationAssignedRowDetail | null;
}

/** `GET carrier-reconciliation/assigned/:rowId/service-intake/options`. */
export interface ReconciliationServiceIntakeOptions {
  /** The CSRs a welcome call can go to — the ticket picker's pool. */
  assignees: ServiceTicketAssignee[];
}

/** `POST carrier-reconciliation/assigned/:rowId/documents/presign`. */
export interface ReconciliationDocumentPresignInput {
  filename: string;
  contentType: 'application/pdf';
  size: number;
}

/** The signed application's size limit, shared so the form and the API refuse alike. */
export const MAX_RECONCILIATION_DOCUMENT_BYTES = 10 * 1024 * 1024;

export interface ReconciliationAssignedListResponse {
  items: ReconciliationAssignedRow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ReconciliationPresignResponse {
  key: string;
  uploadUrl: string;
  requiredHeaders: Record<string, string>;
  expiresIn: number;
}

export interface ReclassifyRunResponse {
  reclassified: number;
  run: ReconciliationRunDetail;
}
