import { approveBlockers, reviewCounts } from '@sfa/shared';
import type {
  AuditItemReviewView,
  AuditItemVerdict,
  DealAuditReviewItem,
  DealAuditReviewView,
} from '@sfa/shared';
import { Types } from 'mongoose';
import type { DealAuditItem } from '../deal-audit-items/schemas/deal-audit-item.schema';

/**
 * An audit item as the review surfaces read it (PAC-106) — the hand-off
 * board's `review` field, the Deal Audit page's checklist, and the Approve
 * gate. One mapper, so the producer and the manager see the same ruling.
 */
export type ReviewItemLean = Pick<
  DealAuditItem,
  | 'itemName'
  | 'category'
  | 'subjectName'
  | 'isFailed'
  | 'isResolved'
  | 'resolvedAt'
  | 'notes'
  | 'attachments'
  | 'reviewNote'
  | 'reviewedAt'
> & {
  _id: Types.ObjectId;
  dealAuditId?: Types.ObjectId;
  // Optional: absent on an item no migration or generation has flagged yet.
  producerVisible?: boolean;
  requiresUpload?: boolean;
  reviewVerdict?: AuditItemVerdict | null;
  reviewedById?: Types.ObjectId | null;
};

/** The fields {@link toReviewItem} reads — a `find().select()` projection. */
export const REVIEW_ITEM_PROJECTION = {
  itemName: 1,
  category: 1,
  subjectName: 1,
  isFailed: 1,
  isResolved: 1,
  resolvedAt: 1,
  notes: 1,
  attachments: 1,
  dealAuditId: 1,
  producerVisible: 1,
  requiresUpload: 1,
  reviewVerdict: 1,
  reviewNote: 1,
  reviewedAt: 1,
  reviewedById: 1,
} as const;

/** Every reviewer an item list names, for one batched name lookup. */
export function reviewerIds(
  records: ReadonlyArray<Pick<ReviewItemLean, 'reviewedById'>>,
): Types.ObjectId[] {
  return records
    .map((record) => record.reviewedById)
    .filter((id): id is Types.ObjectId => !!id);
}

/** The manager's ruling. `names` maps user id → display name. */
export function toReviewView(
  record: Pick<
    ReviewItemLean,
    'reviewVerdict' | 'reviewNote' | 'reviewedAt' | 'reviewedById'
  >,
  names: ReadonlyMap<string, string>,
): AuditItemReviewView {
  const verdict = record.reviewVerdict ?? null;
  return {
    verdict,
    note: record.reviewNote?.trim() || null,
    reviewedAt:
      verdict && record.reviewedAt ? record.reviewedAt.toISOString() : null,
    reviewedByName:
      verdict && record.reviewedById
        ? (names.get(record.reviewedById.toString()) ?? null)
        : null,
  };
}

/** One row of the Deal Audit page's checklist. */
export function toReviewItem(
  record: ReviewItemLean,
  names: ReadonlyMap<string, string>,
): DealAuditReviewItem {
  return {
    id: record._id.toString(),
    itemName: record.itemName ?? 'Requirement',
    category: record.category ?? null,
    subjectName: record.subjectName ?? null,
    producerVisible: record.producerVisible !== false,
    requiresUpload: record.requiresUpload === true,
    open: record.isFailed === true && record.isResolved !== true,
    isResolved: record.isResolved === true,
    resolvedAt: record.resolvedAt ? record.resolvedAt.toISOString() : null,
    producerNote: record.notes?.trim() || null,
    // Index, never the storage key — the same rule as the board.
    attachments: (record.attachments ?? []).map((file, index) => ({
      index,
      filename: file.filename,
      contentType: file.contentType,
      size: file.size,
      uploadedAt: file.uploadedAt
        ? new Date(file.uploadedAt).toISOString()
        : null,
    })),
    review: toReviewView(record, names),
  };
}

/**
 * The page's checklist order: the deal-level checks first (sold date, quote
 * recap …), then prior insurance, then each line — the order the manager
 * reads the application in. Alphabetical within a category.
 */
const CATEGORY_ORDER = [
  'common',
  'prior insurance',
  'auto',
  'home',
  'landlord',
];

function categoryRank(category: string | null): number {
  const rank = CATEGORY_ORDER.indexOf((category ?? '').trim().toLowerCase());
  return rank === -1 ? CATEGORY_ORDER.length : rank;
}

export function compareReviewItems(
  a: DealAuditReviewItem,
  b: DealAuditReviewItem,
): number {
  return (
    categoryRank(a.category) - categoryRank(b.category) ||
    a.itemName.localeCompare(b.itemName)
  );
}

/**
 * The Deal Audit page's tally and its two buttons, from the checklist and from
 * whether the caller may review at all (`DealAuditsService.canReview`).
 *
 * The one place `canApprove` / `canSendBack` are decided (PAC-106 review): the
 * page read and the verdict response used to compute them two ways under the
 * same names — one clamped by `canReview`, one not — and the web re-clamped
 * the second. Both endpoints now return this.
 */
export function reviewGates(
  canReview: boolean,
  items: readonly DealAuditReviewItem[],
): Pick<
  DealAuditReviewView['audit'],
  'canApprove' | 'canSendBack' | 'unmet' | 'counts'
> {
  const counts = reviewCounts(items);
  const unmet = approveBlockers(items);
  return {
    canApprove: canReview && unmet.length === 0,
    canSendBack: canReview && counts.failed > 0,
    unmet,
    counts,
  };
}
