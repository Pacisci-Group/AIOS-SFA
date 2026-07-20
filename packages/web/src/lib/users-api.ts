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

export function listUsers() {
  return apiFetch<AgencyUser[]>('/users');
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
