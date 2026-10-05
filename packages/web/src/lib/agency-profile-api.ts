import type { AgencyProfileView, UpdateAgencyProfileInput } from '@sfa/shared';
import { apiFetch } from '@/lib/api-client';

/** Query key for `GET /agency/profile`. */
export const agencyProfileKey = ['agency-profile'] as const;

/** The agency's own profile — today, its time zone (PAC-141). */
export function getAgencyProfile(): Promise<AgencyProfileView> {
  return apiFetch<AgencyProfileView>('/agency/profile');
}

/**
 * Change the zone. The response is the stored state; write it into the query
 * rather than refetching. Everything date-shaped the app shows is resolved by
 * the API on the next request, so nothing else needs invalidating here —
 * though a dashboard already on screen keeps its last window until it refetches.
 */
export function updateAgencyProfile(
  input: UpdateAgencyProfileInput,
): Promise<AgencyProfileView> {
  return apiFetch<AgencyProfileView>('/agency/profile', {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}
