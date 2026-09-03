import { apiFetch } from '@/lib/api-client';

export interface AgencyBranch {
  _id: string;
  agencyId: string;
  name: string;
  slug: string;
  isDefault: boolean;
}

/**
 * Branches of the caller's agency, default first then alphabetical (the API
 * sorts; don't re-sort here).
 *
 * Requires `agency:branches:read` — which `POST /users/invite` does **not**, so
 * a caller can be allowed to invite and still be refused this list. Callers that
 * only *optionally* want branches (the invite dialog, which drops its picker and
 * sends no `branchId` when this fails) must tolerate a 403 rather than surfacing
 * it as a page error. Every role that can invite happens to hold this today, so
 * that path is defensive only.
 */
export function listBranches() {
  return apiFetch<AgencyBranch[]>('/branches');
}
