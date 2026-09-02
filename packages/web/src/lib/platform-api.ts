import type {
  AgencyAvailabilityResponse,
  ModuleKey,
  OnboardAgencyResponse,
} from '@sfa/shared';
import { apiFetch } from '@/lib/api-client';

/**
 * Platform (Super Admin) endpoints — above the tenant boundary.
 *
 * Everything here is gated on a `platform:*` permission and takes the target
 * agency explicitly, because a platform operator has no `agencyId` of their
 * own. Agency-scoped clients (`users-api`, `branches-api`, …) read the caller's
 * agency instead and are not usable from the panel.
 */

/** One agency, as `GET /platform/agencies` returns it. */
export interface PlatformAgency {
  _id: string;
  name: string;
  slug: string;
  status: string;
  /** Three-letter mailer ticker (`SFA`), when set. */
  ticker?: string;
  /** Allstate agency id (`A0B9049`), cross-checked against uploads. */
  allstateAgencyId?: string;
}

/** Every agency on the platform. Backs the Add Mailers agency picker. */
export function listAgencies() {
  return apiFetch<PlatformAgency[]>('/platform/agencies');
}

/**
 * Is each of these free? Backs the onboarding wizard's inline field checks
 * (PAC-69).
 *
 * Advisory: the operator may still submit, and `onboardAgency` re-checks under
 * the same rules. It exists so the answer arrives while they are still looking
 * at the field rather than five steps later. Every parameter is optional and an
 * omitted one answers `null`.
 *
 * Email availability is **platform-wide** — `User.email` is globally unique —
 * so the copy must not imply "in this agency".
 */
export function checkAgencyAvailability(query: {
  slug?: string;
  email?: string;
  ticker?: string;
}): Promise<AgencyAvailabilityResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value?.trim()) params.set(key, value.trim());
  }
  return apiFetch<AgencyAvailabilityResponse>(
    `/platform/agencies/availability?${params.toString()}`,
  );
}

/** What the wizard collects. Mirrors `onboardAgencySchema` on the API. */
export interface OnboardAgencyInput {
  agency: {
    name: string;
    slug: string;
    ticker?: string;
    allstateAgencyId?: string;
  };
  branch: {
    name: string;
    address: { street?: string; city?: string; state?: string; zip?: string };
  };
  modules: ModuleKey[];
  owner: { firstName: string; lastName: string; email: string };
}

/**
 * Stand up a whole tenant: agency, roles, first branch, audit checklist, and an
 * invited owner (PAC-69).
 *
 * ⚠ A `201` with `owner.emailStatus === 'failed'` is a **success**. The tenant
 * exists and is correct; only the invite email did not get out. Surface it as a
 * warning with a resend, never as a failed onboarding — see
 * `AgencyProvisioningService` for why the server cannot roll back at that point.
 */
export function onboardAgency(
  input: OnboardAgencyInput,
): Promise<OnboardAgencyResponse> {
  return apiFetch<OnboardAgencyResponse>('/platform/agencies', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** Resend the owner's invite. The recovery path for `emailStatus: 'failed'`. */
export function resendOwnerInvite(
  agencyId: string,
): Promise<OnboardAgencyResponse['owner']> {
  return apiFetch<OnboardAgencyResponse['owner']>(
    `/platform/agencies/${agencyId}/owner-invite/resend`,
    { method: 'POST' },
  );
}
