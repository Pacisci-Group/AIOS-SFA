import type { IncomingHttpHeaders } from 'http';
import type { AccessContext, JwtPayload } from '@sfa/shared';
import type { HostTenant } from '../tenancy/host-tenant.resolver';

/**
 * The request object as the guard chain builds it up: `HostTenantMiddleware`
 * attaches `hostTenant`, `JwtAuthGuard` attaches `user`, `AccessContextGuard`
 * attaches `access`, and `TenantGuard`/`BranchGuard` attach the resolved ids
 * that `@AgencyId()`/`@BranchId()` read back.
 *
 * Guards and param decorators pass this to `getRequest<T>()` instead of leaning
 * on its `any` default, so the whole chain stays type-checked. `params`, `query`
 * and `body` stay `unknown`-valued on purpose — they are attacker-controlled at
 * this point and must be narrowed before use (see `asIdString`).
 */
export interface AuthenticatedRequest {
  headers: IncomingHttpHeaders;
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
  user?: JwtPayload;
  access?: AccessContext;
  resolvedAgencyId?: string | null;
  resolvedBranchId?: string | null;
  /**
   * Which tenant the request's `Host` names, resolved once per request by
   * `HostTenantMiddleware`.
   *
   * ⚠ Derived from a **client-controlled header**. Safe to use to *restrict*
   * (see `HostTenantGuard`) and to pick branding; never safe as the sole basis
   * for granting access to data — that is what `access.agencyId` is for.
   */
  hostTenant?: HostTenant;
}
