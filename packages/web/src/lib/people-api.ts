import type {
  CompleteOnboardingInput,
  EnrolMemberInput,
  HrPolicyView,
  PersonProfileView,
  UpdatePersonFactsInput,
} from '@sfa/shared';
import { apiFetch } from '@/lib/api-client';

/**
 * The People profile (PAC-162): one read, and the writes the page offers.
 *
 * The read is on the users controller and answers for the person themself
 * or an `agency:users:read` holder, omitting the sections the viewer may
 * not see; the writes are HR's (`agency:hr:admin`). The list itself is
 * `listUsers` in `users-api.ts` — its rows carry the same `status`.
 */

export const peopleKeys = {
  profile: (userId: string) => ['people', 'profile', userId] as const,
};

export function getPersonProfile(userId: string): Promise<PersonProfileView> {
  return apiFetch<PersonProfileView>(`/users/${userId}/profile`);
}

/** `PATCH /hr/people/:userId` — name halves, phone, hire date, birthday. */
export function updatePersonFacts(
  userId: string,
  input: UpdatePersonFactsInput,
): Promise<PersonProfileView> {
  return apiFetch<PersonProfileView>(`/hr/people/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

/** Pending → Active, enrolling in the chosen policies first. `409` once complete. */
export function completeOnboarding(
  userId: string,
  input: CompleteOnboardingInput,
): Promise<PersonProfileView> {
  return apiFetch<PersonProfileView>(
    `/hr/people/${userId}/onboarding/complete`,
    { method: 'POST', body: JSON.stringify(input) },
  );
}

/** One person into a policy; a time off policy posts the starting balance. */
export function enrolMember(
  policyId: string,
  input: EnrolMemberInput,
): Promise<HrPolicyView> {
  return apiFetch<HrPolicyView>(`/hr/policies/${policyId}/members`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** One person out of a policy; the ledger stays, so the balance resumes if re-added. */
export function removeMember(policyId: string, userId: string): Promise<void> {
  return apiFetch<void>(`/hr/policies/${policyId}/members/${userId}`, {
    method: 'DELETE',
  });
}
