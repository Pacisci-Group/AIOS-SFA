import type {
  ReconciliationIssue,
  ReconciliationMatch,
  ReconciliationResolution,
  ReconciliationReviewStatus,
} from '@sfa/shared';

/** What a superseded run's row carries forward. */
export interface PreviousRowReview {
  rowId: string;
  match: ReconciliationMatch | null;
  issues: readonly ReconciliationIssue[];
  status: ReconciliationReviewStatus;
  resolution: ReconciliationResolution | null;
  note: string | null;
  reviewedById: string | null;
  reviewedAt: Date | null;
}

/**
 * A decision made on a run carries to the run that replaces it — the same
 * report uploaded again after a fix — **only if the row still says the same
 * thing**: same row key, same match, same issues.
 *
 * A row resolved as "entered in app" that still shows `dash_only` was not, in
 * fact, entered; carrying that decision would bury the very row the re-upload
 * was meant to re-check. So any change reopens it.
 */
export function carriedReview(
  row: {
    rowKey: string;
    match: ReconciliationMatch | null;
    issues: readonly ReconciliationIssue[];
  },
  previous: ReadonlyMap<string, PreviousRowReview>,
): PreviousRowReview | null {
  const before = previous.get(row.rowKey);
  if (!before || before.status === 'open') return null;
  if (before.match !== row.match) return null;
  if (issueSignature(before.issues) !== issueSignature(row.issues)) return null;
  return before;
}

function issueSignature(issues: readonly ReconciliationIssue[]): string {
  return [...issues].sort().join(',');
}
