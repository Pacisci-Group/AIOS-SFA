import type {
  CreateSoldDealInput,
  CreateSoldDealResponse,
  PolicyCheckResponse,
  SoldDealLeadContext,
} from "@sfa/shared";
import { apiFetch } from "./api-client";

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

/** `POST /sold-deals` — books the sale. Totals are derived server-side. */
export function createSoldDeal(
  input: CreateSoldDealInput,
): Promise<CreateSoldDealResponse> {
  return apiFetch<CreateSoldDealResponse>("/sold-deals", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
