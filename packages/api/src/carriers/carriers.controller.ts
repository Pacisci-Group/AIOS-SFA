import { Controller, Get } from '@nestjs/common';
import { ModuleKey, modulePermission } from '@sfa/shared';
import type { AccessContext } from '@sfa/shared';
import {
  RequireAnyModule,
  RequireAnyPermission,
} from '../common/decorators/access.decorators';
import { Access } from '../common/decorators/user.decorators';
import { CarriersService } from './carriers.service';

/**
 * Carrier catalog (PAC-56 #19) — the vocabulary behind the Sold wizard's
 * carrier select (#18) and its per-carrier policy-number rules (#20).
 *
 * ## Why this is gated on `deal_audits` rather than a `carriers` module
 *
 * The list exists to serve the Sold form, so it carries the Sold form's gate —
 * the same argument `PoliciesController` makes for `/policies/check`. A
 * dedicated `ModuleKey.Carriers` would add a row to the permission matrix
 * (`PAGES` is one entry per module key) for something that is not a page, and
 * would give every agency a second switch that can silently break the wizard.
 *
 * ⚠ Same consequence as `/policies/check` and `/sold-deals`: disabling the
 * `deal_audits` module for an agency also disables this list, and therefore the
 * carrier select. Consistent with the rest of the sold path rather than new.
 *
 * Curation is **not** here. Super-admin CRUD belongs at `platform/carriers`
 * under `platform:*` and agency-owner CRUD under `agency:*`; the schema already
 * accommodates both. See `carrier.schema.ts`.
 */
/*
 * Reachable from **either** policy-writing surface (PAC-32/33's OR gate).
 *
 * The Sold form is `deal_audits`; the CSR's Policy Transfer is `crm_service`,
 * and a CSR holds no `deal_audits` at all. Both wizards hard-block when this
 * list fails to load — deliberately, since there is no free-text carrier
 * fallback — so without the second permission the transfer is unusable by the
 * one role it exists for.
 *
 * Widening the gate rather than the CSR role, per the PAC-32/33 write-up: this
 * is a catalog read behind two pages, not a new page.
 */
@Controller('carriers')
@RequireAnyModule(ModuleKey.DealAudits, ModuleKey.CrmService)
@RequireAnyPermission(
  modulePermission(ModuleKey.DealAudits, 'read'),
  modulePermission(ModuleKey.CrmService, 'read'),
)
export class CarriersController {
  constructor(private readonly carriersService: CarriersService) {}

  /**
   * Every carrier this agency can pick: platform globals plus its own rows,
   * active only, in display order.
   */
  @Get()
  list(@Access() access: AccessContext) {
    return this.carriersService.list(access.agencyId);
  }
}
