import type {
  DataExportFormat,
  ReclassifyRunResponse,
  ReconciliationAssignedListResponse,
  ReconciliationAssignedRowDetail,
  ReconciliationCancelPolicyInput,
  ReconciliationCancelPolicyResponse,
  ReconciliationOptionsResponse,
  ReconciliationOutcomeFilter,
  ReconciliationPresignResponse,
  ReconciliationResolution,
  ReconciliationReviewStatus,
  ReconciliationRowListResponse,
  ReconciliationRowView,
  ReconciliationRunDetail,
  ReconciliationRunListResponse,
  ReconciliationServiceIntakeInput,
  ReconciliationServiceIntakeOptions,
  ReconciliationServiceIntakeResponse,
  ReconciliationTab,
  RecordReconciliationOutcomeInput,
} from "@sfa/shared";
import { apiFetch, apiFetchBlob } from "./api-client";
import { uploadToPresignedUrl } from "./presigned-upload";

export type {
  BindIdStatus,
  ReconciliationAssignedListResponse,
  ReconciliationAssignedRow,
  ReconciliationAssignedRowDetail,
  ReconciliationAssignee,
  ReconciliationAssignment,
  ReconciliationCancelPolicyInput,
  ReconciliationCancelPolicyResponse,
  ReconciliationIssue,
  ReconciliationOutcome,
  ReconciliationOutcomeFilter,
  ReconciliationPrefill,
  ReconciliationProducerSummary,
  ReconciliationResolution,
  ReconciliationReviewStatus,
  ReconciliationRowView,
  ReconciliationRunDetail,
  ReconciliationRunView,
  ReconciliationServiceIntakeInput,
  ReconciliationServiceIntakeOptions,
  ReconciliationServiceIntakeResponse,
  ReconciliationSuggestion,
  ReconciliationTab,
  ReconciliationTotals,
  RecordReconciliationOutcomeInput,
} from "@sfa/shared";

/** Query-key root: a new run, a review or a re-check invalidates everything under it. */
export const reconciliationKey = ["carrier-reconciliation"] as const;
export const reconciliationRunsKey = [...reconciliationKey, "runs"] as const;
export const reconciliationRunKey = (runId: string) =>
  [...reconciliationKey, "run", runId] as const;
export const reconciliationRowsKey = (runId: string, params: RowsParams) =>
  [...reconciliationKey, "rows", runId, params] as const;
export const reconciliationOptionsKey = [...reconciliationKey, "options"] as const;
/**
 * The caller's own assigned rows — the list and each row opened by id. Nested
 * under {@link reconciliationKey}, so an assignment or a decision on the
 * owner's page refreshes them; a `reconciliation.row_assigned` notification
 * refreshes just these.
 */
export const reconciliationAssignedKey = [...reconciliationKey, "assigned"] as const;
export const reconciliationAssignedListKey = (params: AssignedRowsParams) =>
  [...reconciliationAssignedKey, "list", params] as const;
export const reconciliationAssignedRowKey = (rowId: string) =>
  [...reconciliationAssignedKey, "row", rowId] as const;
export const reconciliationServiceIntakeOptionsKey = (rowId: string) =>
  [...reconciliationAssignedKey, "service-intake-options", rowId] as const;

const BASE = "/carrier-reconciliation";

export function getReconciliationRuns(includeSuperseded = false) {
  return apiFetch<ReconciliationRunListResponse>(
    `${BASE}/runs?pageSize=50&includeSuperseded=${includeSuperseded}`,
  );
}

export function getReconciliationRun(runId: string) {
  return apiFetch<ReconciliationRunDetail>(`${BASE}/runs/${runId}`);
}

export interface RowsParams {
  tab?: ReconciliationTab;
  producer?: string;
  reviewStatus?: ReconciliationReviewStatus;
  /** A user id, `me` or `unassigned`. */
  assignee?: string;
  /** By the assignee's outcome: its status, or its kind. */
  outcome?: ReconciliationOutcomeFilter;
  q?: string;
  page: number;
  pageSize: number;
}

export function getReconciliationRows(runId: string, params: RowsParams) {
  const search = new URLSearchParams();
  if (params.tab) search.set("tab", params.tab);
  if (params.producer) search.set("producer", params.producer);
  if (params.reviewStatus) search.set("reviewStatus", params.reviewStatus);
  if (params.assignee) search.set("assignee", params.assignee);
  if (params.outcome) search.set("outcome", params.outcome);
  if (params.q) search.set("q", params.q);
  search.set("page", String(params.page));
  search.set("pageSize", String(params.pageSize));
  return apiFetch<ReconciliationRowListResponse>(
    `${BASE}/runs/${runId}/rows?${search.toString()}`,
  );
}

/**
 * Upload a Dash report and reconcile it: presign, PUT straight to storage,
 * then hand the key back. The API processes it inside the last request, so
 * the run comes back finished.
 */
export async function uploadDashReport(
  file: File,
): Promise<ReconciliationRunDetail> {
  const presigned = await apiFetch<ReconciliationPresignResponse>(
    `${BASE}/runs/presign`,
    {
      method: "POST",
      body: JSON.stringify({ filename: file.name, size: file.size }),
    },
  );
  await uploadToPresignedUrl(
    presigned.uploadUrl,
    presigned.requiredHeaders,
    file,
  );
  return apiFetch<ReconciliationRunDetail>(`${BASE}/runs`, {
    method: "POST",
    body: JSON.stringify({
      storageKey: presigned.key,
      uploadedFilename: file.name,
      size: file.size,
    }),
  });
}

export interface ReviewBody {
  status: ReconciliationReviewStatus;
  resolution?: ReconciliationResolution | null;
  note?: string | null;
}

export function reviewReconciliationRow(
  runId: string,
  rowId: string,
  body: ReviewBody,
) {
  return apiFetch<ReconciliationRowView>(
    `${BASE}/runs/${runId}/rows/${rowId}/review`,
    { method: "PATCH", body: JSON.stringify(body) },
  );
}

export interface AssignmentBody {
  /** `null` unassigns. The same person again only updates the note. */
  userId: string | null;
  note?: string | null;
}

/**
 * Hand a row that waits on a decision to a Producer or CSR (PAC-173). A new
 * assignee is notified; re-saving the same one only updates the note.
 *
 * A `missing_from_app` row goes only to someone who can book a sale (owner,
 * 28 Oct 2026): anyone else is 400 `RECONCILIATION_ASSIGNEE_CANNOT_SELL`.
 * Handing the row to someone else, or taking it back, stops the outcome its
 * assignee had under way.
 */
export function assignReconciliationRow(
  runId: string,
  rowId: string,
  body: AssignmentBody,
) {
  return apiFetch<ReconciliationRowView>(
    `${BASE}/runs/${runId}/rows/${rowId}/assignment`,
    { method: "PATCH", body: JSON.stringify(body) },
  );
}

export interface AssignedRowsParams {
  page: number;
  pageSize: number;
}

/**
 * The caller's assigned rows that still wait on a decision, oldest assignment
 * first. Open to `leads:read` as well as `carrier_reconciliation:read` — the
 * Producers and CSRs it is for hold no reconciliation permission. A 403 means
 * the module is off for the agency.
 */
export function getAssignedReconciliationRows(params: AssignedRowsParams) {
  const search = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize),
  });
  return apiFetch<ReconciliationAssignedListResponse>(
    `${BASE}/assigned?${search.toString()}`,
  );
}

/**
 * One of the caller's assigned rows by id — even once it has been decided, so
 * an old notification still opens it. 404 once it is someone else's.
 *
 * Carries `prefill` (PAC-173 PR 4): the Dash line as the New Lead and Sold
 * forms want it, so recording a Sold outcome confirms what Dash says rather
 * than retyping it. Both forms read it through this same key.
 */
export function getAssignedReconciliationRow(rowId: string) {
  return apiFetch<ReconciliationAssignedRowDetail>(`${BASE}/assigned/${rowId}`);
}

/**
 * Record what became of an assigned row, as its assignee (PAC-173 PR 4).
 *
 * - `other` takes a note and is done at once: the row is resolved.
 * - `sold`, `cancel_rewrite` and `chargeback` start an outcome that the New
 *   Lead and Sold forms carry on (they carry `reconciliationRowId`); a
 *   chargeback then finishes with {@link cancelReconciliationPolicy}. They
 *   need the caller to
 *   be able to book a sale — `RECONCILIATION_OUTCOME_FORBIDDEN` (403) — and a
 *   row Dash lists that the app is missing — `RECONCILIATION_OUTCOME_NOT_ALLOWED`
 *   (400).
 * - The kind already under way **resumes** it, and first picks up anything
 *   booked since: a sale or replacement whose follow-up failed completes the
 *   outcome here. The web's Continue sends exactly that.
 * - Another kind is accepted only while nothing is booked
 *   (`RECONCILIATION_OUTCOME_LOCKED`, 409). A decided row, or one on a
 *   replaced run, is also 409; a row no longer the caller's is 404.
 */
export function recordReconciliationOutcome(
  rowId: string,
  body: RecordReconciliationOutcomeInput,
) {
  return apiFetch<ReconciliationAssignedRowDetail>(
    `${BASE}/assigned/${rowId}/outcome`,
    { method: "PATCH", body: JSON.stringify(body) },
  );
}

/**
 * A Chargeback outcome's second step, as its assignee (PAC-173 PR 6): cancel
 * the policy its sale booked, with the chargeback dated on the carrier's
 * cancellation date, and finish the row — one transaction. Answers with the
 * finished row and the cancelled policy as the household page lists it.
 *
 * 400 for a date in the future or before the sale, or
 * `RECONCILIATION_OUTCOME_NOT_ALLOWED` (not a chargeback); 403
 * `RECONCILIATION_OUTCOME_FORBIDDEN` without the permission to book a sale;
 * 404 when the row is no longer the caller's; 409 before the sale is booked,
 * `RECONCILIATION_CHARGEBACK_POLICY_UNMATCHED` when no policy on the sale is
 * numbered as the Dash line, for a policy already cancelled without a
 * chargeback, a decided row, a
 * replaced run, or a concurrent change. A row already finished answers as it
 * is.
 */
export function cancelReconciliationPolicy(
  rowId: string,
  body: ReconciliationCancelPolicyInput,
) {
  return apiFetch<ReconciliationCancelPolicyResponse>(
    `${BASE}/assigned/${rowId}/cancel-policy`,
    { method: "POST", body: JSON.stringify(body) },
  );
}

/**
 * The CSRs a 1-800 service intake's welcome call can go to (PAC-173 PR 5) —
 * the ticket picker's pool, served on the row because a Producer cannot ask
 * the ticket endpoints. 400 on a row that offers no service intake.
 */
export function getServiceIntakeOptions(rowId: string) {
  return apiFetch<ReconciliationServiceIntakeOptions>(
    `${BASE}/assigned/${rowId}/service-intake/options`,
  );
}

/**
 * Set a 1-800 row up for service, as its assignee (PAC-173 PR 5): the
 * household, a `carrier_direct` policy with its signed application (uploaded
 * through `uploadSoldDocument` with the `reconciliation` scope), and the CSR's
 * welcome call. Answers with what it created and the row; `ticketId: null`
 * means the household and policy are saved but the welcome call did not open,
 * and the row's Continue opens it.
 */
export function submitServiceIntake(
  rowId: string,
  body: ReconciliationServiceIntakeInput,
) {
  return apiFetch<ReconciliationServiceIntakeResponse>(
    `${BASE}/assigned/${rowId}/service-intake`,
    { method: "POST", body: JSON.stringify(body) },
  );
}

/**
 * Re-apply the users' current Allstate codes to a stored run (PAC-173) —
 * after someone's Bind ID is set on the Users page, so
 * their rows leave the 1-800 tab without re-uploading the file.
 */
export function reclassifyRun(runId: string) {
  return apiFetch<ReclassifyRunResponse>(`${BASE}/runs/${runId}/reclassify`, {
    method: "POST",
  });
}

/** Fetches the export with the session's token and saves it. */
export async function downloadReconciliationExport(
  runId: string,
  format: DataExportFormat,
  tab: ReconciliationTab | undefined,
  filename: string,
): Promise<void> {
  const search = new URLSearchParams({ format });
  if (tab) search.set("tab", tab);
  const blob = await apiFetchBlob(
    `${BASE}/runs/${runId}/export?${search.toString()}`,
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked on the next tick: Safari cancels a download whose URL is revoked
  // in the same task as the click.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Who a row can be assigned to: the agency's active Producers and CSRs, each
 * marked `canRecordSale` — only they can take a `missing_from_app` row.
 */
export function getReconciliationOptions() {
  return apiFetch<ReconciliationOptionsResponse>(`${BASE}/options`);
}
