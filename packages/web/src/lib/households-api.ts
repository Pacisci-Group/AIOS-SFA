import type {
  ContactSummary,
  HouseholdListResponse,
  HouseholdMemberRole,
  HouseholdSummary,
  HouseholdView,
  SetPrimaryContactInput,
} from '@sfa/shared';
import { apiFetch } from '@/lib/api-client';

export type {
  ContactSummary,
  HouseholdListResponse,
  HouseholdListRow,
  HouseholdMatch,
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

/**
 * `POST /households/:id/primary-contact` — name the household's primary
 * contact, or deliberately leave it without one (PAC-91 §7).
 *
 * `clients:write`. The operation did not exist before: `primaryContactId` was
 * only ever filled by intake and never reassigned, so a wrong primary, a
 * divorce or a death had no supported fix.
 *
 * Returns the whole `HouseholdView` because the write moves more than one
 * field — the roster's `isPrimary`, the resolved `primaryEmail`/`primaryPhone`
 * and the `dataQuality` flag all change together.
 *
 * Refusals arrive as **409s carrying a `code`**: `contact_not_a_member`,
 * `contact_deceased`, `primary_of_another_household`. Read `ApiError.body.code`,
 * never the message.
 */
export function setPrimaryContact(
  householdId: string,
  input: SetPrimaryContactInput,
) {
  return apiFetch<HouseholdView>(
    `${BASE}/${encodeURIComponent(householdId)}/primary-contact`,
    { method: 'POST', body: JSON.stringify(input) },
  );
}

/**
 * Query for the Clients list. Names mirror the API's `ListHouseholdsDto`
 * one-for-one, so a URL reads the same as the request it produces.
 */
export interface ListHouseholdsParams {
  page?: number;
  pageSize?: number;
  /** Omni search — the API routes it by shape and ORs across every dimension. */
  q?: string;
  /** The advanced panel. These AND together, and with `q`. */
  firstName?: string;
  lastName?: string;
  /** `YYYY-MM-DD` */
  dateOfBirth?: string;
  /** `HH-2614`, `#HH2614` or the bare number. */
  householdRef?: string;
  policyNumber?: string;
  /** Canonical labels; several are ORed. */
  status?: string[];
  sort?: 'name' | 'policies' | 'updated';
}

/** `GET /households` — the Clients list, resolved server-side (PAC-89). */
export function listHouseholds(params: ListHouseholdsParams = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === '') continue;
    if (Array.isArray(value)) {
      // Repeated params (`?status=Active&status=Inactive`) — Express parses
      // these into the array the DTO expects.
      for (const item of value) search.append(key, String(item));
      continue;
    }
    search.set(key, String(value));
  }
  const qs = search.toString();
  return apiFetch<HouseholdListResponse>(`${BASE}${qs ? `?${qs}` : ''}`);
}

/** Typeahead for household pickers. A blank term returns the first page. */
export function searchHouseholds(term: string, limit = 20) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (term.trim()) {
    params.set('q', term.trim());
  }
  return apiFetch<HouseholdSummary[]>(`${BASE}/search?${params}`);
}
