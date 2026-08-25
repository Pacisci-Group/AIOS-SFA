/**
 * Deal-audit workflow vocabulary (PAC-72).
 *
 * David's brief describes a 4-state machine — `Not Submitted → Pending →
 * Pass / Fail` — and it turns out **that is already the legacy vocabulary**:
 * SmartSuite's `deal_audit_status` on the Deals table is a single-select whose
 * choice *codes* are exactly these four strings. (Its *labels* are the
 * unrelated "Not Started / In Progress / Complete / Overdue", which is a red
 * herring — the migration writes `selectCode(...)`, i.e. the code.)
 *
 * So there is no mapping table and no translation layer: the migration and
 * `AuditGenerationService` were already writing canonical values. The only
 * dissenters were the demo seed and the post-sale fixture, which invented their
 * own words and are corrected to use these constants.
 */

/** The audit workflow's four states, in progression order. */
export const DEAL_AUDIT_STATUSES = [
  'Not Submitted',
  'Pending',
  'Pass',
  'Fail',
] as const;

export type DealAuditStatus = (typeof DEAL_AUDIT_STATUSES)[number];

/** Where a freshly generated audit starts. */
export const DEFAULT_DEAL_AUDIT_STATUS: DealAuditStatus = 'Not Submitted';

/** The two terminal states — a reviewer has ruled. */
export const TERMINAL_DEAL_AUDIT_STATUSES: readonly DealAuditStatus[] = [
  'Pass',
  'Fail',
];

/**
 * Why an audit failed (section B item 9).
 *
 * SmartSuite's `reason_codes` multi-select, adopted verbatim. David's brief
 * names only three of these; the other three are real choices in the legacy
 * table, and dropping them would silently discard migrated values. Both the
 * demo seed (`MISSING_DOC`, `PREMIUM_VAR`, `SIG_MISSING`) and the brief were
 * disagreeing with the source of truth — this is the source of truth.
 */
export const DEAL_AUDIT_REASON_CODES = [
  'Missing Docs',
  'Coverage Not Offered',
  'Incorrect Named Insured',
  'Incorrect Address',
  'Underwriting Issue',
  'Other',
] as const;

export type DealAuditReasonCode = (typeof DEAL_AUDIT_REASON_CODES)[number];

/**
 * An audit's assignee/reviewer is a user **or** a role (PAC-72 section E).
 *
 * A role assignee is a queue — "whoever on the CRM team picks it up" — which is
 * why one field covers both rather than there being a separate list.
 */
export const AUDIT_OWNER_TYPES = ['user', 'role'] as const;

export type AuditOwnerType = (typeof AUDIT_OWNER_TYPES)[number];

/**
 * How an owner is rendered. `id` is **always** an ObjectId string — a role's
 * `_id`, never its slug — so the access filter can match either kind with one
 * indexed predicate. `name` is resolved at read time, so renaming a role does
 * not strand stored data.
 */
export interface AuditOwnerView {
  type: AuditOwnerType;
  id: string;
  name: string;
}

/** What a reviewer can do with a submitted audit. */
export const AUDIT_REVIEW_DECISIONS = [
  'approve',
  'request_changes',
  'send_back',
] as const;

export type AuditReviewDecision = (typeof AUDIT_REVIEW_DECISIONS)[number];

/**
 * The state machine, as data.
 *
 * `request_changes` and `send_back` differ in *meaning*, not in destination —
 * "this failed review, fix it" versus "this isn't mine / not ready, take it
 * back". Both hand the audit back to the assignee, and both are recorded as
 * distinct activity types so the timeline can tell them apart. Folding them
 * into one decision would lose that distinction permanently.
 */
export const AUDIT_REVIEW_OUTCOMES: Record<AuditReviewDecision, DealAuditStatus> =
  {
    approve: 'Pass',
    request_changes: 'Fail',
    send_back: 'Not Submitted',
  };

/**
 * Whether an audit in `status` may be submitted for review.
 *
 * A `Pending` audit is already with the reviewer, so re-submitting is a no-op
 * at best. `Fail` **is** submittable — that is the correction loop the brief
 * asks for (section B item 8): fix the problem, submit again, back to
 * `Pending`.
 */
export function canSubmitAudit(status: DealAuditStatus): boolean {
  return status !== 'Pending';
}

/** Whether an audit in `status` is awaiting a reviewer's verdict. */
export function canReviewAudit(status: DealAuditStatus): boolean {
  return status === 'Pending';
}

/**
 * Coerce a stored value to a known status, defaulting to `Not Submitted`.
 *
 * Defensive rather than load-bearing: the seeds and migration all write
 * canonical values now. It exists so a stray legacy string renders as
 * "not submitted yet" instead of leaking raw data onto the board.
 */
export function normalizeDealAuditStatus(value?: string | null): DealAuditStatus {
  const match = DEAL_AUDIT_STATUSES.find((status) => status === value);
  return match ?? DEFAULT_DEAL_AUDIT_STATUS;
}
