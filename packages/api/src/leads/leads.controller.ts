import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ModuleKey, modulePermission } from '@sfa/shared';
import type { AccessContext } from '@sfa/shared';
import {
  RequireModule,
  RequirePermissions,
  RequireWrite,
} from '../common/decorators/access.decorators';
import { Access, BranchId } from '../common/decorators/user.decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { LeadsService } from './leads.service';
import { listLeadsSchema } from './dto/list-leads.dto';
import type { ListLeadsDto } from './dto/list-leads.dto';
import { createLeadSchema } from './dto/create-lead.dto';
import type { CreateLeadDto } from './dto/create-lead.dto';

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

  /**
   * Create a lead from the New Lead form (PAC-37).
   *
   * `@RequireWrite` overrides the class-level read requirement — both guards
   * resolve metadata with `getAllAndOverride([handler, class])`, so the
   * handler's value wins.
   *
   * The created lead is assigned to the caller, whatever their role. `leads:write`
   * is also held by Agency Owner and Branch Manager, so a manager doing data
   * entry becomes the lead's producer; that matches legacy, which stamped the
   * current user with no role check, and is accepted for now (see PAC-53).
   */
  @Post()
  @RequireWrite(ModuleKey.Leads)
  create(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
    @Body(new ZodValidationPipe(createLeadSchema)) body: CreateLeadDto,
  ) {
    return this.leadsService.create(access, branchId, body);
  }
}
