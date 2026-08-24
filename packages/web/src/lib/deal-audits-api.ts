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

// --- Workflow: assign → submit → review (PAC-72 section E) -----------------

/** A user or a role, with its display name resolved server-side. */
export interface AuditOwnerView {
  type: 'user' | 'role';
  id: string;
  name: string;
}

/** What a reviewer can do with a submitted audit. */
export type AuditReviewDecision =
  | 'approve'
  | 'request_changes'
  | 'send_back';

/** The failure vocabulary — SmartSuite's own `reason_codes` select. */
export const DEAL_AUDIT_REASON_CODES = [
  'Missing Docs',
  'Coverage Not Offered',
  'Incorrect Named Insured',
  'Incorrect Address',
  'Underwriting Issue',
  'Other',
] as const;

export type DealAuditReasonCode = (typeof DEAL_AUDIT_REASON_CODES)[number];

/** A deal's audit workflow state (mirrors the API `AuditWorkflowView`). */
export interface AuditWorkflowView {
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
  itemCount: number;
  resolvedCount: number;
  openCount: number;
  completionPct: number;
  /**
   * Decided by the server, not re-derived here.
   *
   * `canReview` in particular depends on **who submitted** — the submitter may
   * not review their own audit — and the client is deliberately not told who
   * that was. Gating the buttons on these keeps the UI from offering an action
   * the API would reject.
   */
  canSubmit: boolean;
  canReview: boolean;
}

/** One entry on the audit's note + workflow thread. */
export interface AuditNoteView {
  id: string;
  type: string;
  summary: string | null;
  occurredAt: string;
  userName: string;
}

export function getAuditWorkflow(dealId: string) {
  return apiFetch<AuditWorkflowView>(`/deal-audits/deals/${dealId}`);
}

export interface AuditOwnerInput {
  type: 'user' | 'role';
  id: string;
}

/**
 * Set the assignee and/or reviewer. Omitting a key leaves that slot untouched;
 * `null` clears it — an audit whose reviewer left the agency has to be
 * un-assignable, not merely re-assignable.
 */
export function assignAudit(
  dealId: string,
  payload: {
    assignee?: AuditOwnerInput | null;
    reviewer?: AuditOwnerInput | null;
  },
) {
  return apiFetch<AuditWorkflowView>(
    `/deal-audits/deals/${dealId}/assignment`,
    { method: 'PATCH', body: JSON.stringify(payload) },
  );
}

/** Hand the audit to its reviewer. */
export function submitAudit(dealId: string) {
  return apiFetch<AuditWorkflowView>(`/deal-audits/deals/${dealId}/submit`, {
    method: 'POST',
  });
}

/** Approve, request changes, or send back. */
export function reviewAudit(
  dealId: string,
  payload: {
    decision: AuditReviewDecision;
    reasonCodes?: DealAuditReasonCode[];
    notes?: string;
  },
) {
  return apiFetch<AuditWorkflowView>(`/deal-audits/deals/${dealId}/review`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** The audit's note + workflow thread, newest first. */
export function listAuditNotes(dealId: string) {
  return apiFetch<AuditNoteView[]>(`/deal-audits/deals/${dealId}/notes`);
}

export function addAuditNote(dealId: string, body: string) {
  return apiFetch<AuditNoteView>(`/deal-audits/deals/${dealId}/notes`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });
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
