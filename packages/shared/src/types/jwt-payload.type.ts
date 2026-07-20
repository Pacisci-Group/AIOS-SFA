import { AccessScope } from '../enums/scope.enum';
import { DataScope } from '../permissions/default-role-templates';

/**
 * Claims carried inside the signed JWT. Intentionally slim: only stable
 * identity/tenant claims live here. The effective permission set and data scope
 * are NOT part of the token — they are resolved from the backend store on every
 * request (see {@link AccessContext}) so permission/role changes and user
 * de-provisioning take effect without waiting for the token to expire.
 */
export interface JwtPayload {
  sub: string;
  agencyId: string | null;
  branchId: string | null;
  scope: AccessScope;
  isPlatformAdmin: boolean;
}

/**
 * The fully-resolved authorization context for a request. Built from the
 * database (optionally cached) by the API on each authenticated request and
 * attached to `request.access`. This — not the JWT — is the source of truth for
 * all guard decisions.
 */
export interface AccessContext {
  userId: string;
  agencyId: string | null;
  branchId: string | null;
  isPlatformAdmin: boolean;
  scope: AccessScope;
  dataScope: DataScope;
  permissions: string[];
}
