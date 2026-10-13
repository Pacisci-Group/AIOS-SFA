import { Controller, Get, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { VapidPublicKeyResponse } from '@sfa/shared';
import { Public } from '../common/decorators/access.decorators';

/**
 * The VAPID public key (PAC-154, PR4) — what a browser hands to
 * `pushManager.subscribe()` as `applicationServerKey`.
 *
 * Its own controller, as `PublicDomainsController` is: a `@Public()` route
 * sitting in a class whose every other handler is authenticated is how a
 * `@Public()` gets copied onto the wrong handler later. The key is public by
 * definition — it is in every subscription the browser creates — so there is
 * nothing to protect here; what matters is that the web app can read it
 * before, and independently of, any session.
 *
 * `404` when the key is not configured. The opt-in switch hides itself on
 * that answer, so an environment without push simply has no switch rather
 * than a switch that fails.
 */
@Controller('public/push')
export class PublicNotificationsController {
  constructor(private readonly config: ConfigService) {}

  @Public()
  @Get('vapid-public-key')
  vapidPublicKey(): VapidPublicKeyResponse {
    const publicKey = this.config.get<string>('VAPID_PUBLIC_KEY');
    if (!publicKey) {
      throw new NotFoundException('Web push is not configured');
    }
    return { publicKey };
  }
}
