import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { JwtPayload } from '@sfa/shared';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtPayload => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
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
