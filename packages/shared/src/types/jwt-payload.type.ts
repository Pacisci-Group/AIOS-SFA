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
  /**
   * Which generation of this user's credentials the token was signed for
   * (PAC-79). Compared against the live value on every request by
   * `AccessContextGuard`; a mismatch is a 401.
   *
   * This is the only thing that ends an already-issued session. Deactivation
   * works because `AccessResolverService.resolve` returns null for an inactive
   * user, but a password reset leaves the user active — without this counter an
   * attacker's token would keep working until it expired, and their refresh
   * token would keep minting new ones indefinitely.
   *
   * Optional because tokens signed before PAC-79 do not carry it. Every
   * comparison must read it as `?? 0` so those compare equal to a user who has
   * never reset, rather than 401ing the whole estate mid-deploy.
   */
  tokenVersion?: number;
  /**
   * Issued-at, in seconds. Added by `jsonwebtoken` at sign time and passed
   * straight through by `JwtStrategy.validate`; declared here because it is
   * genuinely present, not because anything authorizes off it.
   */
  iat?: number;
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
  /**
   * The role `_id`s this user holds, as strings (PAC-72).
   *
   * Not a permission input — `permissions` above is already the fully-resolved
   * set, and nothing re-derives it from these. This exists for **polymorphic
   * ownership**: an audit assigned to a *role* rather than a user is only
   * reachable by matching the assignee id against the caller's roles, which
   * `buildScopeFilter` cannot do without them. See its `ownerField` option.
   *
   * ⚠ Adding a field to this interface changes what `PermissionCache` has
   * serialized. `RedisPermissionCache`'s key prefix carries a version segment
   * for exactly this reason — bump it, or warm entries deserialize without the
   * new field and every role-assigned record silently disappears from its
   * owner's view.
   */
  roleIds: string[];
  /**
   * The live credential generation, straight off the user document (PAC-79).
   * `AccessContextGuard` rejects a request whose JWT carries an older one.
   *
   * Optional for the reason given on {@link JwtPayload.tokenVersion}, plus one
   * of its own: a warm cache entry written before this field existed
   * deserializes without it. Both sides of the comparison read `?? 0`.
   */
  tokenVersion?: number;
}
