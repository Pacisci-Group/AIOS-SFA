import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ModuleKey, modulePermission } from '@sfa/shared';
import {
  RequireAnyModule,
  RequireAnyPermission,
} from '../common/decorators/access.decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  ADDRESS_LOOKUP_RATE_LIMIT,
  MINUTE_MS,
} from '../config/rate-limit.config';
import { AddressService } from './address.service';
import {
  addressAutocompleteSchema,
  addressResolveSchema,
} from './dto/address-lookup.dto';
import type {
  AddressAutocompleteDto,
  AddressResolveDto,
} from './dto/address-lookup.dto';

/**
 * Google-backed address lookup for the app's address fields (PAC-60).
 *
 * ## Why there is no `ModuleKey.Address`
 *
 * Same argument `CarriersController` makes for the carrier catalog. `PAGES` is
 * one entry per module key, so a dedicated key would add a row to the
 * permission matrix for something that is not a page, and hand every agency a
 * switch that silently breaks address entry on four different forms. Nobody
 * should ever be asked whether their agency has "addresses" enabled.
 *
 * ## Why the gate is an OR of four, not one module
 *
 * Address entry is not owned by one page. A producer types one on the New Lead
 * form (`leads`), a Quote Recap author on the policy drawer (`quote_recaps`),
 * a producer again in the Sold wizard's escrow card (`deal_audits`), and a CSR
 * in Policy Transfer (`crm_service`) — and a CSR holds no `deal_audits` at all.
 * Gating on any single key would 403 at least one of those, on a control whose
 * only job is to save typing.
 *
 * `write`, not `read`: this exists to help someone **fill in** a form. A
 * read-only user has no address to type.
 *
 * ## Data scope
 *
 * None applies. Nothing here reads or writes a tenant record — the response is
 * third-party data derived from what the caller just typed — so there is
 * nothing for `common/access/scope-filter.ts` to narrow. The agency's identity
 * never reaches Google.
 *
 * ⚠ The Google API key is server-side only and is never present in any
 * response or any client bundle. That is the entire reason these two calls are
 * proxied rather than made from the browser.
 */
@Controller('address')
@RequireAnyModule(
  ModuleKey.Leads,
  ModuleKey.QuoteRecaps,
  ModuleKey.DealAudits,
  ModuleKey.CrmService,
)
@RequireAnyPermission(
  modulePermission(ModuleKey.Leads, 'write'),
  modulePermission(ModuleKey.QuoteRecaps, 'write'),
  modulePermission(ModuleKey.DealAudits, 'write'),
  modulePermission(ModuleKey.CrmService, 'write'),
)
export class AddressController {
  constructor(private readonly addressService: AddressService) {}

  /**
   * Predictions for a partially-typed address.
   *
   * Always `200`. See `AddressService` on why this fails open — check
   * `available` in the body, not the status.
   */
  @Post('autocomplete')
  /*
   * POST for privacy (see the DTO), but this creates nothing — Nest's 201
   * default would be a lie, and the client checks `available` rather than the
   * status precisely because the status is always 200.
   */
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { limit: ADDRESS_LOOKUP_RATE_LIMIT, ttl: MINUTE_MS } })
  autocomplete(
    @Body(new ZodValidationPipe(addressAutocompleteSchema))
    body: AddressAutocompleteDto,
  ) {
    return this.addressService.autocomplete(body.input, body.sessionToken);
  }

  /**
   * Turn a chosen prediction into `{ street, city, state, zip }`, and terminate
   * the billing session the autocomplete keystrokes opened.
   */
  @Post('resolve')
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { limit: ADDRESS_LOOKUP_RATE_LIMIT, ttl: MINUTE_MS } })
  resolve(
    @Body(new ZodValidationPipe(addressResolveSchema)) body: AddressResolveDto,
  ) {
    return this.addressService.resolve(body.placeId, body.sessionToken);
  }
}
