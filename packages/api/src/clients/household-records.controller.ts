import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ModuleKey, modulePermission } from '@sfa/shared';
import type { AccessContext } from '@sfa/shared';
import {
  RequireAnyModule,
  RequireAnyPermission,
  RequirePermissions,
  RequireWrite,
} from '../common/decorators/access.decorators';
import { Access } from '../common/decorators/user.decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { ClientsService } from './clients.service';
import { addHouseholdMemberSchema } from './dto/add-household-member.dto';
import type { AddHouseholdMemberDto } from './dto/add-household-member.dto';
import { listHouseholdsSchema } from './dto/list-households.dto';
import type { ListHouseholdsDto } from './dto/list-households.dto';
import { SearchRecordsQueryDto } from './dto/search-records.dto';

/**
 * Household records: reads for either client-facing page, plus the one write
 * the Household page owns.
 *
 * Households render on the Clients pages AND inside the CRM service-ticket
 * detail (the ticket's Household drawer), so either page permission grants
 * read access — a CSR holding only `crm_service:read` can open the drawer
 * without being given the Clients page. Gating stays page-level: there is no
 * per-record or ticket-linkage check. Results are scoped by the service.
 *
 * The write is narrower on purpose. `@RequireWrite` replaces the AND-set only,
 * so adding a member needs `clients:write` **and** still satisfies the
 * class-level OR-set — `crm_service:read` alone cannot reach it.
 *
 * Named `HouseholdRecordsController` for what was once a real conflict: the
 * generated `HouseholdsController` stub held `GET /households`. PAC-89 replaced
 * that stub with the list handler below and de-registered it. The name stays —
 * renaming a controller to match a resolved history is churn.
 */
@Controller('households')
@RequireAnyModule(ModuleKey.Clients, ModuleKey.CrmService)
@RequireAnyPermission(
  modulePermission(ModuleKey.Clients, 'read'),
  modulePermission(ModuleKey.CrmService, 'read'),
)
export class HouseholdRecordsController {
  constructor(private readonly clientsService: ClientsService) {}

  /**
   * The Clients list page (PAC-89).
   *
   * Narrower than the rest of this controller on purpose. `@RequirePermissions`
   * sets the AND-set, and metadata override is per-key, so it composes with the
   * class-level OR-set instead of replacing it — the effective requirement
   * becomes `clients:read`. That is what keeps a CSR holding only
   * `crm_service:read` out of the client index while leaving `:id` and the
   * ticket's Household drawer reachable, which is the whole reason the OR gate
   * exists.
   */
  @Get()
  @RequirePermissions(modulePermission(ModuleKey.Clients, 'read'))
  list(
    @Access() access: AccessContext,
    @Query(new ZodValidationPipe(listHouseholdsSchema))
    query: ListHouseholdsDto,
  ) {
    return this.clientsService.listHouseholds(access, query);
  }

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

  /**
   * Add a household member — the "+ Member" dialog. Returns the new member as
   * a `ContactSummary`, the same shape `GET /households/:id` lists them in.
   */
  @Post(':id/members')
  @RequireWrite(ModuleKey.Clients)
  addMember(
    @Access() access: AccessContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(addHouseholdMemberSchema))
    body: AddHouseholdMemberDto,
  ) {
    return this.clientsService.addHouseholdMember(access, id, body);
  }
}
