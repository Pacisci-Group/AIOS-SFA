import { useMemo } from 'react';
import { useAuth } from '@/contexts/auth-context';

const OWNER_PERMISSION = 'agency:users:permissions';

export interface UsePermissions {
  permissions: Set<string>;
  /** Exact permission-string check (used for `agency:*` admin capabilities). */
  can: (permission: string) => boolean;
  canAny: (permissions: string[]) => boolean;
  canAll: (permissions: string[]) => boolean;
  /** True when the user can view a page (read, or write which implies read). */
  canRead: (moduleKey: string) => boolean;
  /** True when the user can edit / take write actions on a page. */
  canWrite: (moduleKey: string) => boolean;
  /** Agency owners hold the users-permissions capability. */
  isOwner: boolean;
}

export function usePermissions(): UsePermissions {
  const { user } = useAuth();

  return useMemo(() => {
    const permissions = new Set(user?.permissions ?? []);
    const can = (permission: string) => permissions.has(permission);

    return {
      permissions,
      can,
      canAny: (list: string[]) => list.some((p) => permissions.has(p)),
      canAll: (list: string[]) => list.every((p) => permissions.has(p)),
      canRead: (moduleKey: string) =>
        permissions.has(`${moduleKey}:read`) ||
        permissions.has(`${moduleKey}:write`),
      canWrite: (moduleKey: string) => permissions.has(`${moduleKey}:write`),
      isOwner: permissions.has(OWNER_PERMISSION),
    };
  }, [user]);
}
