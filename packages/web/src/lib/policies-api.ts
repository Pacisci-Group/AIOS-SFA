import type { UpdatePolicyInput, UpdatePolicyResult } from "@sfa/shared";
import { apiFetch } from "@/lib/api-client";

export type { UpdatePolicyInput, UpdatePolicyResult };

/**
 * `PATCH /policies/:id` — the Lead Detail Sold card's quick edit (PAC-56 #27).
 *
 * Send only the fields the producer changed; `null` clears an optional one.
 * Returns the saved policy in the same shape the Lead Detail page already
 * renders, so the caller swaps the row in place rather than refetching the
 * whole 360° assembly for a one-field correction.
 */
export function updatePolicy(policyId: string, input: UpdatePolicyInput) {
  return apiFetch<UpdatePolicyResult>(
    `/policies/${encodeURIComponent(policyId)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
}
