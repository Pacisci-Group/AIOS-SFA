import type {
  CreateTimeOffPolicyInput,
  PolicyPeopleResponse,
  TimeOffPoliciesResponse,
  TimeOffPolicyType,
  TimeOffPolicyView,
  UpdateTimeOffPolicyInput,
} from '@sfa/shared';
import { apiFetch } from '@/lib/api-client';

/**
 * Time off policies (PAC-161 v3) — Settings → Time off. Every call is
 * `agency:hr:admin`; the page is gated on the same permission.
 */

export const hrKeys = {
  all: ['hr', 'policies'] as const,
  policies: (type: TimeOffPolicyType | null) =>
    ['hr', 'policies', 'list', type] as const,
  policy: (id: string) => ['hr', 'policies', 'one', id] as const,
  people: ['hr', 'policies', 'people'] as const,
};

export function listTimeOffPolicies(
  type: TimeOffPolicyType | null,
): Promise<TimeOffPoliciesResponse> {
  return apiFetch<TimeOffPoliciesResponse>(
    `/hr/policies${type ? `?type=${type}` : ''}`,
  );
}

export function getTimeOffPolicy(id: string): Promise<TimeOffPolicyView> {
  return apiFetch<TimeOffPolicyView>(`/hr/policies/${id}`);
}

export function listPolicyPeople(): Promise<PolicyPeopleResponse> {
  return apiFetch<PolicyPeopleResponse>('/hr/policies/people');
}

export function createTimeOffPolicy(
  input: CreateTimeOffPolicyInput,
): Promise<TimeOffPolicyView> {
  return apiFetch<TimeOffPolicyView>('/hr/policies', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateTimeOffPolicy(
  id: string,
  input: UpdateTimeOffPolicyInput,
): Promise<TimeOffPolicyView> {
  return apiFetch<TimeOffPolicyView>(`/hr/policies/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function archiveTimeOffPolicy(id: string): Promise<void> {
  return apiFetch<void>(`/hr/policies/${id}/archive`, { method: 'POST' });
}
