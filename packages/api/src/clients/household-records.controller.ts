import { Controller, Get, Param, Query } from '@nestjs/common';
import { ModuleKey, modulePermission } from '@sfa/shared';
import type { AccessContext } from '@sfa/shared';
import {
  RequireAnyModule,
  RequireAnyPermission,
} from '../common/decorators/access.decorators';
import { Access } from '../common/decorators/user.decorators';
import { ClientsService } from './clients.service';
import { SearchRecordsQueryDto } from './dto/search-records.dto';

/**
 * Household record reads.
 *
 * Households render on the Clients pages AND inside the CRM service-ticket
 * detail (the ticket's Household drawer), so either page permission grants
 * access — a CSR holding only `crm_service:read` can open the drawer without
 * being given the Clients page. Gating stays page-level: there is no
 * per-record or ticket-linkage check. Results are scoped by the service.
 *
 * Named `HouseholdRecordsController` because the stub feature controller
 * already exports `HouseholdsController` for `GET /households`.
 */
@Controller('households')
@RequireAnyModule(ModuleKey.Clients, ModuleKey.CrmService)
@RequireAnyPermission(
  modulePermission(ModuleKey.Clients, 'read'),
  modulePermission(ModuleKey.CrmService, 'read'),
)
export class HouseholdRecordsController {
  constructor(private readonly clientsService: ClientsService) {}

  /** Typeahead for the ticket-create household picker. Declared before `:id`. */
  @Get('search')
  search(
    @Access() access: AccessContext,
    @Query() query: SearchRecordsQueryDto,
  ) {
    return this.clientsService.searchHouseholds(
      access,
      query.q ?? '',
      query.limit,
    );
  }

  @Get(':id')
  findOne(@Access() access: AccessContext, @Param('id') id: string) {
    return this.clientsService.getHousehold(access, id);
  }
}
