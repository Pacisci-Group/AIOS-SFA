import type { PageLevelOverride } from '@sfa/shared';
import { apiFetch } from '@/lib/api-client';

export interface AgencyUserRole {
  _id: string;
  name: string;
  slug: string;
}

export interface AgencyUser {
  _id: string;
  agencyId: string | null;
  branchId: string | null;
  email: string;
  firstName?: string;
  lastName?: string;
  isActive: boolean;
  /**
   * ISO-8601 when the user was removed from the agency; null otherwise.
   *
   * ⚠ `isActive: false` on its own is ambiguous — it covers both a pending
   * invite and a removed employee. Use {@link userStatus} rather than reading
   * `isActive` directly, or an ex-employee renders as "Invited" and gets offered
   * a "Resend invite" button.
   */
  deactivatedAt: string | null;
  isPlatformAdmin: boolean;
  roleIds: AgencyUserRole[];
  createdAt?: string;
  updatedAt?: string;
}

export type UserStatus = 'active' | 'invited' | 'deactivated';

/**
 * The single place the three-way status is derived.
 *
 * Extracted rather than inlined because the badge, both row-action components
 * and the empty-state copy all need it, and a nested ternary repeated four times
 * is how one of them ends up disagreeing with the others.
 */
export function userStatus(user: AgencyUser): UserStatus {
  if (user.deactivatedAt) return 'deactivated';
  return user.isActive ? 'active' : 'invited';
}

/** What a removal put back into the unassigned queue. */
export interface ReleasedWork {
  ticketsUnassigned: number;
  rotationsDeactivated: number;
}

export interface AgencyUserDetail extends AgencyUser {
  /** Effective permissions after role defaults + owner overrides. */
  effectivePermissions: string[];
  /** Permissions the user would have from roles alone (no overrides). */
  roleDefaultPermissions: string[];
}

export interface InviteUserInput {
  email: string;
  /**
   * The invite form assigns exactly one role (PAC-58), but the wire contract is
   * an array — `PATCH /users/:userId/roles` is already many-per-user, and the
   * two endpoints should not disagree about the shape.
   */
  roleIds: string[];
  branchId?: string;
  firstName?: string;
  lastName?: string;
}

export interface InviteResponse {
  userId: string;
  /** Absolute accept-invite URL. */
  inviteUrl: string;
  /** ISO-8601. */
  expiresAt: string;
  /**
   * **Dev/test only — absent in production.** Email delivery is still a stub
   * (see the API's `MailService`), so outside production the server hands back
   * the raw token to make the flow walkable. Never build a feature on it.
   */
  inviteToken?: string;
}

export function listUsers() {
  return apiFetch<AgencyUser[]>('/users');
}

export function inviteUser(input: InviteUserInput) {
  return apiFetch<InviteResponse>('/users/invite', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** Regenerate the token and send again. Invalidates the previous link. */
export function resendInvite(userId: string) {
  return apiFetch<InviteResponse>(`/users/${userId}/invite/resend`, {
    method: 'POST',
  });
}

/** Revoke a pending invite. The invited row disappears from the directory. */
export function revokeInvite(userId: string) {
  return apiFetch<void>(`/users/${userId}/invite`, { method: 'DELETE' });
}

/**
 * Remove an employee from the agency.
 *
 * Deactivates rather than deletes: their history stays attributed to a real
 * name, and access is revoked on their very next request. Returns what was
 * released back to the unassigned queue.
 */
export function deactivateUser(userId: string) {
  return apiFetch<ReleasedWork>(`/users/${userId}`, { method: 'DELETE' });
}

/** Restore a removed employee. Does not restore the work released on removal. */
export function reactivateUser(userId: string) {
  return apiFetch<AgencyUserDetail>(`/users/${userId}/reactivate`, {
    method: 'POST',
  });
}

export function getUser(userId: string) {
  return apiFetch<AgencyUserDetail>(`/users/${userId}`);
}

export function updateUserPermissions(
  userId: string,
  overrides: PageLevelOverride[],
) {
  return apiFetch<AgencyUserDetail>(`/users/${userId}/permissions`, {
    method: 'PATCH',
    body: JSON.stringify({ overrides }),
  });
}
