import { ModuleKey } from '../enums/module-key.enum';

/** Platform-level permissions (Super Admin only). */
export const PlatformPermission = {
  AgenciesRead: 'platform:agencies:read',
  AgenciesWrite: 'platform:agencies:write',
  ModulesToggle: 'platform:modules:toggle',
  /**
   * Read mailer import runs in the Super Admin panel (PAC-73).
   *
   * ⚠ Distinct from the agency-facing `mailers:read` **module** permission that
   * PAC-61's drawer uses. That one is a page inside an agency's own app and is
   * filtered by the agency's module entitlements; this is a platform capability
   * and bypasses that filter entirely (see `resolvePermissionSet`). Granting
   * one never implies the other.
   */
  MailersRead: 'platform:mailers:read',
  /** Upload an RTP file and commit the mailers it produces (PAC-73). */
  MailersWrite: 'platform:mailers:write',
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
  /**
   * See field-level edit history on the activity timeline (PAC-65 #9).
   *
   * Editing a recorded quote or a booked policy stays open to everyone who can
   * write one — the product owner was explicit that a lock is the wrong answer
   * to the transparency concern. This is the log that answers it instead, and
   * producers must not see it.
   *
   * **Why it lives in the `agency:` namespace rather than as a third verb on a
   * module.** It is a capability, not a page, and the machinery only tolerates
   * `read`/`write` as a module's second segment:
   * - `permission-model.spec.ts` asserts every page permission is `{m}:read|write`;
   * - `RolesService.updateLevels` preserves only `agency:`/`platform:` strings
   *   when an owner edits the role matrix, so a `leads:changelog:read` would be
   *   **silently dropped** the first time someone touched that screen;
   * - `resolvePermissionSet`'s enabled-module filter would read `changelogs:` as
   *   a module key and drop a standalone string entirely.
   *
   * ⚠ `grantsAllEnabledModules` expands only `{m}:read`/`{m}:write`, so this
   * reaches the Agency Owner through `DEFAULT_ROLE_TEMPLATES` — not through
   * that flag — and an already-seeded agency needs `npm run api:sync:roles`.
   */
  ChangeLogsRead: 'agency:changelogs:read',
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
