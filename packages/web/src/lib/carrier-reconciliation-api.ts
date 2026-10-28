import type {
  DataExportFormat,
  ReclassifyRunResponse,
  ReconciliationOptionsResponse,
  ReconciliationPresignResponse,
  ReconciliationResolution,
  ReconciliationReviewStatus,
  ReconciliationRowListResponse,
  ReconciliationRowView,
  ReconciliationRunDetail,
  ReconciliationRunListResponse,
  ReconciliationTab,
} from "@sfa/shared";
import { apiFetch, apiFetchBlob } from "./api-client";
import { uploadToPresignedUrl } from "./presigned-upload";

export type {
  BindIdStatus,
  ReconciliationIssue,
  ReconciliationProducerSummary,
  ReconciliationResolution,
  ReconciliationReviewStatus,
  ReconciliationRowView,
  ReconciliationRunDetail,
  ReconciliationRunView,
  ReconciliationSuggestion,
  ReconciliationTab,
  ReconciliationTotals,
} from "@sfa/shared";

/** Query-key root: a new run, a review or a re-check invalidates everything under it. */
export const reconciliationKey = ["carrier-reconciliation"] as const;
export const reconciliationRunsKey = [...reconciliationKey, "runs"] as const;
export const reconciliationRunKey = (runId: string) =>
  [...reconciliationKey, "run", runId] as const;
export const reconciliationRowsKey = (runId: string, params: RowsParams) =>
  [...reconciliationKey, "rows", runId, params] as const;

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
  q?: string;
  page: number;
  pageSize: number;
}

export function getReconciliationRows(runId: string, params: RowsParams) {
  const search = new URLSearchParams();
  if (params.tab) search.set("tab", params.tab);
  if (params.producer) search.set("producer", params.producer);
  if (params.reviewStatus) search.set("reviewStatus", params.reviewStatus);
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

/**
 * Re-apply the users' current Allstate codes to a stored run (PAC-173) —
 * after someone's Bind ID or sub-producer code is set on the Users page, so
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

/** The agency's users, for the row assignee picker (PAC-173 v2). No caller yet. */
export function getReconciliationOptions() {
  return apiFetch<ReconciliationOptionsResponse>(`${BASE}/options`);
}
