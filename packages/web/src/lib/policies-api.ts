import type {
  PolicyReplacementChain,
  PolicySearchResult,
  PolicySummary,
  PolicyView,
  UpdatePolicyInput,
  UpdatePolicyResult,
} from '@sfa/shared';
import { apiFetch } from '@/lib/api-client';

export type {
  PolicyReplacementChain,
  PolicySearchResult,
  PolicySummary,
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

/**
 * `PATCH /households/:id/policies/:policyId` — the household policy card's
 * edit (PAC-126).
 *
 * The same patch body as {@link updatePolicy} against a different route, and
 * that is the whole point: the endpoint above gates on `deal_audits:write` and
 * resolves `own` scope through the policy's *deal*, so a CSR gets a 403 and a
 * migrated policy with no deal reads as 404 — between them, exactly the people
 * and exactly the records this ticket is about. Nested under the household, the
 * household supplies both the permission and the scope.
 *
 * Returns a `PolicySummary`, not an `UpdatePolicyResult`: it carries
 * `renewalDate`, which the household card leads with and which the server
 * re-derives whenever the effective date or the policy type changes.
 */
export function updateHouseholdPolicy(
  householdId: string,
  policyId: string,
  input: UpdatePolicyInput,
) {
  return apiFetch<PolicySummary>(
    `/households/${encodeURIComponent(householdId)}/policies/${encodeURIComponent(policyId)}`,
    { method: 'PATCH', body: JSON.stringify(input) },
  );
}

/**
 * Every policy in this one's replacement chain, oldest first.
 *
 * Returns a single-entry chain for a policy that has never been replaced, so
 * the caller can render it without a "has history?" branch.
 */
export function getPolicyHistory(policyId: string) {
  return apiFetch<PolicyReplacementChain>(`${BASE}/${policyId}/history`);
}
