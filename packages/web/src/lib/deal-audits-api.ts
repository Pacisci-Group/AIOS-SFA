import { apiFetch } from '@/lib/api-client';

export type DealAuditType = 'Auto' | 'Home' | 'Bundle' | 'Other';

/** One pending hand-off row (mirrors the API `DealAuditRow`). */
export interface DealAuditRow {
  id: string;
  /** Human-readable masked label, e.g. `AUD-2026-0042`. */
  ref: string;
  client: string;
  type: DealAuditType;
  missing: string;
  daysOpen: number;
}

export interface DealAuditListResponse {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  items: DealAuditRow[];
}

export interface ListDealAuditsParams {
  page?: number;
  pageSize?: number;
}

export function listDealAudits(params: ListDealAuditsParams = {}) {
  const search = new URLSearchParams();
  if (params.page != null) search.set('page', String(params.page));
  if (params.pageSize != null) search.set('pageSize', String(params.pageSize));
  const qs = search.toString();
  return apiFetch<DealAuditListResponse>(
    `/deal-audits${qs ? `?${qs}` : ''}`,
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
