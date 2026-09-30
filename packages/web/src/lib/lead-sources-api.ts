import type { LeadSourceListResponse, LeadSourceOption } from "@sfa/shared";
import { apiFetch } from "./api-client";

/**
 * TanStack Query key for the lead-source catalog (PAC-135).
 *
 * Reference data: it changes when someone curates the list, which no surface
 * can do yet, so a long `staleTime` is correct — see `useLeadSources`.
 */
export const leadSourcesKey = ["lead-sources"] as const;

/** `GET /lead-sources` — platform sources plus this agency's own, active only. */
export async function getLeadSources(): Promise<LeadSourceOption[]> {
  const response = await apiFetch<LeadSourceListResponse>("/lead-sources");
  return response.leadSources;
}
