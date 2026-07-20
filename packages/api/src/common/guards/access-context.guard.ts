import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtPayload } from '@sfa/shared';
import { AccessResolverService } from '../../permissions/access-resolver.service';
import { isPublicRoute } from './guard.utils';

/**
 * Runs immediately after authentication. Resolves the user's live authorization
 * context from the backend store (DB, optionally cached) and attaches it to
 * `request.access`. Every downstream guard reads from there instead of the JWT,
 * so permission changes and de-provisioning take effect on the next request.
 *
 * A missing/deactivated user resolves to `null` here and is rejected — this is
 * how revocation works even while a signed access token is still valid.
 */
@Injectable()
export class AccessContextGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private accessResolver: AccessResolverService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (isPublicRoute(this.reflector, context)) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const jwt = request.user as JwtPayload | undefined;
    if (!jwt?.sub) {
      throw new UnauthorizedException('Authentication required');
    }

    const access = await this.accessResolver.resolve(jwt.sub);
    if (!access) {
      throw new UnauthorizedException('User is inactive or no longer exists');
    }

    request.access = access;
    return true;
  }
}
