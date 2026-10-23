import type {
  AuditItemReviewView,
  AuditItemVerdict,
  AuditReviewDecision,
  AuditWorkflowView,
  DealAuditQueueOptionsResponse,
  DealAuditQueueRangeKey,
  DealAuditQueueResponse,
  DealAuditQueueSort,
  DealAuditQueueStatus,
  DealAuditReasonCode,
  DealAuditReviewView,
  DealAuditSentBackView,
  DealAuditStatus,
  DocumentDownloadResponse,
  SetAuditItemVerdictResponse,
} from '@sfa/shared';
import { apiFetch } from '@/lib/api-client';

// The workflow and review contracts live in `@sfa/shared` (PAC-106); they are
// re-exported so components import them from the client module, as elsewhere.
export { DEAL_AUDIT_REASON_CODES } from '@sfa/shared';
export type {
  AuditItemRef,
  AuditItemReviewView,
  AuditItemVerdict,
  AuditOwnerView,
  AuditReviewCounts,
  AuditReviewDecision,
  AuditWorkflowView,
  DealAuditQueueOptionsResponse,
  DealAuditQueueRangeKey,
  DealAuditQueueResponse,
  DealAuditQueueRow,
  DealAuditQueueSort,
  DealAuditQueueStatus,
  DealAuditReasonCode,
  DealAuditReviewItem,
  DealAuditReviewLead,
  DealAuditReviewPolicy,
  DealAuditReviewQuoteRecap,
  DealAuditReviewView,
  DealAuditSentBackView,
  DealAuditStatus,
  SetAuditItemVerdictResponse,
} from '@sfa/shared';

export type DealAuditType = 'Auto' | 'Home' | 'Bundle' | 'Other';

/** A document already on the item (mirrors the API `DealAuditRowAttachment`). */
export interface DealAuditRowAttachment {
  /** Position in the item's `attachments` array — what the download route takes. */
  index: number;
  filename: string;
  contentType: string;
  size: number;
}

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
  /** The producer cannot resolve it without a document (PAC-106). */
  requiresUpload: boolean;
  /**
   * A manager-only item, on the board only because the manager failed it —
   * fixed through the sale (Fix it), not by uploading here.
   */
  managerOnly: boolean;
  /** The manager's ruling; a `fail` carries the note the producer acts on. */
  review: AuditItemReviewView;
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
  /**
   * Whole percent resolved, over the **producer's** items only (PAC-106) —
   * the manager-only ones are the manager's to verify, not theirs to chase.
   */
  completionPct: number;
  itemCount: number;
  openCount: number;
  /**
   * Nothing left open: the card stays on the board until the producer
   * submits, rather than vanishing before they can (PAC-106).
   */
  readyToSubmit: boolean;
  /** The manager's send-back marker while the audit is `Fail`, else `null`. */
  sentBack: DealAuditSentBackView | null;
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
  /**
   * One deal's card only — the `audit.sent_back` notification's deep link
   * (PAC-106). Empty when the deal is not waiting on the caller.
   */
  dealId?: string;
}

export function listDealAudits(params: ListDealAuditsParams = {}) {
  const search = new URLSearchParams();
  if (params.page != null) search.set('page', String(params.page));
  if (params.pageSize != null) search.set('pageSize', String(params.pageSize));
  if (params.due != null && params.due !== 'all') search.set('due', params.due);
  if (params.dealId) search.set('dealId', params.dealId);
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

/**
 * The reviewer's decision — `POST /deal-audits/deals/:dealId/review`.
 *
 * The Deal Audit page's **Send back** is `request_changes`, and since PAC-106
 * it needs a note (the producer's red card and the notification say it) and at
 * least one failed item; **Approve** needs every item passed. Both refusals
 * come back as a 409 whose body carries a `code`.
 */
export type ReviewAuditPayload =
  | {
      decision: 'request_changes';
      notes: string;
      reasonCodes?: DealAuditReasonCode[];
    }
  | {
      decision: Exclude<AuditReviewDecision, 'request_changes'>;
      notes?: string;
    };

export function reviewAudit(dealId: string, payload: ReviewAuditPayload) {
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

// --- The manager's review (PAC-106) ----------------------------------------

/**
 * Query-key roots for the Deal Audits pages. Both sit under `['deal-audits']`,
 * so the producer board's invalidation (and every mutation here) refreshes
 * the queue and the page with it.
 */
export const dealAuditQueueKey = (params: ListDealAuditQueueParams) =>
  ['deal-audits', 'queue', params] as const;

/**
 * The producer filter's roster. Its own root, outside `['deal-audits']`, so an
 * audit mutation — which invalidates that whole tree — does not refetch it.
 */
export const dealAuditQueueOptionsKey = ['deal-audit-queue-options'] as const;

export const dealAuditReviewKey = (dealId: string) =>
  ['deal-audits', 'review', dealId] as const;

/**
 * What the queue is asked for. Arrays arrive in `MultiSelect`'s option order,
 * so the object is safe inside a query key — the `DashboardFilterParams` rule.
 */
export interface ListDealAuditQueueParams {
  status: DealAuditQueueStatus;
  /** Already debounced and trimmed; absent for no search. */
  q?: string;
  producerIds: readonly string[];
  policyTypes: readonly string[];
  aging: boolean;
  range: DealAuditQueueRangeKey;
  /** `YYYY-MM-DD`, inclusive; sent only with `range: 'custom'`. */
  from?: string;
  to?: string;
  sort: DealAuditQueueSort;
  page: number;
  pageSize: number;
}

/**
 * `GET /deal-audits/queue` — the manager's Deal Audits queue.
 *
 * Serialised the way `dashboardFilterSearch` does it (comma-joined lists,
 * dates only with `custom`) but not through it: that one is typed on the
 * dashboards' filter and always sends a period, where the queue's default —
 * all time — is no period at all.
 */
export function listDealAuditQueue(params: ListDealAuditQueueParams) {
  const search = new URLSearchParams({
    status: params.status,
    sort: params.sort,
    page: String(params.page),
    pageSize: String(params.pageSize),
  });
  if (params.q) search.set('q', params.q);
  if (params.producerIds.length) {
    search.set('producerIds', params.producerIds.join(','));
  }
  if (params.policyTypes.length) {
    search.set('policyTypes', params.policyTypes.join(','));
  }
  if (params.aging) search.set('aging', 'true');
  if (params.range !== 'all') {
    search.set('range', params.range);
    if (params.range === 'custom' && params.from && params.to) {
      search.set('from', params.from);
      search.set('to', params.to);
    }
  }
  return apiFetch<DealAuditQueueResponse>(`/deal-audits/queue?${search}`);
}

/** `GET /deal-audits/queue/options` — the sellers the producer filter offers. */
export function getDealAuditQueueOptions() {
  return apiFetch<DealAuditQueueOptionsResponse>('/deal-audits/queue/options');
}

/** `GET /deal-audits/deals/:dealId/review` — everything the Deal Audit page shows. */
export function getDealAuditReview(dealId: string) {
  return apiFetch<DealAuditReviewView>(
    `/deal-audits/deals/${encodeURIComponent(dealId)}/review`,
  );
}

/**
 * `PATCH /deal-audits/:itemId/verdict` — Pass / Fail and the note on one item.
 *
 * Omit `verdict` to save a note alone; `null` withdraws a ruling; an empty
 * `note` clears it.
 */
export function setAuditItemVerdict(
  itemId: string,
  payload: { verdict?: AuditItemVerdict | null; note?: string },
) {
  return apiFetch<SetAuditItemVerdictResponse>(
    `/deal-audits/${encodeURIComponent(itemId)}/verdict`,
    { method: 'PATCH', body: JSON.stringify(payload) },
  );
}

/**
 * The sale's quote document, inline-signed. Reached through the audit because
 * the manager holds no `quote_recaps:read`; pair with `openDocumentInNewTab`.
 */
export function getQuoteRecapDocumentUrl(dealId: string) {
  return apiFetch<DocumentDownloadResponse>(
    `/deal-audits/deals/${encodeURIComponent(dealId)}/quote-recap/document/download`,
  );
}

/** The 409 `code`s the review endpoints refuse with. */
export const AUDIT_ITEMS_NOT_PASSED = 'audit_items_not_passed';
export const AUDIT_NOTHING_FAILED = 'audit_nothing_failed';

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
