import type {
  AddSoldDealPoliciesInput,
  AddSoldDealPoliciesResponse,
  CreateSoldDealInput,
  CreateSoldDealResponse,
  PolicyCheckResponse,
  SoldDealEditView,
  SoldDealLeadContext,
  SoldDocumentMeta,
  SoldDocumentPresignResponse,
  SoldStaffOption,
  UpdateSoldDealInput,
} from "@sfa/shared";
import { apiFetch } from "./api-client";
import { uploadToPresignedUrl } from "./quote-recaps-api";

/** Matches the API's `ALLOWED_SOLD_DOCUMENT_CONTENT_TYPES`. */
export const ALLOWED_SOLD_UPLOAD_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
];

/**
 * PDF-only — the new business application (PAC-56 #23) is the deliberate
 * exception to the sold form's PDF-or-image rule. It is a signed application,
 * not a photographed receipt.
 */
export const ALLOWED_NBA_UPLOAD_TYPES = ["application/pdf"];

export const MAX_SOLD_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Mirrors the API's `SOLD_UPLOAD_KINDS`. */
export type SoldUploadKind = "discount_proof" | "new_business_application";

/**
 * What an in-progress upload hangs off.
 *
 * The wizard uploads while it is still being filled in, so there is no deal yet
 * to scope a document to — it is anchored on the lead, and the key prefix the
 * server derives from it is the ownership check.
 *
 * Still a discriminated union with one member, and still passed in by the flow
 * rather than derived inside the wizard, on purpose. It had three members until
 * PAC-126 — a ticket-anchored transfer and a policy-anchored rewrite each had a
 * presign of their own — and the wizard inferred which from its variant, which
 * is how the rewrite fell through to the lead branch with an empty `leadId` and
 * could never upload. Both flows run on a lead now. The shape stays so the next
 * anchor, if there is one, is a compile error here rather than a fallback.
 */
export type UploadScope = { kind: "lead"; leadId: string };

/** `GET /sold-deals/context?leadId=` — the header and driver picker source. */
export function getSoldDealContext(
  leadId: string,
): Promise<SoldDealLeadContext> {
  return apiFetch<SoldDealLeadContext>(
    `/sold-deals/context?leadId=${encodeURIComponent(leadId)}`,
  );
}

/**
 * `GET /policies/check` — the policy-details card's duplicate warning.
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
 * Upload one sold-form document and return the metadata to attach to the policy.
 *
 * Three steps: presign → PUT the bytes straight to storage → hand back the key.
 * The bytes never pass through the API, and the server re-derives the real
 * content type and size from the stored object on submit, so what is returned
 * here is a convenience for rendering rather than something trusted.
 *
 * `kind` decides both the allowed content types and the key prefix (PAC-56
 * #23) — the prefix is what lets the server enforce PDF-only on the new
 * business application at verification time rather than trusting the presign.
 */
/**
 * Where each anchor presigns. Exhaustive over {@link UploadScope}, so a new
 * anchor is a compile error here rather than a silent fallback.
 */
function presignEndpoint(scope: UploadScope): string {
  switch (scope.kind) {
    case "lead":
      return "/sold-deals/documents/presign";
  }
}

export async function uploadSoldDocument(
  scope: UploadScope,
  file: File,
  kind: SoldUploadKind = "discount_proof",
): Promise<SoldDocumentMeta> {
  const presigned = await apiFetch<SoldDocumentPresignResponse>(
    presignEndpoint(scope),
    {
      method: "POST",
      body: JSON.stringify({
        leadId: scope.leadId,
        kind,
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

/** Query key for the agency staff picker (PAC-65 #11). */
export const soldStaffKey = ["sold-deals", "staff"] as const;

/**
 * The agency's staff, for "Cancelled by → SFA staff".
 *
 * Served by `GET /sold-deals/staff` rather than `GET /users`, which is gated on
 * `agency:users:read` — a permission a Producer does not hold, so the person
 * filling this form would 403 on their own picker.
 */
export function getSoldStaff() {
  return apiFetch<SoldStaffOption[]>("/sold-deals/staff");
}

/**
 * The Edit sale page's query key (PAC-104).
 *
 * The `["sold-deal"]` prefix is what a per-policy quick edit invalidates, so
 * the page's totals follow a correction made in the edit dialog.
 */
export function soldDealKey(dealId: string) {
  return ["sold-deal", dealId] as const;
}

/** `GET /sold-deals/:id` — a booked deal, its policies, and whether it can take another. */
export function getSoldDeal(dealId: string): Promise<SoldDealEditView> {
  return apiFetch<SoldDealEditView>(
    `/sold-deals/${encodeURIComponent(dealId)}`,
  );
}

/** `PATCH /sold-deals/:id` — correct the sold date. */
export function updateSoldDeal(
  dealId: string,
  input: UpdateSoldDealInput,
): Promise<SoldDealEditView> {
  return apiFetch<SoldDealEditView>(
    `/sold-deals/${encodeURIComponent(dealId)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
}

/** `POST /sold-deals/:id/policies` — add policies to the booked deal. */
export function addSoldDealPolicies(
  dealId: string,
  input: AddSoldDealPoliciesInput,
): Promise<AddSoldDealPoliciesResponse> {
  return apiFetch<AddSoldDealPoliciesResponse>(
    `/sold-deals/${encodeURIComponent(dealId)}/policies`,
    { method: "POST", body: JSON.stringify(input) },
  );
}
