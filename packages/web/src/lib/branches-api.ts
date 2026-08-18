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
 * Requires `agency:branches:read`. Callers that only *optionally* want branches
 * — the invite form, which hides its branch picker for single-branch agencies —
 * must tolerate a 403 rather than surfacing it as a page error.
 */
export function listBranches() {
  return apiFetch<AgencyBranch[]>('/branches');
}
