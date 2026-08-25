import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccessScope } from '@sfa/shared';
import { SKIP_TENANT_KEY } from '../decorators/access.decorators';
import { AuthenticatedRequest } from '../types/authenticated-request';
import { asIdString, isPublicRoute } from './guard.utils';

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

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const access = request.access;
    if (!access) {
      throw new ForbiddenException('Authentication required');
    }

    if (access.isPlatformAdmin || access.scope === AccessScope.Platform) {
      const routeAgencyId: unknown =
        request.params?.agencyId ??
        request.query?.agencyId ??
        request.body?.agencyId;
      request.resolvedAgencyId =
        asIdString(routeAgencyId) ?? access.agencyId ?? null;
      return true;
    }

    if (!access.agencyId) {
      throw new ForbiddenException('Agency context required');
    }

    const routeAgencyId: unknown =
      request.params?.agencyId ??
      request.query?.agencyId ??
      request.body?.agencyId;

    if (routeAgencyId && routeAgencyId !== access.agencyId) {
      throw new ForbiddenException('Access denied for this agency');
    }

    request.resolvedAgencyId = access.agencyId;
    return true;
  }
}
