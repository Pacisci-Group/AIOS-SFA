import type {
  CreateSoldDealInput,
  CreateSoldDealResponse,
  PolicyCheckResponse,
  SoldDealLeadContext,
  SoldDocumentMeta,
  SoldDocumentPresignResponse,
} from "@sfa/shared";
import { apiFetch } from "./api-client";
import { uploadToPresignedUrl } from "./quote-recaps-api";

/** Matches the API's `ALLOWED_SOLD_DOCUMENT_CONTENT_TYPES`. */
export const ALLOWED_SOLD_UPLOAD_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
];

export const MAX_SOLD_UPLOAD_BYTES = 10 * 1024 * 1024;

/** `GET /sold-deals/context?leadId=` — the header and driver picker source. */
export function getSoldDealContext(
  leadId: string,
): Promise<SoldDealLeadContext> {
  return apiFetch<SoldDealLeadContext>(
    `/sold-deals/context?leadId=${encodeURIComponent(leadId)}`,
  );
}

/**
 * `GET /policies/check` — Card 3's duplicate warning.
 *
 * Always resolves to a well-formed envelope: "no matches" and "input too short"
 * are normal answers, not errors, so the caller never has to distinguish a
 * miss from a failure.
 */
export function checkPolicyNumber(
  number: string,
  policyType?: string,
): Promise<PolicyCheckResponse> {
  const params = new URLSearchParams({ number });
  if (policyType) params.set("policyType", policyType);
  return apiFetch<PolicyCheckResponse>(`/policies/check?${params.toString()}`);
}

/**
 * Upload one Card 5 proof and return the metadata to attach to the policy.
 *
 * Three steps: presign → PUT the bytes straight to storage → hand back the key.
 * The bytes never pass through the API, and the server re-derives the real
 * content type and size from the stored object on submit, so what is returned
 * here is a convenience for rendering rather than something trusted.
 */
export async function uploadSoldDocument(
  leadId: string,
  file: File,
): Promise<SoldDocumentMeta> {
  const presigned = await apiFetch<SoldDocumentPresignResponse>(
    "/sold-deals/documents/presign",
    {
      method: "POST",
      body: JSON.stringify({
        leadId,
        filename: file.name,
        contentType: file.type,
        size: file.size,
      }),
    },
  );

  // A bare `fetch`, never `apiFetch`: an `Authorization` header invalidates the
  // S3 signature. This is the single easiest thing to get wrong here.
  await uploadToPresignedUrl(
    presigned.uploadUrl,
    presigned.requiredHeaders,
    file,
  );

  return {
    key: presigned.key,
    filename: file.name,
    contentType: file.type,
    size: file.size,
  };
}

/** `POST /sold-deals` — books the sale. Totals are derived server-side. */
export function createSoldDeal(
  input: CreateSoldDealInput,
): Promise<CreateSoldDealResponse> {
  return apiFetch<CreateSoldDealResponse>("/sold-deals", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
