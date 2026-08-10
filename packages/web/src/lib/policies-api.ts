import type { PolicySearchResult, PolicyView } from '@sfa/shared';
import { apiFetch } from '@/lib/api-client';

export type { PolicySearchResult, PolicyView } from '@sfa/shared';

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
