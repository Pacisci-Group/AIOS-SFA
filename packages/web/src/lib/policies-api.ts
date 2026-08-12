import type {
  PolicySearchResult,
  PolicyView,
  UpdatePolicyInput,
  UpdatePolicyResult,
} from '@sfa/shared';
import { apiFetch } from '@/lib/api-client';

export type {
  PolicySearchResult,
  PolicyView,
  UpdatePolicyInput,
  UpdatePolicyResult,
};

const BASE = '/policies';

export function getPolicy(id: string) {
  return apiFetch<PolicyView>(`${BASE}/${id}`);
}

/**
 * Typeahead for policy pickers. A blank term returns the first page.
 *
 * `householdId` narrows the search to one household's policies — pass it where
 * the picker is opened from a household and must not offer another client's
 * policy.
 */
export function searchPolicies(
  term: string,
  limit = 20,
  householdId?: string | null,
) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (term.trim()) {
    params.set('q', term.trim());
  }
  if (householdId) {
    params.set('householdId', householdId);
  }
  return apiFetch<PolicySearchResult[]>(`${BASE}/search?${params}`);
}

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
    `${BASE}/${encodeURIComponent(policyId)}`,
    { method: 'PATCH', body: JSON.stringify(input) },
  );
}
