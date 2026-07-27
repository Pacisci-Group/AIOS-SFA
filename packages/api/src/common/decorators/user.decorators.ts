import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AccessContext, JwtPayload } from '@sfa/shared';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtPayload => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);

/**
 * The fully-resolved authorization context attached by `AccessContextGuard`
 * (`request.access`). Source of truth for userId / dataScope / branch used for
 * data-scope filtering in feature services.
 */
export const Access = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AccessContext => {
    const request = ctx.switchToHttp().getRequest();
    return request.access;
  },
);

export const AgencyId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | null => {
    const request = ctx.switchToHttp().getRequest();
    return request.resolvedAgencyId ?? request.user?.agencyId ?? null;
  },
);

export const BranchId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | null => {
    const request = ctx.switchToHttp().getRequest();
    return request.resolvedBranchId ?? request.user?.branchId ?? null;
  },
);
