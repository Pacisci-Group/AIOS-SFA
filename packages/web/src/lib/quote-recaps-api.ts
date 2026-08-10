import type {
  CreateQuoteRecapInput,
  CreateQuoteRecapResponse,
  DocumentDownloadResponse,
  QuoteDocumentPresignResponse,
  QuoteRecapEditView,
  QuoteRecapLeadContext,
  UpdateQuoteRecapInput,
  UpdateQuoteRecapResult,
} from "@sfa/shared";
import { apiFetch } from "@/lib/api-client";

export type {
  CreateQuoteRecapResponse,
  QuoteRecapEditView,
  QuoteRecapLeadContext,
  QuoteRecapPolicyInput,
  QuoteRecapPropertyAddress,
  UpdateQuoteRecapInput,
  UpdateQuoteRecapResult,
} from "@sfa/shared";

/**
 * Content types accepted for the quote document. Mirrors the API DTO.
 *
 * **PDF only** since PAC-56 #9 — see the rationale on
 * `ALLOWED_QUOTE_DOCUMENT_CONTENT_TYPES` in
 * `api/src/quote-recaps/dto/presign-quote-document.dto.ts`. The sold-form and
 * deal-audit uploads (`deal-audits-api.ts`) still accept images and must not be
 * narrowed to match this.
 */
export const ALLOWED_UPLOAD_TYPES = ["application/pdf"] as const;

/** Max upload size (10 MB), matching the API + UI copy. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Read-only lead + household header the form shows on mount. */
export function getQuoteRecapContext(leadId: string) {
  return apiFetch<QuoteRecapLeadContext>(
    `/quote-recaps/context?leadId=${encodeURIComponent(leadId)}`,
  );
}

/**
 * Request a presigned URL to upload the quote document.
 *
 * Scoped to the lead rather than the recap: the file is uploaded while the
 * recap is still being composed, so there is no recap id yet.
 */
export function presignQuoteDocument(meta: {
  leadId: string;
  filename: string;
  contentType: string;
  size: number;
}) {
  return apiFetch<QuoteDocumentPresignResponse>(
    "/quote-recaps/quote-document/presign",
    { method: "POST", body: JSON.stringify(meta) },
  );
}

/**
 * `GET /quote-recaps/:id/document/download` — a short-lived, inline-signed URL
 * for the uploaded quote document (PAC-56 #10, #30).
 *
 * Pair it with `openDocumentInNewTab`: the URL expires, so it is fetched per
 * click rather than rendered into an `href`.
 */
export function getQuoteDocumentDownload(recapId: string) {
  return apiFetch<DocumentDownloadResponse>(
    `/quote-recaps/${encodeURIComponent(recapId)}/document/download`,
  );
}

/**
 * Upload the raw file bytes straight to object storage.
 *
 * Uses bare `fetch`, never `apiFetch`: `apiFetch` attaches an `Authorization`
 * header, and any header not covered by the presigned signature invalidates it.
 * This is the single easiest thing to get wrong in the flow.
 */
export async function uploadToPresignedUrl(
  uploadUrl: string,
  headers: Record<string, string>,
  file: File,
) {
  const res = await fetch(uploadUrl, { method: "PUT", headers, body: file });
  if (!res.ok) {
    throw new Error(`Upload failed (${res.status})`);
  }
}

export function createQuoteRecap(payload: CreateQuoteRecapInput) {
  return apiFetch<CreateQuoteRecapResponse>("/quote-recaps", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/**
 * The full three-step write: presign → PUT the bytes directly to storage →
 * create the recap carrying only the returned key.
 *
 * File bytes never pass through the API, and no base64 data URL is ever built
 * (the `sfaforms` prototype's `readFileAsDataUrl` approach is explicitly not
 * what we do).
 */
export async function createQuoteRecapWithDocument(
  input: Omit<CreateQuoteRecapInput, "quoteDocument"> & { file: File },
): Promise<CreateQuoteRecapResponse> {
  const { file, ...rest } = input;
  const meta = {
    filename: file.name,
    contentType: file.type,
    size: file.size,
  };

  const presigned = await presignQuoteDocument({
    leadId: rest.leadId,
    ...meta,
  });
  await uploadToPresignedUrl(
    presigned.uploadUrl,
    presigned.requiredHeaders,
    file,
  );

  return createQuoteRecap({
    ...rest,
    quoteDocument: { key: presigned.key, ...meta },
  });
}

/**
 * `GET /quote-recaps/:id` — the edit form's payload (PAC-56 #11).
 *
 * Carries the lead/household context alongside the recap, so the edit page
 * renders `LeadContextHeader` and the "same as household" toggle without a
 * second request.
 */
export function getQuoteRecapEditView(recapId: string) {
  return apiFetch<QuoteRecapEditView>(
    `/quote-recaps/${encodeURIComponent(recapId)}`,
  );
}

export function updateQuoteRecap(
  recapId: string,
  input: UpdateQuoteRecapInput,
) {
  return apiFetch<UpdateQuoteRecapResult>(
    `/quote-recaps/${encodeURIComponent(recapId)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
}

/**
 * Save an edit, uploading a replacement document first if one was chosen.
 *
 * The presign step is **skipped entirely** when no new file was picked, and the
 * PATCH then omits `quoteDocument` — which is what tells the API to keep the
 * attachment it already has. Structurally the same three-step flow as
 * {@link createQuoteRecapWithDocument}, minus the steps that aren't needed.
 *
 * `leadId` rather than the recap id, because `presignQuoteDocument` is
 * lead-scoped: the object key it mints has to match the prefix the API checks.
 */
export async function updateQuoteRecapWithDocument(
  recapId: string,
  input: Omit<UpdateQuoteRecapInput, "quoteDocument"> & {
    leadId: string;
    file?: File;
  },
): Promise<UpdateQuoteRecapResult> {
  const { leadId, file, ...rest } = input;

  if (!file) return updateQuoteRecap(recapId, rest);

  const meta = {
    filename: file.name,
    contentType: file.type,
    size: file.size,
  };
  const presigned = await presignQuoteDocument({ leadId, ...meta });
  await uploadToPresignedUrl(
    presigned.uploadUrl,
    presigned.requiredHeaders,
    file,
  );

  return updateQuoteRecap(recapId, {
    ...rest,
    quoteDocument: { key: presigned.key, ...meta },
  });
}
