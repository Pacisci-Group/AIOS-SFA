import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { runWithRequestContext } from './request-context';

/**
 * Opens the per-request {@link RequestContextStore} for every request.
 *
 * Middleware rather than an interceptor on purpose — see
 * {@link runWithRequestContext}. The store starts empty because Nest runs
 * middleware before guards, so there is no authenticated user yet;
 * `AccessContextGuard` fills in `userId` once it has resolved one.
 *
 * ⚠ Not applied to the Inngest handler, which `main.ts` mounts with
 * `app.use()` outside Nest's router — those writes are the worker's and are
 * correctly attributed to nobody.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(_req: Request, _res: Response, next: NextFunction): void {
    runWithRequestContext(() => next());
  }
}
