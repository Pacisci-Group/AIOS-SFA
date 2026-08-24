import { apiFetch } from '@/lib/api-client';

export type DealAuditType = 'Auto' | 'Home' | 'Bundle' | 'Other';

/** A document already on the item (mirrors the API `DealAuditRowAttachment`). */
export interface DealAuditRowAttachment {
  /** Position in the item's `attachments` array — what the download route takes. */
  index: number;
  filename: string;
  contentType: string;
  size: number;
}

/** The four audit workflow states (mirrors `DEAL_AUDIT_STATUSES`). */
export type DealAuditStatus = 'Not Submitted' | 'Pending' | 'Pass' | 'Fail';

/** One requirement on a deal's checklist (mirrors the API `DealAuditItemRow`). */
export interface DealAuditItemRow {
  id: string;
  missing: string;
  daysOpen: number;
  /**
   * Still outstanding. Drives the colour coding and the ordering — the server
   * already sorts open items first, so the drawer renders `items` as given.
   *
   * ⚠ A settled item gets **no checkmark**: David rejected them explicitly and
   * the deal's completion percentage replaces them.
   */
  open: boolean;
  /** Soft deadline, ISO. `null` for items generated before the field existed. */
  dueAt: string | null;
  /** Empty means "no document on file" — the auditor has to call the client. */
  attachments: DealAuditRowAttachment[];
}

/** One deal card on the board (mirrors the API `DealAuditDealRow`). */
export interface DealAuditDealRow {
  /** The audit record's id. */
  id: string;
  /**
   * The deal this audit belongs to. Every audit workflow endpoint
   * (assign / submit / review / notes) is keyed on the deal, not the audit.
   */
  dealId: string;
  /** Human-readable masked label, e.g. `AUD-2026-0042`. */
  ref: string;
  client: string;
  type: DealAuditType;
  auditStatus: DealAuditStatus;
  /** Whole percent resolved. An empty checklist reads 100. */
  completionPct: number;
  itemCount: number;
  openCount: number;
  /** Age of the oldest outstanding requirement; the board's sort key. */
  oldestDaysOpen: number;
  /** Earliest soft deadline across the open items, ISO, or `null`. */
  dueAt: string | null;
  /** The full checklist, outstanding first. */
  items: DealAuditItemRow[];
}

/** The soft-deadline filter. `all` is the default and adds no clause. */
export type DealAuditDueFilter = 'all' | 'overdue' | 'due_soon';

export interface DealAuditListResponse {
  page: number;
  pageSize: number;
  /** ⚠ Counts **deals**, not requirements — the badge copy follows from this. */
  total: number;
  totalPages: number;
  items: DealAuditDealRow[];
}

export interface ListDealAuditsParams {
  page?: number;
  pageSize?: number;
  due?: DealAuditDueFilter;
}

export function listDealAudits(params: ListDealAuditsParams = {}) {
  const search = new URLSearchParams();
  if (params.page != null) search.set('page', String(params.page));
  if (params.pageSize != null) search.set('pageSize', String(params.pageSize));
  if (params.due != null && params.due !== 'all') search.set('due', params.due);
  const qs = search.toString();
  return apiFetch<DealAuditListResponse>(
    `/deal-audits${qs ? `?${qs}` : ''}`,
  );
}

/**
 * A short-lived URL for a document already on the item (PAC-65 #16).
 *
 * Fetched on click rather than served with the row: presigned URLs expire, and
 * a board that sat open for ten minutes would hand out dead links.
 */
export function getAuditAttachmentUrl(itemId: string, index: number) {
  return apiFetch<{ downloadUrl: string }>(
    `/deal-audits/${itemId}/attachments/${index}/download`,
  );
}

// --- Resolve (PAC-14) ------------------------------------------------------

/** Content types accepted for resolution document uploads. */
export const ALLOWED_UPLOAD_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
] as const;

/** Max upload size (10 MB), matching the API + UI copy. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export interface DealAuditAttachment {
  key: string;
  filename: string;
  contentType: string;
  size: number;
}

interface PresignResponse {
  key: string;
  uploadUrl: string;
  requiredHeaders: Record<string, string>;
  expiresIn: number;
}

export interface ResolveDealAuditResponse {
  id: string;
  resolved: boolean;
  resolvedAt: string;
}

/** Request a presigned URL to upload a resolution document. */
export function presignAuditAttachment(
  itemId: string,
  meta: { filename: string; contentType: string; size: number },
) {
  return apiFetch<PresignResponse>(
    `/deal-audits/${itemId}/attachments/presign`,
    {
      method: 'POST',
      body: JSON.stringify(meta),
    },
  );
}

/** Upload the raw file bytes directly to object storage (no auth header). */
export async function uploadToPresignedUrl(
  uploadUrl: string,
  headers: Record<string, string>,
  file: File,
) {
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers,
    body: file,
  });
  if (!res.ok) {
    throw new Error(`Upload failed (${res.status})`);
  }
}

/** Mark an audit item resolved, optionally with a note and/or document. */
export function resolveDealAuditItem(
  itemId: string,
  payload: { note?: string; attachment?: DealAuditAttachment },
) {
  return apiFetch<ResolveDealAuditResponse>(
    `/deal-audits/${itemId}/resolve`,
    {
      method: 'PATCH',
      body: JSON.stringify(payload),
    },
  );
}

/**
 * Full resolve flow: presign + upload (if a file is provided) then resolve.
 * Returns the resolve response.
 */
export async function resolveWithOptionalUpload(
  itemId: string,
  input: { note?: string; file?: File | null },
): Promise<ResolveDealAuditResponse> {
  let attachment: DealAuditAttachment | undefined;
  if (input.file) {
    const meta = {
      filename: input.file.name,
      contentType: input.file.type,
      size: input.file.size,
    };
    const presigned = await presignAuditAttachment(itemId, meta);
    await uploadToPresignedUrl(
      presigned.uploadUrl,
      presigned.requiredHeaders,
      input.file,
    );
    attachment = { key: presigned.key, ...meta };
  }
  return resolveDealAuditItem(itemId, {
    note: input.note?.trim() ? input.note.trim() : undefined,
    attachment,
  });
}
