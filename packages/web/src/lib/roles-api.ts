import type { PageLevelOverride } from '@sfa/shared';
import { apiFetch } from '@/lib/api-client';

export interface AgencyRole {
  _id: string;
  agencyId: string;
  name: string;
  slug: string;
  description?: string;
  /**
   * Assembled server-side from the `rolePermissions` join. Unchanged in shape
   * from when it was an array on the role document.
   */
  permissions: string[];
  dataScope: string;
  /** System roles cannot be deleted and their slug cannot change. */
  isSystemTemplate: boolean;
  /**
   * Agency Owner only. Its access is a rule — read+write on every module the
   * agency has enabled — so its page matrix is not editable; the API answers
   * 409.
   */
  grantsAllEnabledModules: boolean;
  /** How many people hold the role. Present on the list endpoint. */
  userCount?: number;
}

/** One permission in the catalog, for rendering an editor over admin capabilities. */
export interface PermissionDefinition {
  _id: string;
  key: string;
  kind: 'module' | 'agency' | 'platform';
  moduleKey: string | null;
  resource: string;
  action: string;
  label: string;
  description: string;
  group: string;
  sortOrder: number;
  assignableToUser: boolean;
  isDeprecated: boolean;
}

export function listRoles() {
  return apiFetch<AgencyRole[]>('/roles');
}

export function getRole(roleId: string) {
  return apiFetch<AgencyRole>(`/roles/${roleId}`);
}

export function updateRoleLevels(roleId: string, levels: PageLevelOverride[]) {
  return apiFetch<AgencyRole>(`/roles/${roleId}`, {
    method: 'PATCH',
    body: JSON.stringify({ levels }),
  });
}

export function listPermissions() {
  return apiFetch<PermissionDefinition[]>('/permissions');
}

export interface RoleInput {
  name: string;
  description?: string;
  dataScope?: string;
}

export function createRole(input: RoleInput) {
  return apiFetch<AgencyRole>('/roles', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** Rename, re-describe, or re-scope. Page levels go through updateRoleLevels. */
export function updateRole(roleId: string, input: Partial<RoleInput>) {
  return apiFetch<AgencyRole>(`/roles/${roleId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

/**
 * Delete a custom role. The API refuses (409) for a system role, the owner
 * role, or one anybody still holds — surface the message rather than
 * pre-computing the rules here.
 */
export function deleteRole(roleId: string) {
  return apiFetch<void>(`/roles/${roleId}`, { method: 'DELETE' });
}
