import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { HostTenantResolver } from '../tenancy/host-tenant.resolver';
import type { AuthenticatedRequest } from '../types/authenticated-request';

/**
 * Resolves the request's `Host` to a tenant, once, and hangs the answer on the
 * request.
 *
 * Middleware rather than a guard because `@Public()` routes need it too — the
 * login form and the branding bootstrap are both unauthenticated and both have
 * to know which agency's host they are being served from. Guards would skip
 * them; middleware runs for everything Nest routes.
 *
 * ## Which header
 * `Host`, via Express's `req.hostname`, not `X-Forwarded-Host`. The edge
 * (Caddy) and the web container's nginx both forward the original `Host`
 * untouched (`proxy_set_header Host $host`), so it arrives here intact, and
 * preferring a forwarded header would mean trusting a value that anything on
 * the path could set independently.
 *
 * Resolution is cached inside `HostTenantResolver`, so this is a map lookup on
 * the overwhelming majority of requests.
 */
@Injectable()
export class HostTenantMiddleware implements NestMiddleware {
  constructor(private readonly resolver: HostTenantResolver) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    // `req.hostname` already strips the port; `normalizeHostname` inside the
    // resolver handles the rest and the cases Express does not (trailing dot,
    // a proxy that passed the value through verbatim).
    (req as unknown as AuthenticatedRequest).hostTenant =
      await this.resolver.resolve(req.hostname ?? req.headers.host);
    next();
  }
}
