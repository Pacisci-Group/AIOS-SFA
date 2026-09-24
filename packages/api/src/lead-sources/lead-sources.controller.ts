import { Controller, Get } from '@nestjs/common';
import { ModuleKey, modulePermission } from '@sfa/shared';
import type { AccessContext } from '@sfa/shared';
import {
  RequireAnyModule,
  RequireAnyPermission,
} from '../common/decorators/access.decorators';
import { Access } from '../common/decorators/user.decorators';
import { LeadSourcesService } from './lead-sources.service';

/**
 * Lead-source catalog (PAC-135) — the vocabulary behind the lead form's source
 * select, the Leads filter, and the Owner dashboard's lead-source filter.
 *
 * ## Why there is no `lead_sources` module key
 *
 * The argument `CarriersController` makes: this is a catalog read behind pages
 * that already have gates, not a page. A module key of its own would add a row
 * to the permission matrix and hand every agency a switch that silently empties
 * the lead form's dropdown.
 *
 * So it carries the gate of whichever surface is asking — `leads` for the forms
 * and the Leads page, `owner_dashboard` for the owner's filter, since an account
 * can hold the dashboard without the Leads module (the Data Team template does).
 *
 * Curation is **not** here; see `lead-source.schema.ts`.
 */
@Controller('lead-sources')
@RequireAnyModule(ModuleKey.Leads, ModuleKey.OwnerDashboard)
@RequireAnyPermission(
  modulePermission(ModuleKey.Leads, 'read'),
  modulePermission(ModuleKey.OwnerDashboard, 'read'),
)
export class LeadSourcesController {
  constructor(private readonly leadSourcesService: LeadSourcesService) {}

  /** Platform sources plus this agency's own, active only, in display order. */
  @Get()
  list(@Access() access: AccessContext) {
    return this.leadSourcesService.list(access.agencyId);
  }
}
