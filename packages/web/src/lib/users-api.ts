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
  isPlatformAdmin: boolean;
  roleIds: AgencyUserRole[];
  createdAt?: string;
  updatedAt?: string;
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
