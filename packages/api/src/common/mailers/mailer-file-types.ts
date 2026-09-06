/**
 * What a mailer file may be uploaded as (PAC-73, widened for PAC-71).
 *
 * Lives in `common/` because both the campaign DTOs and the worker's reader need
 * it, and the worker's import boundary admits `common/` but not a feature
 * directory's DTO file.
 */

/**
 * ⚠ Wider than it looks like it should be, on purpose. `File.type` for a `.csv`
 * is `text/csv` on Chrome/Linux, `application/vnd.ms-excel` on Windows where
 * Excel owns the extension, and frequently the **empty string** on Safari and
 * for files arriving from some cloud drives. Rejecting on MIME type alone would
 * turn "I dragged in the file you sent me" into an unexplainable failure.
 *
 * The XLSX type is the real vendor file's (`SFA-QBP.xlsx`); `application/zip` is
 * there because an XLSX *is* a zip and some clients report it as one.
 *
 * Content type is a hint, never the parse decision — `detectVendorFileKind`
 * settles that from the extension and the file's own magic bytes.
 */
export const ALLOWED_MAILER_CONTENT_TYPES = [
  'text/csv',
  'application/csv',
  'text/plain',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip',
  'application/octet-stream',
] as const;

/**
 * Max upload size — 100 MB.
 *
 * Deliberately not the 10 MB used for PDFs elsewhere: the reference vendor file
 * is 23 MB, and an Auto file with its 33 extra populated columns will be larger.
 */
export const MAX_MAILER_FILE_BYTES = 100 * 1024 * 1024;
