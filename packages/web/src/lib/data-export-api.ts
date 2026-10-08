import type {
  DataExportDatasetKey,
  DataExportDictionaryResponse,
  DataExportFileUrlResponse,
  DataExportFormat,
  DataExportHistoryResponse,
  DataExportHistoryRow,
  DataExportOptionsResponse,
  DataExportRequestBody,
  DataExportRequestResponse,
} from "@sfa/shared";
import { apiFetch } from "./api-client";

export type {
  DataExportColumnDescriptor,
  DataExportDatasetDescriptor,
  DataExportDatasetKey,
  DataExportDictionaryResponse,
  DataExportFilterKey,
  DataExportFormat,
  DataExportHistoryResponse,
  DataExportHistoryRow,
  DataExportOptionsResponse,
  DataExportStatus,
  DataExportTooLargeError,
} from "@sfa/shared";

/** Query-key root. A new request invalidates the history under it. */
export const dataExportKey = ["data-export"] as const;
export const dataExportHistoryKey = [...dataExportKey, "history"] as const;

/** `GET /data-export/datasets` — the data dictionary. */
export function getDataExportDictionary() {
  return apiFetch<DataExportDictionaryResponse>("/data-export/datasets");
}

/** `GET /data-export/options` — the branches and producers the caller may pick. */
export function getDataExportOptions() {
  return apiFetch<DataExportOptionsResponse>("/data-export/options");
}

/** `GET /data-export/history` — the export log, newest first. */
export function getDataExportHistory(page: number, pageSize: number) {
  return apiFetch<DataExportHistoryResponse>(
    `/data-export/history?page=${page}&pageSize=${pageSize}`,
  );
}

export interface DataExportParams {
  dataset: DataExportDatasetKey;
  format: DataExportFormat;
  /** Inclusive `YYYY-MM-DD`; omitted means open-ended. */
  from?: string;
  to?: string;
  /** One of the dataset's date fields; the server's default when omitted. */
  dateField?: string;
  /** Honoured for agency-scope callers only. */
  branchId?: string;
  producerIds: readonly string[];
  status: readonly string[];
  policyTypes: readonly string[];
  leadSourceIds: readonly string[];
}

/**
 * The request body, sending only what is set: the API refuses a filter the
 * dataset cannot apply, so an empty one must not be sent as `status: []`.
 */
export function dataExportBody(params: DataExportParams): DataExportRequestBody {
  const body: DataExportRequestBody = { format: params.format };
  if (params.from) body.from = params.from;
  if (params.to) body.to = params.to;
  if (params.dateField) body.dateField = params.dateField;
  if (params.branchId) body.branchId = params.branchId;
  if (params.producerIds.length) body.producerIds = [...params.producerIds];
  if (params.status.length) body.status = [...params.status];
  if (params.policyTypes.length) body.policyTypes = [...params.policyTypes];
  if (params.leadSourceIds.length) body.leadSourceIds = [...params.leadSourceIds];
  return body;
}

/**
 * `POST /data-export/:dataset/exports` — queue an export. Resolves with the
 * `queued` history row; a worker produces the file and the requester is
 * emailed when it is ready.
 */
export async function requestDataExport(
  params: DataExportParams,
): Promise<DataExportHistoryRow> {
  const { export: row } = await apiFetch<DataExportRequestResponse>(
    `/data-export/${params.dataset}/exports`,
    { method: "POST", body: JSON.stringify(dataExportBody(params)) },
  );
  return row;
}

/**
 * `GET /data-export/exports/:id/url` — a short-lived link to a finished
 * export's file, minted on click and never kept.
 */
export function getDataExportFileUrl(id: string) {
  return apiFetch<DataExportFileUrlResponse>(
    `/data-export/exports/${encodeURIComponent(id)}/url`,
  );
}

/**
 * Start the browser's download of a presigned link.
 *
 * The link is signed with `Content-Disposition: attachment`, so following it
 * saves the file without leaving the page — no new tab to leave blank, which
 * is what `openDocumentInNewTab` would do for a file that is not viewable.
 */
export function startDownload(url: string): void {
  const link = document.createElement("a");
  link.href = url;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
}
