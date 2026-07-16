import { ModuleKey } from '../enums/module-key.enum';

/** Platform-level permissions (Super Admin only). */
export const PlatformPermission = {
  AgenciesRead: 'platform:agencies:read',
  AgenciesWrite: 'platform:agencies:write',
  ModulesToggle: 'platform:modules:toggle',
} as const;

/** Agency administration permissions (Agency Owner manages users/branches). */
export const AgencyPermission = {
  /** View system role templates when assigning roles to users. */
  RolesRead: 'agency:roles:read',
  /** Edit a role's permission set. */
  RolesWrite: 'agency:roles:write',
  UsersRead: 'agency:users:read',
  UsersWrite: 'agency:users:write',
  UsersPermissions: 'agency:users:permissions',
  BranchesRead: 'agency:branches:read',
  BranchesWrite: 'agency:branches:write',
} as const;

export type ModuleAction = 'read' | 'write';

export function modulePermission(
  module: ModuleKey | string,
  action: ModuleAction,
): string {
  return `${module}:${action}`;
}

export function permissionsForModule(
  module: ModuleKey | string,
  actions: ModuleAction[] = ['read', 'write'],
): string[] {
  return actions.map((action) => modulePermission(module, action));
}

export const ALL_PLATFORM_PERMISSIONS = Object.values(PlatformPermission);
export const ALL_AGENCY_ADMIN_PERMISSIONS = Object.values(AgencyPermission);

export function moduleFromPermission(permission: string): string | null {
  if (permission.startsWith('platform:') || permission.startsWith('agency:')) {
    return null;
  }
  const [module] = permission.split(':');
  return module ?? null;
}

export function isPlatformPermission(permission: string): boolean {
  return permission.startsWith('platform:');
}

export function isAgencyAdminPermission(permission: string): boolean {
  return permission.startsWith('agency:');
}
