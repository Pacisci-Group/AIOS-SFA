import type { CarrierListResponse, CarrierOption } from "@sfa/shared";
import { apiFetch } from "./api-client";

/**
 * TanStack Query key for the carrier catalog (PAC-56 #19).
 *
 * Reference data: it changes when an admin curates the list, which no surface
 * can do yet, so a long `staleTime` at the call site is correct.
 */
export const carriersKey = ["carriers"] as const;

/** `GET /carriers` — the Sold wizard's carrier vocabulary. */
export async function getCarriers(): Promise<CarrierOption[]> {
  const response = await apiFetch<CarrierListResponse>("/carriers");
  return response.carriers;
}
