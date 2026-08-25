import type { PageLevelOverride } from '@sfa/shared';
import { apiFetch } from '@/lib/api-client';

export interface AgencyRole {
  _id: string;
  agencyId: string;
  name: string;
  slug: string;
  description?: string;
  permissions: string[];
  dataScope: string;
  isSystemTemplate: boolean;
  grantsAllEnabledModules: boolean;
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
