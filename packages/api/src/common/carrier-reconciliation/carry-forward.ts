import {
  RETIRED_RECONCILIATION_RESOLUTIONS,
  type ReconciliationIssue,
  type ReconciliationMatch,
  type ReconciliationOutcomeKind,
  type ReconciliationOutcomeStatus,
  type ReconciliationOutcomeStep,
  type ReconciliationReviewStatus,
  type StoredReconciliationResolution,
} from '@sfa/shared';

/**
 * Who a row was handed to. Ids are strings, like the review's: it is a
 * snapshot read back whole, and queried by `assignment.userId` as a string.
 */
export interface RowAssignment {
  userId: string;
  /** Who handed it over — the owner, or whoever ran a work transfer. */
  assignedById: string | null;
  assignedAt: Date;
  note: string | null;
}

/**
 * What the assignee recorded on a row (PAC-173 PR 4): Sold, Cancel rewrite,
 * Chargeback (PR 6), Service intake (PR 5) or Other. Its own field beside
 * `assignment`, for the same reason — saving a decision replaces `review` whole
 * and must not drop it.
 *
 * Ids are strings, like every id in these snapshots: it is read back whole,
 * and the links (`leadId`, `dealId`, …) are followed one at a time, never
 * joined on. A sale kind starts `in_progress` at `record_sale`; a cancel
 * rewrite then waits at `write_replacement` for its replacement, and a
 * chargeback at `cancel_policy` for its policy to be cancelled; a service
 * intake waits at `start_onboarding` only until its welcome call opens;
 * `other` is done at once. Done comes with the row resolved
 * (`RECONCILIATION_OUTCOME_RESOLUTION`), so an open row holds no outcome or
 * one in progress — except a service intake finished on a row a re-upload
 * carried it to that asks something else (a premium difference): that stays
 * open for the owner, and off the assignee's list (`openAssignmentsFilter`).
 */
export interface RowOutcome {
  kind: ReconciliationOutcomeKind;
  status: ReconciliationOutcomeStatus;
  /** `null` once done, and for `other`. */
  step: ReconciliationOutcomeStep | null;
  note: string | null;
  /** The lead the sale is booked on — stamped as soon as it exists. */
  leadId: string | null;
  /** The deal that books the Dash line. */
  dealId: string | null;
  /** That deal's policy which is the Dash line. */
  policyId: string | null;
  householdId: string | null;
  /** A cancel rewrite's replacement, and the chargeback the rewrite wrote. */
  replacementPolicyId: string | null;
  chargebackId: string | null;
  /**
   * A service intake (PAC-173 PR 5): the CSR its welcome call goes to — kept
   * so a retried hand-off needs nothing but the row — then the onboarding and
   * its welcome-call ticket once open. Absent on outcomes stored before.
   */
  csrId?: string | null;
  onboardingId?: string | null;
  ticketId?: string | null;
  /** While someone is opening the welcome call — so only one does. */
  handOffAt?: Date | null;
  startedById: string;
  startedAt: Date;
  completedById: string | null;
  completedAt: Date | null;
}

/** What a superseded run's row carries forward. */
export interface PreviousRowReview {
  rowId: string;
  match: ReconciliationMatch | null;
  issues: readonly ReconciliationIssue[];
  status: ReconciliationReviewStatus;
  resolution: StoredReconciliationResolution | null;
  note: string | null;
  reviewedById: string | null;
  reviewedAt: Date | null;
  assignment: RowAssignment | null;
  outcome: RowOutcome | null;
}

/**
 * A decision made on a run carries to the run that replaces it — the same
 * report uploaded again after a fix — **only if the row still says the same
 * thing**: same row key, same match, same issues.
 *
 * A row resolved as "entered in app" that still shows `dash_only` was not, in
 * fact, entered; carrying that decision would bury the very row the re-upload
 * was meant to re-check. So any change reopens it — and so does a resolution
 * no longer offered (`confirmed_1800`): what it decided is not what the row
 * asks for now.
 */
export function carriedReview(
  row: CarriedRow,
  previous: ReadonlyMap<string, PreviousRowReview>,
): PreviousRowReview | null {
  const before = sameRowBefore(row, previous);
  if (!before || before.status === 'open') return null;
  if (isRetired(before.resolution)) return null;
  return before;
}

/**
 * The assignment carries on the same terms as a decision: only to a row that
 * still says the same thing. A row whose classification changed starts with
 * nobody on it, because the person was handed a different problem. It is the
 * same hand-off, so nobody is notified again.
 */
export function carriedAssignment(
  row: CarriedRow,
  previous: ReadonlyMap<string, PreviousRowReview>,
): RowAssignment | null {
  return sameRowBefore(row, previous)?.assignment ?? null;
}

/**
 * The outcome carries on the same terms again (PAC-173 PR 4). One still in
 * progress travels with its assignment, so the assignee resumes where they
 * were; a done one travels with the decision it resolved the row with, and
 * still names what it created.
 *
 * Booking the Dash policy makes the row match next upload, so a sale recorded
 * between two uploads changes the row and nothing carries — by design: the row
 * no longer asks the question. An unfinished cancel rewrite across such a
 * re-upload therefore starts over on the new row, and its sale hook no-ops —
 * and so does an unfinished chargeback (PAC-173 PR 6), whose policy can still
 * be cancelled with its chargeback from the household page. A
 * finished service intake is the exception ({@link CarriedRow}, `servicedSince`).
 */
export function carriedOutcome(
  row: CarriedRow,
  previous: ReadonlyMap<string, PreviousRowReview>,
): RowOutcome | null {
  return sameRowBefore(row, previous)?.outcome ?? null;
}

/**
 * What carry-forward compares: the row's key, match and issues — and, for the
 * one exception below, the app policy it matched.
 */
export interface CarriedRow {
  rowKey: string;
  match: ReconciliationMatch | null;
  issues: readonly ReconciliationIssue[];
  app?: { policyId: string; origin?: string | null } | null;
  /** Whether the new row asks for a decision — the exception needs it not to. */
  needsReview?: boolean;
}

function sameRowBefore(
  row: CarriedRow,
  previous: ReadonlyMap<string, PreviousRowReview>,
): PreviousRowReview | null {
  const before = previous.get(row.rowKey);
  if (!before) return null;
  if (servicedSince(before, row)) return before;
  if (before.match !== row.match) return null;
  if (issueSignature(before.issues) !== issueSignature(row.issues)) return null;
  return before;
}

/**
 * The one change of row that still carries (PAC-173 PR 5): a 1-800 line set
 * up for service now matches the policy that intake created. The row no longer
 * asks anything — it is clean `matched`, with `direct_1800` — but its decision,
 * assignee and finished outcome are the record of who set it up, and the
 * outcome links the household, policy and welcome call, so they stay on the
 * owner's page. Only a done `service_intake` whose policy is the one the line
 * now matches; anything else starts clean.
 */
function servicedSince(before: PreviousRowReview, row: CarriedRow): boolean {
  const outcome = before.outcome;
  if (
    before.match !== 'dash_only' ||
    row.match !== 'matched' ||
    row.app?.origin !== 'carrier_direct' ||
    outcome?.kind !== 'service_intake' ||
    outcome.policyId !== row.app.policyId
  ) {
    return false;
  }
  // Still waiting on its welcome call (the upload could not open it): it
  // travels to the new row, which waits on a decision until it is opened.
  if (isPendingServiceIntake(outcome)) return true;
  // Done — but only onto a clean row: a premium the app and Dash now disagree
  // on is a new question, and a decision carried onto it would hide it.
  return outcome.status === 'done' && row.needsReview === false;
}

/**
 * A 1-800 service intake whose household and policy are saved and whose
 * welcome call is not open yet (PAC-173 PR 5). Its row stays waiting on a
 * decision, wherever it is, until someone opens the call.
 */
export function isPendingServiceIntake(
  outcome: RowOutcome | null | undefined,
): boolean {
  return (
    outcome?.kind === 'service_intake' &&
    outcome.status === 'in_progress' &&
    outcome.step === 'start_onboarding'
  );
}

function isRetired(resolution: string | null): boolean {
  return (
    !!resolution &&
    (RETIRED_RECONCILIATION_RESOLUTIONS as readonly string[]).includes(
      resolution,
    )
  );
}

function issueSignature(issues: readonly ReconciliationIssue[]): string {
  return [...issues].sort().join(',');
}
