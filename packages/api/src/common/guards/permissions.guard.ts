import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRE_PERMISSIONS_KEY } from '../decorators/access.decorators';
import { AuthenticatedRequest } from '../types/authenticated-request';
import { isPublicRoute } from './guard.utils';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (isPublicRoute(this.reflector, context)) {
      return true;
    }

    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      REQUIRE_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredPermissions?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const access = request.access;
    if (!access) {
      throw new ForbiddenException('Authentication required');
    }

    const userPermissions = new Set(access.permissions ?? []);
    const hasAll = requiredPermissions.every((permission) =>
      userPermissions.has(permission),
    );
    if (!hasAll) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}
