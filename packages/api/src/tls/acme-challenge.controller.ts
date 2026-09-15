import {
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../common/decorators/access.decorators';
import { AcmeChallengeService } from './acme-challenge.service';

/**
 * Answers ACME `http-01` validation requests.
 *
 * ## What this endpoint is
 * When we order a certificate for `texasholdings.com`, the CA gives us a token
 * and then fetches `http://texasholdings.com/.well-known/acme-challenge/<token>`
 * over **plain HTTP**, expecting the matching key authorization in the body.
 * Answering correctly is what proves we control the host.
 *
 * ## Why it reads from MongoDB
 * The validation request goes through the load balancer like any other, so it
 * arrives at whichever node the balancer picks — essentially never the node
 * whose worker placed the order. A token held in process memory or on local
 * disk means the CA hits a node that has never heard of it and gets a 404, so
 * every issuance fails intermittently in a way that looks exactly like flaky
 * DNS. Shared storage is what makes this work on more than one node, and it is
 * the single detail that a naive port of a single-server design gets wrong.
 *
 * ## Four things about this route that are deliberate
 *
 * 1. **`@Public()`** — the request is unauthenticated by definition, and it
 *    arrives on a hostname that resolves to no tenant yet. `HostTenantGuard`
 *    404s unknown hosts for exactly the right reasons; a challenge for a domain
 *    being verified for the first time is the one case that must get past it.
 * 2. **`@SkipThrottle()`** — `TrustedProxyThrottlerGuard` runs first and
 *    globally. Behind a TLS-passthrough load balancer, before PROXY protocol is
 *    wired through, every caller shares one bucket — and a throttled validation
 *    request means no certificate, for everyone, until someone works out why.
 *    The surface being skipped is a single indexed lookup returning one short
 *    string, with no write and nothing enumerable: guessing a token is guessing
 *    128 bits.
 * 3. **Excluded from the global `api/v1` prefix** (see `main.ts`). RFC 8555
 *    fixes this path at the root; there is no version of it that lives under an
 *    API prefix.
 * 4. **Served over plain HTTP.** The whole point is to answer before a
 *    certificate exists, so this must never be behind an HTTPS redirect. The
 *    edge carves this path out ahead of its redirect for that reason.
 *
 * ## In deployed environments the edge answers this, not the API
 * The edge's upstream is the `web` container, whose nginx has an SPA fallback —
 * a challenge proxied through would come back as `index.html` with a 200, which
 * the CA reads as the wrong key authorization while everything looks healthy.
 * So the edge answers from the database directly, through the same
 * {@link AcmeChallengeService} this controller uses.
 *
 * This route still matters: it is what serves the local dev loop, where
 * requests arrive on port 4000 with no edge in front.
 */
@Controller('.well-known/acme-challenge')
export class AcmeChallengeController {
  constructor(private readonly challenges: AcmeChallengeService) {}

  /**
   * ⚠ Do not add logging of the token or the response here. The key
   * authorization is the secret half of the exchange, and an access log that
   * captured it would hand anyone with log access the ability to complete a
   * challenge on our account.
   */
  @Public()
  @SkipThrottle()
  @Get(':token')
  @Header('Content-Type', 'text/plain')
  async respond(@Param('token') token: string): Promise<string> {
    const keyAuthorization = await this.challenges.keyAuthorizationFor(token);

    if (!keyAuthorization) throw new NotFoundException();

    return keyAuthorization;
  }
}
