import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../common/decorators/access.decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  HOUR_MS,
  MINUTE_MS,
  PUBLIC_ADDRESS_HOURLY_LIMIT,
  PUBLIC_ADDRESS_RATE_LIMIT,
} from '../config/rate-limit.config';
import {
  addressAutocompleteSchema,
  addressResolveSchema,
} from './dto/address-lookup.dto';
import type {
  AddressAutocompleteDto,
  AddressResolveDto,
} from './dto/address-lookup.dto';
import { PublicAddressService } from './public-address.service';

/**
 * Address autocomplete on the unauthenticated intake form (PAC-60).
 *
 * ⚠ `@Public()` is on the **class**, and this class holds exactly two handlers
 * for that reason. `isPublicRoute` resolves the flag with
 * `getAllAndOverride([handler, class])`, so a handler with no decorator of its
 * own inherits the class value — meaning **any** method added here becomes
 * world-reachable, with `request.access` undefined and all six global guards
 * bypassed, and there is no way to opt a single handler back out. Anything that
 * needs authentication belongs on `AddressController`.
 *
 * Routed at `public/address/...`, which shares no literal first segment with
 * `PublicLeadsController`'s `lead-form/:token` and `leads/:token`, so the two
 * cannot shadow each other.
 *
 * Every request re-verifies the share link by hand and consumes one unit of its
 * daily allowance — see `PublicAddressService`.
 */
@Controller('public/address')
@Public()
export class PublicAddressController {
  constructor(private readonly publicAddress: PublicAddressService) {}

  @Post(':token/autocomplete')
  @HttpCode(HttpStatus.OK)
  @Throttle({
    short: { limit: PUBLIC_ADDRESS_RATE_LIMIT, ttl: MINUTE_MS },
    long: { limit: PUBLIC_ADDRESS_HOURLY_LIMIT, ttl: HOUR_MS },
  })
  autocomplete(
    @Param('token') token: string,
    @Body(new ZodValidationPipe(addressAutocompleteSchema))
    body: AddressAutocompleteDto,
  ) {
    return this.publicAddress.autocomplete(
      token,
      body.input,
      body.sessionToken,
    );
  }

  @Post(':token/resolve')
  @HttpCode(HttpStatus.OK)
  @Throttle({
    short: { limit: PUBLIC_ADDRESS_RATE_LIMIT, ttl: MINUTE_MS },
    long: { limit: PUBLIC_ADDRESS_HOURLY_LIMIT, ttl: HOUR_MS },
  })
  resolve(
    @Param('token') token: string,
    @Body(new ZodValidationPipe(addressResolveSchema)) body: AddressResolveDto,
  ) {
    return this.publicAddress.resolve(token, body.placeId, body.sessionToken);
  }
}
