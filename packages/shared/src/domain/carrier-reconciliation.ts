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
 *   name is a former employee's, never 1-800 (David, 27 Oct 2026).
 * - `producer_mismatch` — matched, but Dash credits a different producer than
 *   the app's deal does.
 * - `matched` — in both.
 * - `ignored` — Dash lines that are not new policies (add-item endorsements,
 *   Motor Club), kept so the file's line count reconciles.
 *
 * Producer identity comes from the Allstate codes on each **user**
 * (`allstate-codes.ts`): a Bind ID (who bound the policy in the portal) and a
 * sub-producer code (who gets the credit). They are different on purpose —
 * producers bind for one another all the time — so the 1-800 test reads the
 * Bind ID only, and credit reads the sub-producer code first.
 */

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
  'producer_mismatch',
  'matched',
  'ignored',
] as const;
export type ReconciliationTab = (typeof RECONCILIATION_TABS)[number];

export const RECONCILIATION_TAB_LABELS: Record<ReconciliationTab, string> = {
  missing_from_app: 'Missing from app',
  not_in_dash: 'Not in Dash',
  review_1800: '1-800 review',
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
 * (`not_staff_bind_id`, `direct_channel`, `producer_mismatch`); the rest are
 * context shown beside it.
 */
export const RECONCILIATION_ISSUES = [
  'not_staff_bind_id',
  'former_staff_bind_id',
  'no_bind_id',
  'direct_channel',
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
    producer_mismatch: 'Dash credits a different producer',
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

/** What the reviewer concluded. Free text goes in the note. */
export const RECONCILIATION_RESOLUTIONS = [
  'entered_in_app',
  'number_corrected',
  'credit_corrected',
  'confirmed_1800',
  'timing',
  'not_ours',
  'duplicate',
  'other',
] as const;
export type ReconciliationResolution =
  (typeof RECONCILIATION_RESOLUTIONS)[number];

export const RECONCILIATION_RESOLUTION_LABELS: Record<
  ReconciliationResolution,
  string
> = {
  entered_in_app: 'Deal entered in the app',
  number_corrected: 'Policy number corrected',
  credit_corrected: 'Producer credit corrected',
  confirmed_1800: 'Confirmed 1-800 policy',
  timing: 'Timing — recheck next month',
  not_ours: 'Not this agency’s business',
  duplicate: 'Duplicate',
  other: 'Other',
};

/** The resolutions that make sense on a row in each tab, in display order. */
export const RECONCILIATION_RESOLUTIONS_BY_TAB: Record<
  ReconciliationTab,
  readonly ReconciliationResolution[]
> = {
  missing_from_app: ['entered_in_app', 'number_corrected', 'not_ours', 'other'],
  not_in_dash: ['number_corrected', 'timing', 'not_ours', 'duplicate', 'other'],
  review_1800: ['confirmed_1800', 'entered_in_app', 'not_ours', 'other'],
  producer_mismatch: ['credit_corrected', 'other'],
  matched: ['other'],
  ignored: ['other'],
};

/**
 * A per-producer summary key as a filter value: `user:<id>`,
 * `code:<sub-producer>`, `bind:<Bind ID>` or `none`. Shared so the rows
 * endpoint and the page's URL guard accept the same keys.
 */
export const RECONCILIATION_PRODUCER_KEY_PATTERN =
  /^(user:[a-f0-9]{24}|code:[A-Z0-9-]{1,12}|bind:[A-Z0-9._-]{1,32}|none)$/i;

/** Error codes the page maps to copy (`ApiError.body.code`). */
export const RECONCILIATION_DUPLICATE_FILE = 'RECONCILIATION_DUPLICATE_FILE';
export const RECONCILIATION_WRONG_AGENCY = 'RECONCILIATION_WRONG_AGENCY';
export const RECONCILIATION_NO_APPOINTMENT = 'RECONCILIATION_NO_APPOINTMENT';
export const RECONCILIATION_UNREADABLE_FILE = 'RECONCILIATION_UNREADABLE_FILE';

/** Upload limits, shared so the dropzone and the API refuse the same files. */
export const MAX_RECONCILIATION_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_RECONCILIATION_ROWS = 20_000;
export const RECONCILIATION_FILE_EXTENSIONS = ['.xlsx'] as const;

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
  producerMismatch: number;
  /** Written premium of every new-policy line. */
  dashPremium: number;
  matchedPremium: number;
  missingPremium: number;
  appOnlyPremium: number;
  /** Written premium of 1-800 new policies. */
  review1800Premium: number;
  /** `matched / (matched + missing)`; `null` with nothing to divide. */
  captureRate: number | null;
}

/** One producer's line in the run summary — the workbook's "By Carrier Producer". */
export interface ReconciliationProducerSummary {
  /**
   * `user:<id>`, `code:<sub-producer code>`, `bind:<Bind ID>` (a former
   * employee Dash names, whose Bind ID is on no user) or `none`.
   */
  producerKey: string;
  userId: string | null;
  /** The app user's name, else the name Dash prints, else the code. */
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
  resolution: ReconciliationResolution | null;
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
  /** Who Dash credits: the user holding the code, else the name it prints. */
  credit: {
    code: string | null;
    name: string | null;
    userId: string | null;
    userName: string | null;
  };
  suggestions: ReconciliationSuggestion[];
  review: ReconciliationReview;
}

export interface ReconciliationRowListResponse {
  items: ReconciliationRowView[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ReconciliationOptionsResponse {
  users: { id: string; name: string; isActive: boolean }[];
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
