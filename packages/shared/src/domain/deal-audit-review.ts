import type { DataExportOption } from './data-export';
import type { AuditWorkflowView, DealAuditStatus } from './deal-audit';
import { OWNER_DASHBOARD_RANGE_KEYS } from './owner-dashboard';

/**
 * The manager's side of the deal audit (PAC-106).
 *
 * David, 24 Aug: "The producer doesn't have the final say in passing off to
 * service. The only thing they're doing is upload documentation for their deal
 * audits. The manager is reviewing the documentation and making sure it's
 * correct, and if it's not, they send it back. The manager is the gatekeeper."
 *
 * ## An item has two truths, and they are never collapsed
 *
 * - The producer's **claim** — `isResolved` / `notes` / `resolvedAt` on the
 *   item, written by "Mark resolved" on the hand-off board (PAC-14).
 * - The manager's **verdict** — `reviewVerdict` / `reviewNote`, written on the
 *   Deal Audit page, item by item.
 *
 * A pass verdict also resolves the item (it is the stronger fact, and the only
 * way an item the producer never sees can ever close). A fail verdict leaves
 * the claim alone until the audit is sent back, which reopens every failed
 * item on the producer's board.
 */

/** The manager's per-item ruling. `null` on an item means "not yet reviewed". */
export const AUDIT_ITEM_VERDICTS = ['pass', 'fail'] as const;

export type AuditItemVerdict = (typeof AUDIT_ITEM_VERDICTS)[number];

/**
 * Who sees an item, and whether it needs a file — the two per-template flags
 * (PAC-106 §3). Copied onto each item when it is generated, so a read never
 * joins the template catalog.
 */
export interface AuditItemVisibility {
  /**
   * `false` = **manager-only**: Correct Sold Date, Quote Recap, Drivers
   * Verified and the like, which the manager checks against the application
   * and the producer has nothing to add to. Absent reads as visible — a custom
   * template an agency adds reaches the producer unless someone hides it.
   */
  producerVisible?: boolean | null;
  /** The producer cannot mark it resolved without a document on file. */
  requiresUpload?: boolean | null;
}

/**
 * Whether the item belongs on the **producer's** hand-off board.
 *
 * Every producer-visible item, plus any manager-only item the manager failed:
 * a failed *Correct Sold Date* carries the manager's note and is fixed through
 * the producer's "Fix it" action, so hiding it would send the deal back with
 * nothing on it to act on.
 *
 * ⚠ `audit-counters.ts` has the Mongo `$expr` twin of this rule
 * (`IS_PRODUCER_ACTIONABLE`). A unit test pins the two to the same truth
 * table; change both or neither.
 */
export function isProducerActionable(
  item: Pick<AuditItemVisibility, 'producerVisible'> & {
    reviewVerdict?: AuditItemVerdict | null;
  },
): boolean {
  return item.producerVisible !== false || item.reviewVerdict === 'fail';
}

/** The manager's ruling on one item, as every surface renders it. */
export interface AuditItemReviewView {
  verdict: AuditItemVerdict | null;
  note: string | null;
  /** ISO instant of the last verdict change. */
  reviewedAt: string | null;
  reviewedByName: string | null;
}

/**
 * The marker a send-back leaves on the audit until the producer resubmits —
 * "sent back by <manager> — <note>" on the producer's card and drawer.
 */
export interface DealAuditSentBackView {
  /** ISO instant. */
  at: string;
  byName: string;
  note: string | null;
  /** How many items the manager failed. */
  failedItemCount: number;
}

/** An item, named — what the Approve gate lists as still outstanding. */
export interface AuditItemRef {
  id: string;
  itemName: string;
}

/** The running tally at the top of the Deal Audit page. */
export interface AuditReviewCounts {
  passed: number;
  failed: number;
  /** No verdict yet. */
  remaining: number;
}

type HasVerdict = { review: Pick<AuditItemReviewView, 'verdict'> };

/** Passed / failed / not yet reviewed. */
export function reviewCounts(items: readonly HasVerdict[]): AuditReviewCounts {
  let passed = 0;
  let failed = 0;
  for (const item of items) {
    if (item.review.verdict === 'pass') passed += 1;
    else if (item.review.verdict === 'fail') failed += 1;
  }
  return { passed, failed, remaining: items.length - passed - failed };
}

/**
 * What stands between the audit and **Approve**: every item not marked `pass`.
 *
 * The gate is strict (decided 19 Oct 2026): an item that does not apply is
 * passed with a note saying so, never skipped. The API answers a premature
 * approve with this list in its `409`, and the page disables the button with
 * the same list — one rule, so the two cannot disagree.
 *
 * An audit with no items has nothing outstanding, so it may be approved.
 */
export function approveBlockers(
  items: ReadonlyArray<AuditItemRef & HasVerdict>,
): AuditItemRef[] {
  return items
    .filter((item) => item.review.verdict !== 'pass')
    .map(({ id, itemName }) => ({ id, itemName }));
}

/**
 * The Deal Audits queue's status chips. `open` is the default — everything the
 * manager still has to think about, i.e. everything but `Pass`.
 */
export const DEAL_AUDIT_QUEUE_STATUSES = [
  'open',
  'not_submitted',
  'pending',
  'fail',
  'pass',
  'all',
] as const;

export type DealAuditQueueStatus = (typeof DEAL_AUDIT_QUEUE_STATUSES)[number];

/** Chip labels. `Fail` reads "Sent back" — that is what the manager did. */
export const DEAL_AUDIT_QUEUE_STATUS_LABELS: Record<
  DealAuditQueueStatus,
  string
> = {
  open: 'All open',
  not_submitted: 'Not submitted',
  pending: 'Ready for review',
  fail: 'Sent back',
  pass: 'Approved',
  all: 'All',
};

/**
 * How the queue can be ordered (20 Oct 2026). `waiting` — oldest sale first,
 * the deal that has sat longest — is the default and what PAC-106 shipped.
 */
export const DEAL_AUDIT_QUEUE_SORTS = [
  'waiting',
  'client',
  'producer',
  'submitted',
] as const;

export type DealAuditQueueSort = (typeof DEAL_AUDIT_QUEUE_SORTS)[number];

export const DEAL_AUDIT_QUEUE_SORT_LABELS: Record<DealAuditQueueSort, string> =
  {
    waiting: 'Longest waiting',
    client: 'Client A–Z',
    producer: 'Producer A–Z',
    submitted: 'Recently submitted',
  };

/**
 * The queue's sold-date periods: `all` — no window, the default — then the
 * management dashboards' chips, so "Last Month" means the same thing on every
 * page. The dashboards default to month-to-date; a queue that hid last
 * month's still-open audits by default would hide the ones that matter most.
 */
export const DEAL_AUDIT_QUEUE_RANGE_KEYS = [
  'all',
  ...OWNER_DASHBOARD_RANGE_KEYS,
] as const;

export type DealAuditQueueRangeKey =
  (typeof DEAL_AUDIT_QUEUE_RANGE_KEYS)[number];

/**
 * `GET /deal-audits/queue/options` — who the producer filter can offer: the
 * sellers of the deals in the caller's reach, departed ones marked.
 */
export interface DealAuditQueueOptionsResponse {
  producers: DataExportOption[];
}

/**
 * One row of the Deal Audits queue — one per **deal**, never per item ("they
 * don't need to see Daniel Lopez eight times"). Same identity fields as the
 * Manager view's `AgingAuditRow`, so both link to `/deal-audits/:dealId`.
 */
export interface DealAuditQueueRow {
  dealAuditId: string;
  dealId: string;
  householdId: string | null;
  clientName: string;
  /** Who sold it. */
  producerId: string | null;
  producerName: string | null;
  /** Who is gathering the evidence now (a user; null when a role owns it). */
  assigneeId: string | null;
  assigneeName: string | null;
  auditStatus: DealAuditStatus;
  /** ISO instant of the sale — the aging clock starts here. */
  soldDate: string | null;
  /** Business days since the sold date, on the agency's calendar. */
  businessDaysOpen: number;
  /** More than `MANAGEMENT_AUDIT_SLA_BUSINESS_DAYS` — rendered as aging. */
  aging: boolean;
  itemCount: number;
  counts: AuditReviewCounts;
  /** Items still open on the producer's board. */
  producerOpenCount: number;
  /** ISO; null until submitted. */
  submittedAt: string | null;
  sentBack: DealAuditSentBackView | null;
  /** The caller may open the page and rule on it right now. */
  canReview: boolean;
}

export interface DealAuditQueueResponse {
  page: number;
  pageSize: number;
  /** Deals, not items. */
  total: number;
  totalPages: number;
  items: DealAuditQueueRow[];
}

/** A document already on an item. Never the storage key. */
export interface DealAuditReviewAttachment {
  /** Position in the item's `attachments` — what the download route takes. */
  index: number;
  filename: string;
  contentType: string;
  size: number;
  uploadedAt: string | null;
}

/** One checklist row on the Deal Audit page — every item, manager-only too. */
export interface DealAuditReviewItem {
  id: string;
  itemName: string;
  category: string | null;
  /** Who the item is about when one template fans out (Defensive Driver). */
  subjectName: string | null;
  producerVisible: boolean;
  requiresUpload: boolean;
  /** Still outstanding on the producer's side: failed and not resolved. */
  open: boolean;
  /** The producer's claim. */
  isResolved: boolean;
  resolvedAt: string | null;
  /** The producer's note from "Mark resolved". */
  producerNote: string | null;
  attachments: DealAuditReviewAttachment[];
  review: AuditItemReviewView;
}

/** Metadata of an uploaded document. The key never leaves the server. */
export interface DealAuditDocumentMeta {
  filename: string;
  contentType: string;
  size: number;
  uploadedAt: string | null;
}

/** A policy the sale bound, as the manager checks it against its application. */
export interface DealAuditReviewPolicy {
  id: string;
  policyNumber: string | null;
  /** Canonical label. */
  policyType: string;
  carrier: string | null;
  premium: number;
  /** `YYYY-MM-DD`. */
  effectiveDate: string | null;
  /** The signed new business application (PAC-56 #23); null when none. */
  newBusinessApplication: DealAuditDocumentMeta | null;
}

/** The quote the sale came from — what "Quote Recap present" is judged on. */
export interface DealAuditReviewQuoteRecap {
  id: string;
  /** ISO. */
  quoteDate: string | null;
  premium: number;
  itemCount: number;
  /** Canonical labels. */
  productsQuoted: string[];
  policies: Array<{ policyType: string; premium: number; itemCount: number }>;
  notes: string | null;
  producerName: string | null;
  document: DealAuditDocumentMeta | null;
}

/** The lead behind the sale, for the "View lead" drawer. */
export interface DealAuditReviewLead {
  id: string;
  name: string;
  /** Canonical lead status. */
  status: string | null;
  temperature: string | null;
  leadSourceName: string | null;
  /** ISO. */
  createdDate: string | null;
  producerName: string | null;
  phone: string | null;
  email: string | null;
}

/** `GET /deal-audits/deals/:dealId/review` — everything the page needs. */
export interface DealAuditReviewView {
  audit: AuditWorkflowView & {
    /** Every item passed — the Approve button's gate. */
    canApprove: boolean;
    /** Reviewable, and at least one item failed — the Send back gate. */
    canSendBack: boolean;
    /** Items not yet passed, in checklist order. */
    unmet: AuditItemRef[];
    counts: AuditReviewCounts;
  };
  deal: {
    id: string;
    clientName: string;
    householdId: string | null;
    householdName: string | null;
    leadId: string | null;
    /** ISO instant. */
    soldDate: string | null;
    /** The sold date as the agency's calendar day, `YYYY-MM-DD`. */
    soldDay: string | null;
    dealType: string;
    /** Canonical labels. */
    policyTypes: string[];
    premium: number;
    producerId: string | null;
    producerName: string | null;
    businessDaysOpen: number;
    aging: boolean;
  };
  policies: DealAuditReviewPolicy[];
  quoteRecap: DealAuditReviewQuoteRecap | null;
  lead: DealAuditReviewLead | null;
  items: DealAuditReviewItem[];
}

/** `PATCH /deal-audits/:itemId/verdict` — the item, and the page's new gates. */
export interface SetAuditItemVerdictResponse {
  item: DealAuditReviewItem;
  counts: AuditReviewCounts;
  canApprove: boolean;
  canSendBack: boolean;
  unmet: AuditItemRef[];
}
