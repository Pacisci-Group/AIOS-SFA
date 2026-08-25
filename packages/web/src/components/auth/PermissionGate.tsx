import type { ReactNode } from 'react';
import { usePermissions } from '@/hooks/usePermissions';

interface PermissionGateProps {
  /** Single permission required to render the children. */
  permission?: string;
  /** Render when the user holds ANY of these permissions. */
  anyOf?: string[];
  /** Render when the user holds ALL of these permissions. */
  allOf?: string[];
  /** Optional fallback when the user lacks the permission (defaults to nothing). */
  fallback?: ReactNode;
  children: ReactNode;
}

/**
 * Renders children only when the user holds the required permission(s).
 * A missing permission simply hides the content — no error is shown.
 */
export function PermissionGate({
  permission,
  anyOf,
  allOf,
  fallback = null,
  children,
}: PermissionGateProps) {
  const { can, canAny, canAll } = usePermissions();

  const allowed =
    (permission ? can(permission) : true) &&
    (anyOf ? canAny(anyOf) : true) &&
    (allOf ? canAll(allOf) : true);

  return <>{allowed ? children : fallback}</>;
}
