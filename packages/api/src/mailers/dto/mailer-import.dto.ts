import { z } from 'zod';

/**
 * Content types a mailer file may be uploaded as.
 *
 * ⚠ Wider than it looks like it should be, on purpose. `File.type` for a `.csv`
 * is `text/csv` on Chrome/Linux, `application/vnd.ms-excel` on Windows where
 * Excel owns the extension, and frequently the **empty string** on Safari and
 * for files arriving from some cloud drives. Rejecting on MIME type alone would
 * turn "I dragged in the file you sent me" into an unexplainable failure.
 *
 * The client sends `text/csv` regardless — see `CANONICAL_MAILER_CONTENT_TYPE`
 * — so this list is really about tolerating a client that does not.
 */
export const ALLOWED_MAILER_CONTENT_TYPES = [
  'text/csv',
  'application/csv',
  'text/plain',
  'application/vnd.ms-excel',
] as const;

/**
 * What the presigned PUT is actually signed with.
 *
 * The signature covers `Content-Type`, so the value here, the value returned in
 * `requiredHeaders`, and the header the browser sends must be **byte
 * identical** or storage rejects the upload with a 403 that says nothing useful.
 * Pinning one canonical value is what stops that being a per-browser bug.
 */
export const CANONICAL_MAILER_CONTENT_TYPE = 'text/csv';

/**
 * Max upload size — 100 MB.
 *
 * Deliberately not the 10 MB used for PDFs elsewhere: the reference RTP file is
 * 23 MB, and an Auto file with its 33 extra populated columns will be larger.
 */
export const MAX_MAILER_FILE_BYTES = 100 * 1024 * 1024;

/** 24-character hex Mongo ObjectId. */
const objectId = z
  .string()
  .trim()
  .regex(/^[0-9a-f]{24}$/, 'expected a 24-hex ObjectId');

export const presignMailerImportSchema = z.object({
  /**
   * The agency this file belongs to, chosen explicitly by the operator.
   *
   * Never inferred from the filename or from the file's own `agencyid` column.
   * The file is cross-checked *against* this choice; it does not make it.
   */
  agencyId: objectId,
  filename: z.string().trim().min(1).max(255),
  contentType: z.enum(ALLOWED_MAILER_CONTENT_TYPES),
  size: z.coerce.number().int().positive().max(MAX_MAILER_FILE_BYTES),
});
export type PresignMailerImportDto = z.infer<typeof presignMailerImportSchema>;

export const createMailerImportSchema = z.object({
  agencyId: objectId,
  /** The key returned by presign. Ownership is re-checked server-side. */
  key: z.string().trim().min(1),
  filename: z.string().trim().min(1).max(255),
});
export type CreateMailerImportDto = z.infer<typeof createMailerImportSchema>;

export const commitMailerImportSchema = z.object({
  /**
   * Required when the preview flagged an agency mismatch.
   *
   * The flag lives on the run record rather than in the request, so a client
   * cannot bypass the confirmation by omitting the field — the server already
   * knows whether one is needed.
   */
  confirmAgencyMismatch: z.boolean().optional(),
});
export type CommitMailerImportDto = z.infer<typeof commitMailerImportSchema>;
