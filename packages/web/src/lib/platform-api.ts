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
