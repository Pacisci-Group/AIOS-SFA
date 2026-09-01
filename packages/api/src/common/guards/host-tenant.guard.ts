import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { HostTenantResolver } from '../tenancy/host-tenant.resolver';
import { AuthenticatedRequest } from '../types/authenticated-request';
import { isPublicRoute } from './guard.utils';

/**
 * Binds an authenticated session to the hostname it is being used on.
 *
 * This is the guard that makes white-labelling a security boundary rather than
 * a coat of paint. Without it, the host would only decide which logo renders:
 * a Texas Holdings user could sign in at `texasholdings.com`, take the access
 * token, and use it against any other agency's hostname — because the token
 * says nothing about where it was minted, and every other guard only asks
 * "which agency is this user in?".
 *
 * ## The rules
 * | Host | Who may use it |
 * |---|---|
 * | an agency's domain | users of **that** agency, and nobody else |
 * | the platform host | platform super admins, **plus** users of an agency that has no domain of its own yet |
 * | anything else | nobody — `404` |
 *
 * Platform admins are rejected on agency hosts on purpose. They have no work to
 * do inside a tenant's branded app, and allowing it would mean the one account
 * that can reach every agency is also the one whose host binding means nothing.
 *
 * ## The platform-host fallback is not a loophole
 * An agency with no domain has **nowhere else to sign in** — its own address
 * does not exist yet. Without the fallback, deploying this would lock every
 * pre-existing agency out of the product, and a newly created agency could
 * never reach the screen where domains are added. The exception closes by
 * itself the instant that agency gets its first active domain, so it cannot be
 * used to bypass the binding: an agency that *has* a host is held to it.
 *
 * ## Unknown hosts answer 404, not 403
 * A 403 would confirm the request reached a live application; a 404 says only
 * that this name serves nothing here. It is also the honest answer: there is no
 * tenant behind that hostname.
 *
 * ## Public routes
 * Skipped, exactly like every other guard in the chain. They are unauthenticated
 * by definition, so there is no session to bind — but note they still see
 * `request.hostTenant`, and each is individually responsible for scoping itself
 * to it (see `TenantBootstrapController`).
 */
@Injectable()
export class HostTenantGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private hostResolver: HostTenantResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (isPublicRoute(this.reflector, context)) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const hostTenant = request.hostTenant;

    // Absent only if the middleware did not run — a wiring mistake, not a
    // request the caller can produce. Failing closed keeps a future refactor
    // that drops the middleware from silently disabling the whole boundary.
    if (!hostTenant || hostTenant.kind === 'unknown') {
      throw new NotFoundException('No application is served on this host');
    }

    const access = request.access;
    if (!access) {
      throw new ForbiddenException('Authentication required');
    }

    if (hostTenant.kind === 'platform') {
      if (access.isPlatformAdmin) {
        return true;
      }
      // The fallback. Cached, so this is a map lookup on all but the first
      // request per agency per minute.
      if (
        access.agencyId &&
        !(await this.hostResolver.agencyHasDomains(access.agencyId))
      ) {
        return true;
      }
      throw new ForbiddenException(
        'Sign in on your agency’s own address to use this account.',
      );
    }

    if (access.isPlatformAdmin || access.agencyId !== hostTenant.agencyId) {
      throw new ForbiddenException('This account is not part of this agency.');
    }

    return true;
  }
}
