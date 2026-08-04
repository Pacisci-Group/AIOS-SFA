import type {
  CreateQuoteRecapInput,
  CreateQuoteRecapResponse,
  QuoteDocumentPresignResponse,
  QuoteRecapLeadContext,
} from "@sfa/shared";
import { apiFetch } from "@/lib/api-client";

export type {
  CreateQuoteRecapResponse,
  QuoteRecapLeadContext,
  QuoteRecapPolicyInput,
  QuoteRecapPropertyAddress,
} from "@sfa/shared";

/** Content types accepted for the quote document. Mirrors the API DTO. */
export const ALLOWED_UPLOAD_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
] as const;

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
