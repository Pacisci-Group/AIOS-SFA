import { Navigate, Outlet } from 'react-router-dom';
import { usePermissions } from '@/hooks/usePermissions';

interface RequirePermissionProps {
  /** Exact permission required to render the nested routes. */
  permission?: string;
  /**
   * Multi-permission (OR) gate: passes when the user holds at least one of
   * these. Use for pages whose data legitimately belongs to more than one
   * module — e.g. household/policy records render both on the Clients pages
   * and inside the CRM service-ticket detail.
   */
  anyOf?: string[];
  /** Where to send users who lack the permission. */
  redirectTo?: string;
}

/**
 * Route guard that only renders nested routes when the user holds the required
 * permission(s). Used to keep owner-only pages hidden from other roles.
 *
 * When both `permission` and `anyOf` are supplied, both checks must pass.
 */
export function RequirePermission({
  permission,
  anyOf,
  redirectTo = '/',
}: RequirePermissionProps) {
  const { can, canAny } = usePermissions();

  const allowed =
    (permission ? can(permission) : true) && (anyOf ? canAny(anyOf) : true);

  if (!allowed) {
    return <Navigate to={redirectTo} replace />;
  }

  return <Outlet />;
}
