import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AccessContext, JwtPayload } from '@sfa/shared';
import type { HostTenant as ResolvedHostTenant } from '../tenancy/host-tenant.resolver';
import { AuthenticatedRequest } from '../types/authenticated-request';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtPayload | undefined => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.user;
  },
);

/**
 * The live, DB-resolved authorization context for the request. Populated by
 * `AccessContextGuard` (from the store, not the JWT), so it always reflects the
 * user's current permissions and data scope. Use this to enforce `DataScope`
 * narrowing in services (e.g. filter to `own` records by `access.userId`).
 */
export const Access = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AccessContext => {
    const request = ctx.switchToHttp().getRequest<{ access: AccessContext }>();
    return request.access;
  },
);

/**
 * Which tenant the request's hostname names, as resolved by
 * `HostTenantMiddleware`.
 *
 * ⚠ Derived from the client-controlled `Host` header. Read it to decide what to
 * *show* (branding) or to *restrict* (`HostTenantGuard`); never to decide what a
 * caller may read or write — `@Access()` is the authority for that.
 *
 * Always defined on a routed request, but typed optional so a handler cannot
 * quietly assume otherwise if the middleware is ever scoped to fewer routes.
 */
export const HostTenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ResolvedHostTenant | undefined => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.hostTenant;
  },
);

export const AgencyId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | null => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.resolvedAgencyId ?? request.user?.agencyId ?? null;
  },
);

export const BranchId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | null => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.resolvedBranchId ?? request.user?.branchId ?? null;
  },
);
