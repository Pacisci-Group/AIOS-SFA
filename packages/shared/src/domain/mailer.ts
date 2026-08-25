/**
 * Mailer prospect records and the import runs that create them (PAC-73).
 *
 * A **mailer** is one row of a direct-mail campaign file: a household that was
 * mailed a pre-filled insurance quote, keyed by the Quote Control Number
 * printed on the mail piece. A producer looks one up by that number and logs it
 * as a lead (PAC-61).
 *
 * ## Two sources, one shape
 *
 * Mailers reach Mongo two ways — an operator uploading an agency's RTP final
 * file through the Super Admin panel, and a one-off BigQuery backfill of the
 * legacy history. Both funnel through the same mapper and the same upsert, and
 * the field set below is a **superset**: BigQuery carries campaign columns the
 * RTP file does not (`week_number`, `mail_drop_date`, `start_mon`/`end_sun`,
 * `campaign_status`), so those are optional and simply absent on an uploaded
 * mailer. Never make one source's extra field required — two independently
 * written mappers over near-identical data is how the sources drift into
 * producing different documents for the same mailer.
 */

/**
 * Where a mailer document came from.
 *
 * Deliberately source-agnostic and deliberately **closed at two members**: the
 * demo seed writes `'spreadsheet'` with `recordSource: 'demo:seed'` rather than
 * widening this union, mirroring how `ProducerGoal` marks its demo rows.
 */
export type MailerSourceSystem = 'bigquery' | 'spreadsheet';

/**
 * Lifecycle of one import run.
 *
 * `previewing` → `previewed` → `importing` → `completed`, with `failed`
 * reachable from either working state. The operator sees the parse result at
 * `previewed` and nothing has been written yet; `commit` is what moves it on.
 */
export type MailerImportRunStatus =
  | 'previewing'
  | 'previewed'
  | 'importing'
  | 'completed'
  | 'failed';

/**
 * What the file says about itself, read during the preview parse.
 *
 * Every one of these columns holds exactly one distinct value across all 20,405
 * rows of the reference file — which is what makes "one file = one campaign,
 * one agency, one product" a safe model and agency selection a per-upload
 * choice rather than a per-row attribution.
 */
export interface MailerImportDetected {
  /** The file's `agencyid` column, e.g. `A0B9049`. Cross-checked, never trusted. */
  agencyId: string | null;
  /** The file's `agencyname` column, e.g. `SMITH FAMILY AGENCY`. */
  agencyName: string | null;
  /** `Campaign Number`, always of the form `Week_Number-29`. */
  campaignNumber: string | null;
  /** Derived from {@link campaignNumber}; not a separate column in the file. */
  weekNumber: number | null;
  /** The pipeline's own `FileName`, e.g. `SFA-20P`. Not the uploaded filename. */
  fileName: string | null;
  /** `quotedate`, converted from its Excel serial. ISO date string. */
  quoteDate: string | null;
  /** `type`, e.g. `Home`. */
  policyType: string | null;
  /** `product`, e.g. `FQ`. */
  product: string | null;
}

/** Row tallies for one run. `skipped` always equals `rejections.length`. */
export interface MailerImportCounts {
  /** Data rows read from the source, excluding the header. */
  read: number;
  /** Rows that mapped cleanly and were sent to Mongo. */
  mapped: number;
  /** New documents. */
  created: number;
  /** Documents that already existed and were updated in place. */
  updated: number;
  /** Rows dropped. See {@link MailerImportRejection}. */
  skipped: number;
}

/** Why one row did not make it, with enough context to find it in the file. */
export interface MailerImportRejection {
  /** 1-based position among data rows, for pointing at the source file. */
  row: number;
  /** Whichever control-number form was present, for a human to search on. */
  controlNumber: string | null;
  reason: string;
}

/** The report a run produces, and the poll target while it is producing it. */
export interface MailerImportRun {
  id: string;
  agencyId: string;
  status: MailerImportRunStatus;
  /** The name the operator's browser sent. */
  uploadedFilename: string;
  sizeBytes: number;
  detected: MailerImportDetected | null;
  /**
   * The file's own agency does not match the agency the operator chose.
   *
   * Set during the preview parse. Committing anyway requires an explicit
   * confirmation on the request — filing one agency's prospects under another
   * is the failure that matters here.
   */
  agencyMismatch: boolean;
  counts: MailerImportCounts | null;
  /**
   * A capped sample, not the full list. 20,405 rejections would not fit in a
   * response; `counts.skipped` is the authoritative total.
   */
  rejections: MailerImportRejection[];
  /** Present only when `status` is `failed`. */
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  /** Short-lived presigned URL for the raw uploaded file. */
  rawFileUrl?: string;
}

/** How many rejections a run stores and returns. */
export const MAILER_IMPORT_REJECTION_SAMPLE_SIZE = 50;
