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

/**
 * Query key for the platform-global catalog (PAC-93).
 *
 * Separate from {@link carriersKey} because it is a different *set*, not the
 * same one fetched differently: `/carriers` unions an agency's own rows over
 * the globals, and a Super Admin has no agency. Sharing a key would let one
 * surface serve the other's cache.
 */
export const platformCarriersKey = ["platform", "carriers"] as const;

/**
 * `GET /platform/carriers` — every global carrier, for the Super Admin panel.
 *
 * The onboarding wizard cannot use `getCarriers`: `/carriers` is gated on the
 * `deal_audits` / `crm_service` modules, and a platform operator has no agency
 * to hold an entitlement.
 */
export async function getPlatformCarriers(): Promise<CarrierOption[]> {
  const response = await apiFetch<CarrierListResponse>("/platform/carriers");
  return response.carriers;
}
