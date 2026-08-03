import type { HouseholdSummary, HouseholdView } from '@sfa/shared';
import { apiFetch } from '@/lib/api-client';

export type {
  ContactSummary,
  HouseholdSummary,
  HouseholdView,
  PolicySummary,
} from '@sfa/shared';

const BASE = '/households';

export function getHousehold(id: string) {
  return apiFetch<HouseholdView>(`${BASE}/${id}`);
}

/** Typeahead for household pickers. A blank term returns the first page. */
export function searchHouseholds(term: string, limit = 20) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (term.trim()) {
    params.set('q', term.trim());
  }
  return apiFetch<HouseholdSummary[]>(`${BASE}/search?${params}`);
}
