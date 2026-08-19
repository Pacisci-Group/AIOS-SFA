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
