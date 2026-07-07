import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccessScope, JwtPayload } from '@sfa/shared';
import { SKIP_TENANT_KEY } from '../decorators/access.decorators';
import { isPublicRoute } from './guard.utils';

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (isPublicRoute(this.reflector, context)) {
      return true;
    }

    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_TENANT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as JwtPayload | undefined;
    if (!user) {
      throw new ForbiddenException('Authentication required');
    }

    if (user.isPlatformAdmin || user.scope === AccessScope.Platform) {
      const routeAgencyId =
        request.params?.agencyId ??
        request.query?.agencyId ??
        request.body?.agencyId;
      request.resolvedAgencyId = routeAgencyId ?? user.agencyId ?? null;
      return true;
    }

    if (!user.agencyId) {
      throw new ForbiddenException('Agency context required');
    }

    const routeAgencyId =
      request.params?.agencyId ??
      request.query?.agencyId ??
      request.body?.agencyId;

    if (routeAgencyId && routeAgencyId !== user.agencyId) {
      throw new ForbiddenException('Access denied for this agency');
    }

    request.resolvedAgencyId = user.agencyId;
    return true;
  }
}
