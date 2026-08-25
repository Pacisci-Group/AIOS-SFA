import type {
  MailerImportRun,
  MailerImportRunStatus,
} from '@sfa/shared';
import { apiFetch } from '@/lib/api-client';

/**
 * Add Mailers — the RTP upload (PAC-73).
 *
 * Three calls, not one: presign, `PUT` the bytes straight to object storage,
 * then hand the key back. The file never passes through the API. Same chain as
 * quote documents and deal-audit attachments.
 */

export type { MailerImportRun, MailerImportRunStatus };

/**
 * What the browser is allowed to pick.
 *
 * Checked by **extension as well as MIME type**: `File.type` for a `.csv` is
 * `text/csv` on Chrome, `application/vnd.ms-excel` on Windows where Excel owns
 * the extension, and often the empty string on Safari or for a file that came
 * out of a cloud drive. Type alone would reject real files for no reason the
 * operator could act on.
 */
export const ALLOWED_MAILER_TYPES = [
  'text/csv',
  'application/csv',
  'text/plain',
  'application/vnd.ms-excel',
] as const;

export const ALLOWED_MAILER_EXTENSIONS = ['.csv'] as const;

/**
 * What the `PUT` actually sends, whatever the browser reported.
 *
 * The S3 signature covers `Content-Type`, so the presign request, the signed
 * value and this header must agree exactly or storage answers 403 with nothing
 * useful in it.
 */
export const CANONICAL_MAILER_CONTENT_TYPE = 'text/csv';

/** 100 MB. The reference RTP file is 23 MB; an Auto file will be larger. */
export const MAX_MAILER_FILE_BYTES = 100 * 1024 * 1024;

interface PresignResponse {
  key: string;
  uploadUrl: string;
  requiredHeaders: Record<string, string>;
  expiresIn: number;
}

function presignMailerImport(input: {
  agencyId: string;
  filename: string;
  size: number;
}) {
  return apiFetch<PresignResponse>('/platform/mailers/imports/presign', {
    method: 'POST',
    body: JSON.stringify({
      ...input,
      contentType: CANONICAL_MAILER_CONTENT_TYPE,
    }),
  });
}

/**
 * Upload the raw bytes.
 *
 * Bare `fetch`, never `apiFetch`: the latter attaches an `Authorization`
 * header, and any header not covered by the presigned signature invalidates it.
 */
async function uploadToPresignedUrl(
  uploadUrl: string,
  headers: Record<string, string>,
  file: File,
) {
  const res = await fetch(uploadUrl, { method: 'PUT', headers, body: file });
  if (!res.ok) {
    throw new Error(`Upload failed (${res.status})`);
  }
}

/**
 * Presign, upload, and start the preview parse.
 *
 * Returns a run in `previewing`. Nothing is written to `mailers` by this or by
 * the job it starts — the operator sees the file's contents first.
 */
export async function startMailerImport(input: {
  agencyId: string;
  file: File;
}): Promise<MailerImportRun> {
  const presigned = await presignMailerImport({
    agencyId: input.agencyId,
    filename: input.file.name,
    size: input.file.size,
  });

  await uploadToPresignedUrl(
    presigned.uploadUrl,
    presigned.requiredHeaders,
    input.file,
  );

  return apiFetch<MailerImportRun>('/platform/mailers/imports', {
    method: 'POST',
    body: JSON.stringify({
      agencyId: input.agencyId,
      key: presigned.key,
      filename: input.file.name,
    }),
  });
}

/** The poll target while a run works, and the report once it is done. */
export function getMailerImport(runId: string) {
  return apiFetch<MailerImportRun>(`/platform/mailers/imports/${runId}`);
}

/**
 * Commit a previewed run.
 *
 * `confirmAgencyMismatch` is only accepted, never required by the client — the
 * server decides whether one is needed from the run record, so omitting it
 * cannot get past the check.
 */
export function commitMailerImport(
  runId: string,
  options: { confirmAgencyMismatch?: boolean } = {},
) {
  return apiFetch<MailerImportRun>(
    `/platform/mailers/imports/${runId}/commit`,
    { method: 'POST', body: JSON.stringify(options) },
  );
}

/** Terminal states — where the UI stops polling. */
export function isMailerImportSettled(status: MailerImportRunStatus): boolean {
  return status === 'previewed' || status === 'completed' || status === 'failed';
}
