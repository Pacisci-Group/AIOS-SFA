import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../common/decorators/access.decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  HOUR_MS,
  MINUTE_MS,
  PUBLIC_FORM_RATE_LIMIT,
  PUBLIC_INTAKE_HOURLY_LIMIT,
  PUBLIC_INTAKE_RATE_LIMIT,
} from '../config/rate-limit.config';
import { publicCreateLeadSchema } from '../leads/dto/create-lead.dto';
import type { PublicCreateLeadDto } from '../leads/dto/create-lead.dto';
import { PublicLeadsService } from './public-leads.service';

/**
 * The unauthenticated intake surface (PAC-37).
 *
 * ⚠ `@Public()` is on the **class**, and this class holds exactly two handlers
 * for that reason. `isPublicRoute` resolves the flag with
 * `getAllAndOverride([handler, class])`, so a handler with no decorator of its
 * own inherits the class value — meaning **any** method added here becomes
 * world-reachable, with `request.access` undefined and all six global guards
 * bypassed, and there is no way to opt a single handler back out. Anything that
 * needs authentication belongs on `ShareLinksController`.
 */
@Controller('public')
@Public()
export class PublicLeadsController {
  constructor(private readonly publicLeadsService: PublicLeadsService) {}

  /**
   * Render data for the public form.
   *
   * Looser than the submit limit on purpose: this returns only an agency name,
   * and someone filling in a form on a phone will reload it. Locking them out
   * of the page would cost a lead and protect nothing.
   */
  @Get('lead-form/:token')
  @Throttle({ short: { limit: PUBLIC_FORM_RATE_LIMIT, ttl: MINUTE_MS } })
  getForm(@Param('token') token: string) {
    return this.publicLeadsService.getFormInfo(token);
  }

  /**
   * Submit a lead through a share link.
   *
   * Two windows: the per-minute limit stops a burst, the hourly one catches a
   * slow drip that would sit under it all day.
   */
  @Post('leads/:token')
  @Throttle({
    short: { limit: PUBLIC_INTAKE_RATE_LIMIT, ttl: MINUTE_MS },
    long: { limit: PUBLIC_INTAKE_HOURLY_LIMIT, ttl: HOUR_MS },
  })
  submit(
    @Param('token') token: string,
    @Body(new ZodValidationPipe(publicCreateLeadSchema))
    body: PublicCreateLeadDto,
  ) {
    return this.publicLeadsService.submit(token, body);
  }
}
