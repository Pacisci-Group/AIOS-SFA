import type {
  ContactSummary,
  HouseholdMemberRole,
  HouseholdSummary,
  HouseholdView,
} from '@sfa/shared';
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

export interface AddHouseholdMemberInput {
  firstName: string;
  lastName: string;
  /** `YYYY-MM-DD`. Omit when unknown — members do not have to supply one. */
  dateOfBirth?: string;
  role: HouseholdMemberRole;
}

/**
 * Add a member to a household. Returns the new member in the same
 * `ContactSummary` shape `getHousehold` lists them in.
 */
export function addHouseholdMember(
  householdId: string,
  input: AddHouseholdMemberInput,
) {
  return apiFetch<ContactSummary>(`${BASE}/${householdId}/members`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** Typeahead for household pickers. A blank term returns the first page. */
export function searchHouseholds(term: string, limit = 20) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (term.trim()) {
    params.set('q', term.trim());
  }
  return apiFetch<HouseholdSummary[]>(`${BASE}/search?${params}`);
}
