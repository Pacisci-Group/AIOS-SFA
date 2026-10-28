import {
  RETIRED_RECONCILIATION_RESOLUTIONS,
  type ReconciliationIssue,
  type ReconciliationMatch,
  type ReconciliationResolution,
  type ReconciliationReviewStatus,
  type RetiredReconciliationResolution,
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

/** What a superseded run's row carries forward. */
export interface PreviousRowReview {
  rowId: string;
  match: ReconciliationMatch | null;
  issues: readonly ReconciliationIssue[];
  status: ReconciliationReviewStatus;
  resolution: ReconciliationResolution | RetiredReconciliationResolution | null;
  note: string | null;
  reviewedById: string | null;
  reviewedAt: Date | null;
  assignment: RowAssignment | null;
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
  row: {
    rowKey: string;
    match: ReconciliationMatch | null;
    issues: readonly ReconciliationIssue[];
  },
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
  row: {
    rowKey: string;
    match: ReconciliationMatch | null;
    issues: readonly ReconciliationIssue[];
  },
  previous: ReadonlyMap<string, PreviousRowReview>,
): RowAssignment | null {
  return sameRowBefore(row, previous)?.assignment ?? null;
}

function sameRowBefore(
  row: {
    rowKey: string;
    match: ReconciliationMatch | null;
    issues: readonly ReconciliationIssue[];
  },
  previous: ReadonlyMap<string, PreviousRowReview>,
): PreviousRowReview | null {
  const before = previous.get(row.rowKey);
  if (!before) return null;
  if (before.match !== row.match) return null;
  if (issueSignature(before.issues) !== issueSignature(row.issues)) return null;
  return before;
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
