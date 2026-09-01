import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccessResolverService } from '../../permissions/access-resolver.service';
import { setRequestUserId } from '../context/request-context';
import { AuthenticatedRequest } from '../types/authenticated-request';
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

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const jwt = request.user;
    if (!jwt?.sub) {
      throw new UnauthorizedException('Authentication required');
    }

    const access = await this.accessResolver.resolve(jwt.sub);
    if (!access) {
      throw new UnauthorizedException('User is inactive or no longer exists');
    }

    /*
     * The only thing that ends an already-issued session (PAC-79). Deactivation
     * is handled above — `resolve` returns null for an inactive user — but a
     * password reset leaves the user active, so without this a token stolen
     * before the reset would keep working until it expired.
     *
     * ⚠ Both sides read `?? 0` on purpose. A token signed before PAC-79 has no
     * claim, and a cache entry written before PAC-79 deserializes without the
     * field; comparing `undefined` to `0` would 401 the entire estate for the
     * length of a rolling deploy. Reading both as 0 makes those cases compare
     * equal, and only a real bump — which invalidates the cache as it happens —
     * produces a mismatch.
     */
    if ((jwt.tokenVersion ?? 0) !== (access.tokenVersion ?? 0)) {
      throw new UnauthorizedException(
        'Your password was changed. Please sign in again.',
      );
    }

    request.access = access;
    /*
     * The earliest point an acting user is known. `RequestContextMiddleware`
     * opened the store before any guard ran — middleware always precedes guards
     * in Nest — so it is sitting there empty waiting for this (PAC-72).
     *
     * Attribution only. Nothing authorizes off the ambient store; every guard
     * below reads `request.access`.
     */
    setRequestUserId(access.userId);
    return true;
  }
}
