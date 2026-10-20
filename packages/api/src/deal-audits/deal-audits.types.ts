import type {
  ActivityType,
  AuditItemReviewView,
  DealAuditSentBackView,
  DealAuditStatus,
} from '@sfa/shared';
import { DealType } from '../deals/schemas/deal.schema';

/*
 * In `@sfa/shared` since PAC-106 — the Deal Audit page's view extends it.
 * Re-exported so the many existing imports from here keep working.
 */
export type { AuditWorkflowView } from '@sfa/shared';

/**
 * A document already attached to a hand-off item (PAC-56 #21b, surfaced by
 * PAC-65 #16).
 *
 * ⚠ The storage `key` is deliberately **not** here. Its prefix is what
 * `assertKeyOwnership` treats as a security property, and this service already
 * masks record ids for the same reason. `index` is what the download route
 * takes, and is all the client needs.
 */
export interface DealAuditRowAttachment {
  /** Position in the item's `attachments` array — the download route's param. */
  index: number;
  filename: string;
  contentType: string;
  size: number;
}

/**
 * One requirement on a deal's checklist.
 *
 * The drawer lists **every** requirement, not only the outstanding ones —
 * "missing requirements colour-coded and sorted to the top" (PAC-72 section A
 * item 5) only means something if the settled ones are there to sort above.
 */
export interface DealAuditItemRow {
  /** Raw item id — what the resolve endpoint takes. */
  id: string;
  /** The requirement's name, e.g. `Prior Insurance`. */
  missing: string;
  /** Days this item has been open. */
  daysOpen: number;
  /**
   * Still outstanding: failed the audit and not yet resolved. Drives both the
   * colour coding and the ordering.
   *
   * ⚠ **No checkmark on the settled ones.** David rejected checkmarks
   * explicitly (item 4); the deal's completion percentage replaces them.
   */
  open: boolean;
  /**
   * The soft 7-day deadline, ISO — or `null` for items generated before the
   * field existed, which are never overdue. Display and filtering only; nothing
   * changes state when it passes (PAC-65).
   */
  dueAt: string | null;
  /**
   * Proof the producer already uploaded, so the auditor can verify it in place
   * rather than chasing it. An **empty array is meaningful**: it is what makes
   * the row read "call the client and obtain it" (PAC-65 #16).
   */
  attachments: DealAuditRowAttachment[];
  /** The producer cannot resolve it without a document (PAC-106). */
  requiresUpload: boolean;
  /**
   * A manager-only item that is on the board only because the manager failed
   * it — the producer fixes it through the sale, not by uploading here.
   */
  managerOnly: boolean;
  /** The manager's ruling; a `fail` carries the note the producer acts on. */
  review: AuditItemReviewView;
}

/**
 * One **deal** on the Producer Dashboard board (PAC-72 section A item 1).
 *
 * Was one row per audit *item*, which is what David asked to replace: a bundled
 * Auto + Home sale with six open requirements rendered as six rows with six
 * Resolve buttons and could fill the board by itself.
 */
export interface DealAuditDealRow {
  /** The audit record's id (opaque; UI shows `ref` instead). */
  id: string;
  /**
   * The deal this audit belongs to.
   *
   * Every workflow endpoint is keyed on the **deal**, not on the audit — so
   * without this the drawer has a card it cannot submit, assign or review.
   */
  dealId: string;
  /** Human-readable masked label, e.g. `AUD-2026-0042`. */
  ref: string;
  /** Client name (masked/normalized display value). */
  client: string;
  /** Policy type of the linked deal, drives the card badge. */
  type: DealType;
  /** Where the deal sits in the review workflow. */
  auditStatus: DealAuditStatus;
  /**
   * Whole percent resolved — the figure at the top of the drawer, and what
   * replaced the checkmarks. An empty checklist reads 100%.
   *
   * Over the **producer's** items only since PAC-106: manager-only items are
   * not on the board and must not hold the bar back.
   */
  completionPct: number;
  /** Producer-actionable items — the completion denominator. */
  itemCount: number;
  /** Producer-actionable items still outstanding. */
  openCount: number;
  /**
   * Nothing left for the producer: the card stays on the board so they can
   * submit it (PAC-106), rather than vanishing before Submit can be clicked.
   */
  readyToSubmit: boolean;
  /** The manager's send-back, until the producer resubmits — the red card. */
  sentBack: DealAuditSentBackView | null;
  /** Age of the **oldest** open item; the board's sort key. */
  oldestDaysOpen: number;
  /** Earliest soft deadline across the open items, ISO, or `null`. */
  dueAt: string | null;
  /** The deal's full checklist, outstanding items first. */
  items: DealAuditItemRow[];
}

/**
 * Paginated envelope returned by `GET /deal-audits`.
 *
 * ⚠ `total` and `totalPages` count **deals**, not audit items (PAC-72). The
 * pagination footer, the header badge and the page-clamp effect all read them
 * and keep working — but the badge's wording had to change with its meaning.
 */
export interface DealAuditListResponse {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  items: DealAuditDealRow[];
}

/** Returned by `POST /deal-audits/:itemId/attachments/presign`. */
export interface PresignAttachmentResponse {
  /** Object storage key to send back on resolve. */
  key: string;
  /** Short-lived URL the browser PUTs the file to. */
  uploadUrl: string;
  /** Headers the browser must set on the PUT. */
  requiredHeaders: Record<string, string>;
  /** Seconds until the upload URL expires. */
  expiresIn: number;
}

/** Returned by `PATCH /deal-audits/:itemId/resolve`. */
export interface ResolveDealAuditResponse {
  id: string;
  resolved: boolean;
  resolvedAt: string;
}

/**
 * One entry on an audit's note/workflow thread.
 *
 * Both free-text notes and system-emitted workflow events, in one list — the
 * point of reusing `activities` is that "Dana submitted this" and "Sam asked
 * for the declarations page" read as one conversation rather than two.
 */
export interface AuditNoteView {
  id: string;
  type: ActivityType;
  summary: string | null;
  occurredAt: string;
  /** Who did it. Empty when the actor is no longer resolvable. */
  userName: string;
}
