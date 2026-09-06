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

/**
 * The XLSX media type, spelled once.
 *
 * Long enough that a typo in a second copy would be invisible, and it is
 * compared for equality in three places (the allow-list above, the presign's
 * canonical type, and the `PutObject` the commit job writes with).
 */
export const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** What the print output is written as. */
export const CSV_CONTENT_TYPE = 'text/csv';

/**
 * What the presigned PUT is actually signed with.
 *
 * ⚠ The signature covers `Content-Type`, so the value signed here, the value
 * returned in `requiredHeaders` and the header the browser sends must be **byte
 * identical** or storage rejects the upload with a 403 that says nothing useful.
 * Deriving it from the **extension** rather than trusting `File.type` is what
 * stops that being a per-browser bug — see the note on
 * {@link ALLOWED_MAILER_CONTENT_TYPES}.
 */
export function canonicalMailerContentType(filename: string): string {
  return /\.xlsx?$|\.xlsm$/i.test(filename.trim())
    ? XLSX_CONTENT_TYPE
    : CSV_CONTENT_TYPE;
}

/**
 * Object-key namespace for everything a mailer campaign stores (PAC-71).
 *
 * A fixed segment, because `StorageService.assertPlatformKeyOwnership` treats
 * the `platform/<purpose>/` prefix as a security property: a client hands back
 * the key it was given, so without an exact prefix test it could hand back any
 * key it knew of — including a tenant's document — and have the platform read
 * it.
 *
 * Lives here rather than in the campaign service because the worker writes the
 * output object under the same prefix, and the worker's import boundary admits
 * `common/` but not a feature directory.
 */
export const MAILER_CAMPAIGN_PURPOSE = 'mailer-campaigns';
