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
 * Policy record reads. Gated identically to `HouseholdRecordsController`:
 * policies render both on the Clients pages and in the ticket detail's Policy
 * drawer, so `clients:read` OR `crm_service:read` grants access.
 */
@Controller('policies')
@RequireAnyModule(ModuleKey.Clients, ModuleKey.CrmService)
@RequireAnyPermission(
  modulePermission(ModuleKey.Clients, 'read'),
  modulePermission(ModuleKey.CrmService, 'read'),
)
export class PolicyRecordsController {
  constructor(private readonly clientsService: ClientsService) {}

  /** Typeahead for the ticket-create policy picker. Declared before `:id`. */
  @Get('search')
  search(
    @Access() access: AccessContext,
    @Query() query: SearchRecordsQueryDto,
  ) {
    return this.clientsService.searchPolicies(
      access,
      query.q ?? '',
      query.limit,
    );
  }

  @Get(':id')
  findOne(@Access() access: AccessContext, @Param('id') id: string) {
    return this.clientsService.getPolicy(access, id);
  }
}
