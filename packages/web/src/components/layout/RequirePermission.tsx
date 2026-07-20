import { Navigate, Outlet } from 'react-router-dom';
import { usePermissions } from '@/hooks/usePermissions';

interface RequirePermissionProps {
  permission: string;
  /** Where to send users who lack the permission. */
  redirectTo?: string;
}

/**
 * Route guard that only renders nested routes when the user holds the given
 * permission. Used to keep owner-only pages hidden from other roles.
 */
export function RequirePermission({
  permission,
  redirectTo = '/',
}: RequirePermissionProps) {
  const { can } = usePermissions();

  if (!can(permission)) {
    return <Navigate to={redirectTo} replace />;
  }

  return <Outlet />;
}
