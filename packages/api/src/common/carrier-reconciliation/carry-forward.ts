import {
  RETIRED_RECONCILIATION_RESOLUTIONS,
  type ReconciliationIssue,
  type ReconciliationMatch,
  type ReconciliationResolution,
  type ReconciliationReviewStatus,
  type RetiredReconciliationResolution,
} from '@sfa/shared';

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
}

/** What carry-forward compares: the row's key, match and issues. */
export interface CarriedRow {
  rowKey: string;
  match: ReconciliationMatch | null;
  issues: readonly ReconciliationIssue[];
}

/** A carried decision, as the new row stores it (`StoredReview`). */
export interface CarriedReviewFields {
  status: ReconciliationReviewStatus;
  resolution: PreviousRowReview['resolution'];
  note: string | null;
  reviewedById: string | null;
  reviewedAt: Date | null;
  carriedForwardFromRowId: string;
}

/**
 * What a new row takes from the row it replaces: the fields to `$set` on it,
 * none when nothing carries. The one place the upload asks what carries, so a
 * new kind of carried state is added here and nowhere else.
 */
export interface CarriedFields {
  review?: CarriedReviewFields;
}

export function carriedFields(
  row: CarriedRow,
  previous: ReadonlyMap<string, PreviousRowReview>,
): CarriedFields {
  const fields: CarriedFields = {};
  const review = carriedReview(row, previous);
  if (review) {
    fields.review = {
      status: review.status,
      resolution: review.resolution,
      note: review.note,
      reviewedById: review.reviewedById,
      reviewedAt: review.reviewedAt,
      carriedForwardFromRowId: review.rowId,
    };
  }
  return fields;
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
  const before = previous.get(row.rowKey);
  if (!before || before.status === 'open') return null;
  if (isRetired(before.resolution)) return null;
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
