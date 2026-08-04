import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/** The parts of an Express request we use to identify a caller. */
interface ProxiedRequest {
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
}

/**
 * Rate-limit tracker that understands the load balancer in front of us.
 *
 * In production the API sits behind DigitalOcean's LB, so `req.ip` is the
 * balancer's address for every caller — without this, the entire internet
 * shares a single rate-limit bucket and the public intake form is either
 * unusable or unprotected. The real client is the first entry in
 * `X-Forwarded-For`.
 *
 * Preferred over `app.set('trust proxy', ...)` in `main.ts` because the
 * behaviour is explicit, local to rate limiting, and directly testable.
 *
 * Note the header is client-controlled and only trustworthy because our LB
 * rewrites it. That is fine for rate limiting — spoofing it lets an attacker
 * evade their *own* limit, not raise anyone else's — but this value must never
 * be used for authorization or audit.
 */
@Injectable()
export class TrustedProxyThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, unknown>): Promise<string> {
    const request = req as ProxiedRequest;
    const forwarded = request.headers?.['x-forwarded-for'];
    const firstHeader = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    const clientIp = firstHeader?.split(',')[0]?.trim();

    return Promise.resolve(
      clientIp || request.ip || request.socket?.remoteAddress || 'unknown',
    );
  }
}
