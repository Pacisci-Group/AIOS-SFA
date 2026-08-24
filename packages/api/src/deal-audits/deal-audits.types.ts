import type {
  ActivityType,
  AuditOwnerView,
  DealAuditStatus,
} from '@sfa/shared';
import { DealType } from '../deals/schemas/deal.schema';

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

/** A single pending hand-off row for the Producer Dashboard board. */
export interface DealAuditRow {
  /** Raw record id (opaque; UI shows `ref` instead). */
  id: string;
  /**
   * The deal this item belongs to (PAC-72).
   *
   * Every workflow endpoint is keyed on the **deal**, not on the item or the
   * audit — so without this the drawer has a row it cannot submit, assign or
   * review. Empty only for a migrated item that was never linked to a deal.
   */
  dealId: string;
  /** Human-readable masked label, e.g. `AUD-2026-0042`. */
  ref: string;
  /** Client name (masked/normalized display value). */
  client: string;
  /** Policy type of the linked deal, drives the row badge. */
  type: DealType;
  /** The missing/failed requirement (audit item name). */
  missing: string;
  /** Days the item has been open (oldest first). */
  daysOpen: number;
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
}

/** Paginated envelope returned by `GET /deal-audits`. */
export interface DealAuditListResponse {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  items: DealAuditRow[];
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
 * A deal's audit as the workflow endpoints return it (PAC-72 section E).
 *
 * Owners are returned resolved — `{ type, id, name }` — because the stored
 * value is an ObjectId with no indication of *what* it points at. Resolving on
 * read rather than denormalizing the name means renaming a role or a user does
 * not strand every audit they own.
 */
export interface AuditWorkflowView {
  /** The audit record's id. */
  id: string;
  dealId: string;
  auditStatus: DealAuditStatus;
  assignee: AuditOwnerView | null;
  reviewer: AuditOwnerView | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  reasonCodes: string[];
  auditScore: number;
  auditNotes: string | null;
  /** Checklist roll-up — the completion percentage and its inputs. */
  itemCount: number;
  resolvedCount: number;
  openCount: number;
  completionPct: number;
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
