import { DealType } from '../deals/schemas/deal.schema';

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
