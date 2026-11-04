import type { EmployeeProfileStatus, PeopleStatus } from '@sfa/shared';

/** The two account fields the status reads — `User` or a lean row of it. */
export interface AccountStatusFields {
  isActive: boolean;
  deactivatedAt?: Date | null;
}

/**
 * The status a person shows on the People list (PAC-162), derived **once,
 * here**, from the account and the employee profile together:
 *
 * | Account                       | Profile    | Status               |
 * |-------------------------------|------------|----------------------|
 * | `deactivatedAt` set           | any        | `deactivated`        |
 * | `isActive: false`, not removed| any        | `invited`            |
 * | active                        | `active`   | `active`             |
 * | active                        | otherwise  | `pending_onboarding` |
 *
 * The account wins: a removed person reads Deactivated whatever the profile
 * says, and an invited person reads Invited even when HR onboarded them
 * before they accepted (they flip straight to Active on acceptance). A
 * missing profile reads as pending — defensive; the seams and the migration
 * make it unreachable.
 *
 * The web used to derive a three-way status itself from `isActive` +
 * `deactivatedAt`; that function is gone, and every row carries this value,
 * so the badge, the row menu and the facet cannot disagree.
 */
export function peopleStatus(
  account: AccountStatusFields,
  profile: { status: EmployeeProfileStatus } | null | undefined,
): PeopleStatus {
  if (account.deactivatedAt) return 'deactivated';
  if (!account.isActive) return 'invited';
  return profile?.status === 'active' ? 'active' : 'pending_onboarding';
}
