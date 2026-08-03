import type { PolicySearchResult, PolicyView } from '@sfa/shared';
import { apiFetch } from '@/lib/api-client';

export type { PolicySearchResult, PolicyView } from '@sfa/shared';

const BASE = '/policies';

export function getPolicy(id: string) {
  return apiFetch<PolicyView>(`${BASE}/${id}`);
}

/** Typeahead for policy pickers. A blank term returns the first page. */
export function searchPolicies(term: string, limit = 20) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (term.trim()) {
    params.set('q', term.trim());
  }
  return apiFetch<PolicySearchResult[]>(`${BASE}/search?${params}`);
}
