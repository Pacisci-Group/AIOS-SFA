import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccessContext } from '@sfa/shared';
import {
  REQUIRE_ANY_PERMISSIONS_KEY,
  REQUIRE_PERMISSIONS_KEY,
} from '../decorators/access.decorators';
import { isPublicRoute } from './guard.utils';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (isPublicRoute(this.reflector, context)) {
      return true;
    }

    // AND-set: every listed permission is required.
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      REQUIRE_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    // OR-set: at least one listed permission is required. Used for data that
    // renders on more than one page (see `@RequireAnyPermission`).
    const anyPermissions = this.reflector.getAllAndOverride<string[]>(
      REQUIRE_ANY_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPermissions?.length && !anyPermissions?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const access = request.access as AccessContext | undefined;
    if (!access) {
      throw new ForbiddenException('Authentication required');
    }

    const userPermissions = new Set(access.permissions ?? []);

    // When both sets are declared, both must be satisfied.
    if (
      requiredPermissions?.length &&
      !requiredPermissions.every((permission) =>
        userPermissions.has(permission),
      )
    ) {
      throw new ForbiddenException('Insufficient permissions');
    }

    if (
      anyPermissions?.length &&
      !anyPermissions.some((permission) => userPermissions.has(permission))
    ) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}
