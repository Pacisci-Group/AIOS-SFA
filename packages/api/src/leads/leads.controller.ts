import { Controller, Get, Query } from '@nestjs/common';
import { ModuleKey, modulePermission } from '@sfa/shared';
import type { AccessContext } from '@sfa/shared';
import {
  RequireModule,
  RequirePermissions,
} from '../common/decorators/access.decorators';
import { Access, BranchId } from '../common/decorators/user.decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { LeadsService } from './leads.service';
import { listLeadsSchema } from './dto/list-leads.dto';
import type { ListLeadsDto } from './dto/list-leads.dto';

/**
 * Leads list (PAC-36) — the read path behind the `/leads` page.
 *
 * Gated by the `leads` module + `leads:read`. `DataScope` is enforced in the
 * service layer: a producer (`own`) only ever sees their own leads, whatever
 * `scope` or `producerId` the query asks for.
 */
@Controller('leads')
@RequireModule(ModuleKey.Leads)
@RequirePermissions(modulePermission(ModuleKey.Leads, 'read'))
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  @Get()
  list(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
    @Query(new ZodValidationPipe(listLeadsSchema))
    query: ListLeadsDto,
  ) {
    return this.leadsService.list(access, branchId, query);
  }
}
