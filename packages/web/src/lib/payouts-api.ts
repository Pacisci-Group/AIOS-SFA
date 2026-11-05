import type {
  PaymentStructureSummary,
  PaymentStructureView,
  PaymentStructuresResponse,
  PayoutPeopleResponse,
  PayoutSettingsView,
  UpdatePaymentStructureInput,
  UpdatePayoutSettingsInput,
  UpsertPaymentStructureInput,
} from "@sfa/shared";
import { apiFetch } from "@/lib/api-client";

/**
 * Payouts (PAC-176). PAC-177: the agency's payout settings and its payment
 * structures, both behind `agency:payouts:admin`.
 */

export const payoutsKey = ["payouts"] as const;
export const payoutSettingsKey = [...payoutsKey, "settings"] as const;
export const paymentStructuresKey = [...payoutsKey, "structures"] as const;
export const payoutPeopleKey = [...paymentStructuresKey, "people"] as const;
export const paymentStructureKey = (id: string) =>
  [...paymentStructuresKey, id] as const;

export function getPayoutSettings(): Promise<PayoutSettingsView> {
  return apiFetch<PayoutSettingsView>("/payouts/settings");
}

export function updatePayoutSettings(
  input: UpdatePayoutSettingsInput,
): Promise<PayoutSettingsView> {
  return apiFetch<PayoutSettingsView>("/payouts/settings", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function listPaymentStructures(): Promise<PaymentStructuresResponse> {
  return apiFetch<PaymentStructuresResponse>("/payouts/structures");
}

export function getPaymentStructure(id: string): Promise<PaymentStructureView> {
  return apiFetch<PaymentStructureView>(
    `/payouts/structures/${encodeURIComponent(id)}`,
  );
}

export function listPayoutPeople(): Promise<PayoutPeopleResponse> {
  return apiFetch<PayoutPeopleResponse>("/payouts/structures/people");
}

export function createPaymentStructure(
  input: UpsertPaymentStructureInput,
): Promise<PaymentStructureView> {
  return apiFetch<PaymentStructureView>("/payouts/structures", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/**
 * The whole structure, plus the `updatedAt` of the copy the editor loaded —
 * a 409 `PAYMENT_STRUCTURE_STALE` when it was saved elsewhere since.
 */
export function updatePaymentStructure(
  id: string,
  input: UpdatePaymentStructureInput,
): Promise<PaymentStructureView> {
  return apiFetch<PaymentStructureView>(
    `/payouts/structures/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
}

export function archivePaymentStructure(
  id: string,
): Promise<PaymentStructureSummary> {
  return apiFetch<PaymentStructureSummary>(
    `/payouts/structures/${encodeURIComponent(id)}/archive`,
    { method: "POST" },
  );
}
