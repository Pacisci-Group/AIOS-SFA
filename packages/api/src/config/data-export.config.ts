/**
 * Data Export tuning (PAC-152).
 *
 * Read from `process.env` **at call time**, not at import: the e2e suite sets
 * `DATA_EXPORT_MAX_ROWS` around a single test to exercise the refusal, and a
 * module constant would have frozen the value the process booted with.
 *
 * ## Why a cap at all
 *
 * Exports are produced by a worker job into object storage and downloaded
 * later (`worker/functions/data-export-generate.fn.ts`), so a large one no
 * longer ties up a request. The cap still bounds what one job may write, and
 * the request is refused up front — with the row count — rather than queued
 * for a file the data team would then have to narrow anyway. `mailers`
 * (~738k rows, platform-wide) is still not a dataset.
 */

export const DEFAULT_DATA_EXPORT_MAX_ROWS = 100_000;
export const DEFAULT_DATA_EXPORT_BATCH_SIZE = 500;

function boundedInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

/** Rows a single export may hold; larger ones are refused with a 400. */
export function dataExportMaxRows(): number {
  return boundedInt(
    process.env.DATA_EXPORT_MAX_ROWS,
    DEFAULT_DATA_EXPORT_MAX_ROWS,
    1,
    1_000_000,
  );
}

/**
 * Rows per cursor batch — and therefore per round of label/child lookups. One
 * batch is one `$in` per lookup kind, so this trades memory for round trips.
 */
export function dataExportBatchSize(): number {
  return boundedInt(
    process.env.DATA_EXPORT_BATCH_SIZE,
    DEFAULT_DATA_EXPORT_BATCH_SIZE,
    50,
    5_000,
  );
}

/** Seven days: long enough to come back after a weekend, short enough for PII. */
export const DEFAULT_DATA_EXPORT_RETENTION_DAYS = 7;

/**
 * How long a finished export's file is kept before the hourly cron deletes it.
 *
 * Takes the raw value (`ConfigService.get`) so it works from the repo `.env`,
 * like `mailer-output.config.ts`. Clamped to 1–30 days: a stored export is a
 * bulk copy of the agency's contact details, and "forever" is not a setting.
 */
export function dataExportRetentionDays(raw: string | undefined): number {
  return boundedInt(raw, DEFAULT_DATA_EXPORT_RETENTION_DAYS, 1, 30);
}

/** An hour: the same export may be requested once an hour. */
export const DEFAULT_DATA_EXPORT_DUPLICATE_WINDOW_MINUTES = 60;

/**
 * How long after a request the same request (same caller, dataset, format and
 * filters) is refused as a duplicate, in milliseconds.
 *
 * Clamped to 1 minute to 24 hours. The cap keeps the window inside the
 * shortest retention (1 day), so an export's file never expires while its
 * request still blocks a new one.
 */
export function dataExportDuplicateWindowMs(): number {
  return (
    boundedInt(
      process.env.DATA_EXPORT_DUPLICATE_WINDOW_MINUTES,
      DEFAULT_DATA_EXPORT_DUPLICATE_WINDOW_MINUTES,
      1,
      1_440,
    ) * 60_000
  );
}
