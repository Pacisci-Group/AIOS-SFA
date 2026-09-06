/**
 * PUT a file straight to object storage using a presigned URL.
 *
 * ⚠ **Deliberately not `apiFetch`.** The request goes to object storage, not to
 * our API: it must carry no `Authorization` header (S3 rejects a request signed
 * two ways), no JSON `Content-Type` (the signature covers `Content-Type`, so it
 * has to be byte-identical to the value the server signed with, which is what
 * `requiredHeaders` carries), and no `/api/v1` prefix.
 *
 * Extracted from the deleted Add Mailers page in PAC-71 so the campaign wizard
 * reuses it rather than restating it — the header rules above are exactly the
 * kind of thing a second copy gets subtly wrong, and the failure is a 403 from
 * storage whose body says nothing useful.
 */
export async function uploadToPresignedUrl(
  uploadUrl: string,
  headers: Record<string, string>,
  file: File,
): Promise<void> {
  const res = await fetch(uploadUrl, { method: 'PUT', headers, body: file });
  if (!res.ok) {
    throw new Error(`Upload failed (${res.status})`);
  }
}
