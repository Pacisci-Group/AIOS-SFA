/**
 * The Data Export page (PAC-152) — the wire contract between `/data-export/*`
 * and the web page.
 *
 * An export is **requested, not downloaded**: `POST /data-export/:dataset/exports`
 * queues it, a worker job writes the file to object storage, the requester is
 * emailed when it is ready, and the file is fetched later from the page's
 * history through a short-lived link (`GET /data-export/exports/:id/url`).
 *
 * A dataset is a **curated, report-ready table**: one row per entity, with
 * lookups already resolved (producer name, household ref, lead source…) and
 * child rollups already computed (policy numbers on a deal, members of a
 * household…). Every label travels beside the id it was resolved from, so a
 * file still joins against another in Alteryx.
 *
 * The column list is served by the API (`GET /data-export/datasets`) rather
 * than declared here: it is the data dictionary, and the server is the only
 * place that knows what each column is computed from.
 */

/** Every dataset a caller can download, in display order. */
export const DATA_EXPORT_DATASET_KEYS = [
  'leads',
  'quote_recaps',
  'sold_deals',
  'policies',
  'households',
  'contacts',
] as const;
export type DataExportDatasetKey = (typeof DATA_EXPORT_DATASET_KEYS)[number];

export const DATA_EXPORT_FORMATS = ['csv', 'xlsx'] as const;
export type DataExportFormat = (typeof DATA_EXPORT_FORMATS)[number];

/**
 * How a column is encoded. The writer decides the cell from this, so CSV and
 * XLSX can never disagree about a value:
 *
 * - `id`       — text in both, so a policy number keeps its leading zeros in Excel.
 * - `date`     — a calendar date: `YYYY-MM-DD` in CSV, a date cell in XLSX.
 * - `datetime` — an instant: ISO-8601 UTC in CSV, a date-time cell (UTC) in XLSX.
 * - `list`     — several values joined with `'; '`.
 */
export type DataExportColumnType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'id'
  | 'list';

/**
 * Which clamp a dataset reads under. `producer` collections carry an owner and
 * honour `own` scope; `client` records (households, contacts, policies) carry
 * none, so `own` collapses to the caller's branch — the same rule the Clients
 * pages already apply.
 */
export type DataExportScope = 'producer' | 'client';

export type DataExportFilterKey =
  | 'branchId'
  | 'producerIds'
  | 'status'
  | 'policyTypes'
  | 'leadSourceIds';

export interface DataExportColumnDescriptor {
  /** snake_case header, stable across releases — Alteryx flows bind to it. */
  key: string;
  type: DataExportColumnType;
  description: string;
}

export interface DataExportDateFieldDescriptor {
  key: string;
  label: string;
  isDefault: boolean;
}

export interface DataExportDatasetDescriptor {
  key: DataExportDatasetKey;
  label: string;
  description: string;
  scope: DataExportScope;
  /** The date fields `from`/`to` may apply to; exactly one is the default. */
  dateFields: DataExportDateFieldDescriptor[];
  /** The filters this dataset honours. Sending any other is a 400. */
  filters: DataExportFilterKey[];
  /** The values the `status` filter accepts, when `filters` lists it. */
  statusValues?: string[];
  columns: DataExportColumnDescriptor[];
}

/** `GET /data-export/datasets` — the data dictionary. */
export interface DataExportDictionaryResponse {
  datasets: DataExportDatasetDescriptor[];
  formats: DataExportFormat[];
  /** Larger exports are refused with {@link DATA_EXPORT_TOO_LARGE}. */
  maxRows: number;
}

export interface DataExportOption {
  id: string;
  name: string;
}

/**
 * `GET /data-export/options` — what the caller may filter by. Served behind
 * `data_export:read` alone: the Data Team holds neither `agency:users:read`
 * nor `agency:branches:read`, and every name listed here already appears in
 * the exported `*_name` columns.
 */
export interface DataExportOptionsResponse {
  branches: DataExportOption[];
  producers: DataExportOption[];
}

/**
 * Where an export is in its life:
 *
 * - `queued`     — accepted; the worker has not picked it up yet.
 * - `processing` — the worker is writing the file.
 * - `ready`      — stored and downloadable until `expiresAt`.
 * - `failed`     — refused over the row cap (`error: EXPORT_TOO_LARGE`) or the
 *                  job failed; nothing is stored.
 * - `expired`    — the retention period passed and the file was deleted. The
 *                  row stays: it is the audit trail.
 */
export type DataExportStatus =
  | 'queued'
  | 'processing'
  | 'ready'
  | 'failed'
  | 'expired';

export const DATA_EXPORT_STATUSES: readonly DataExportStatus[] = [
  'queued',
  'processing',
  'ready',
  'failed',
  'expired',
];

/** Still being worked on — the page polls while any row is in one of these. */
export const DATA_EXPORT_PENDING_STATUSES: readonly DataExportStatus[] = [
  'queued',
  'processing',
];

/** The `code` on the 400 an over-cap export is refused with. */
export const DATA_EXPORT_TOO_LARGE = 'EXPORT_TOO_LARGE';

/** The body of that 400. */
export interface DataExportTooLargeError {
  code: typeof DATA_EXPORT_TOO_LARGE;
  message: string;
  rowCount: number;
  maxRows: number;
}

/** The filters an export ran with, as recorded on its history row. */
export interface DataExportFilterEcho {
  dateField: string;
  from: string | null;
  to: string | null;
  branchId: string | null;
  producerIds: string[];
  status: string[];
  policyTypes: string[];
  leadSourceIds: string[];
}

/**
 * `POST /data-export/:dataset/exports` — what to export. Every field but
 * `format` is optional; a filter the dataset does not honour is a 400.
 */
export interface DataExportRequestBody {
  format?: DataExportFormat;
  /** Inclusive `YYYY-MM-DD`, cut on the agency's timezone; omitted = open. */
  from?: string;
  to?: string;
  /** One of the dataset's date fields; its default when omitted. */
  dateField?: string;
  /** Narrows an agency-scope caller to one branch; ignored otherwise. */
  branchId?: string;
  producerIds?: string[];
  status?: string[];
  policyTypes?: string[];
  leadSourceIds?: string[];
}

export interface DataExportHistoryRow {
  id: string;
  datasetKey: string;
  datasetLabel: string;
  format: DataExportFormat;
  filters: DataExportFilterEcho;
  /** Rows in the file — or, for an over-cap refusal, rows it would have held. */
  rowCount: number;
  bytes: number;
  durationMs: number;
  status: DataExportStatus;
  /** Rows arrived between the request and the run; the file stops at the cap. */
  truncated: boolean;
  error: string | null;
  filename: string;
  /** When the export was requested. */
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** When the stored file is deleted. `null` until it is ready. */
  expiresAt: string | null;
  /** `ready` and not yet past `expiresAt` — the Download button shows. */
  canDownload: boolean;
  downloadCount: number;
  /** When the "your export is ready" email went out; `null` if it has not. */
  notifiedAt: string | null;
  createdById: string | null;
  createdByName: string | null;
}

/** `POST /data-export/:dataset/exports` — 202, the queued row. */
export interface DataExportRequestResponse {
  export: DataExportHistoryRow;
}

/**
 * `GET /data-export/exports/:id/url` — a presigned download link, minted on
 * click and valid for `expiresIn` seconds. Never stored.
 */
export interface DataExportFileUrlResponse {
  url: string;
  filename: string;
  expiresIn: number;
}

/** `GET /data-export/history` — the download audit trail, newest first. */
export interface DataExportHistoryResponse {
  items: DataExportHistoryRow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
