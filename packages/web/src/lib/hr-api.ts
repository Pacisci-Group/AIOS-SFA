import type {
  CreateHrPolicyInput,
  PolicyPeopleResponse,
  HrPoliciesResponse,
  HrPolicyType,
  HrPolicyView,
  UpdateHrPolicyInput,
} from '@sfa/shared';
import { apiFetch } from '@/lib/api-client';

/**
 * HR policies (PAC-161 v3) — Workspace Settings → HR policies. Every call is
 * `agency:hr:admin`; the page is gated on the same permission.
 */

export const hrKeys = {
  all: ['hr', 'policies'] as const,
  policies: (type: HrPolicyType | null) =>
    ['hr', 'policies', 'list', type] as const,
  policy: (id: string) => ['hr', 'policies', 'one', id] as const,
  people: ['hr', 'policies', 'people'] as const,
};

export function listHrPolicies(
  type: HrPolicyType | null,
): Promise<HrPoliciesResponse> {
  return apiFetch<HrPoliciesResponse>(
    `/hr/policies${type ? `?type=${type}` : ''}`,
  );
}

export function getHrPolicy(id: string): Promise<HrPolicyView> {
  return apiFetch<HrPolicyView>(`/hr/policies/${id}`);
}

export function listPolicyPeople(): Promise<PolicyPeopleResponse> {
  return apiFetch<PolicyPeopleResponse>('/hr/policies/people');
}

export function createHrPolicy(
  input: CreateHrPolicyInput,
): Promise<HrPolicyView> {
  return apiFetch<HrPolicyView>('/hr/policies', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateHrPolicy(
  id: string,
  input: UpdateHrPolicyInput,
): Promise<HrPolicyView> {
  return apiFetch<HrPolicyView>(`/hr/policies/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function archiveHrPolicy(id: string): Promise<void> {
  return apiFetch<void>(`/hr/policies/${id}/archive`, { method: 'POST' });
}
