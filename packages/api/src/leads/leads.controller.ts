import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ModuleKey, modulePermission } from '@sfa/shared';
import type { AccessContext } from '@sfa/shared';
import {
  RequireModule,
  RequirePermissions,
  RequireWrite,
} from '../common/decorators/access.decorators';
import { Access, BranchId } from '../common/decorators/user.decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { LeadDetailService } from './lead-detail.service';
import { LeadsService } from './leads.service';
import { listLeadsSchema } from './dto/list-leads.dto';
import type { ListLeadsDto } from './dto/list-leads.dto';
import { createLeadSchema } from './dto/create-lead.dto';
import type { CreateLeadDto } from './dto/create-lead.dto';
import { updateLeadSchema } from './dto/update-lead.dto';
import type { UpdateLeadDto } from './dto/update-lead.dto';

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
  constructor(
    private readonly leadsService: LeadsService,
    private readonly leadDetailService: LeadDetailService,
  ) {}

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

  /*
   * ─── Parameterized routes below this line ──────────────────────────────────
   *
   * `:id` matches anything, so both handlers must stay **after** the static
   * `@Get()` / `@Post()` above — Nest resolves in declaration order.
   *
   * The same hazard exists one level up and is already handled: `ShareLinksModule`
   * (`@Controller('leads/share-links')`) is registered *before* `LeadsModule` in
   * `app.module.ts` so its routes win over `/leads/:id`. Do not reorder either.
   */

  /**
   * The Lead Detail 360° view (PAC-38).
   *
   * Scope is clamped in the service through `LeadAccessService.loadOwnedLead`,
   * which 404s rather than 403s for another producer's lead: whether it exists
   * is not the caller's business.
   */
  @Get(':id')
  detail(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
    @Param('id') id: string,
  ) {
    return this.leadDetailService.get(access, branchId, id);
  }

  /**
   * Inline edits from the Lead Detail page (PAC-38): status, temperature, lead
   * source.
   *
   * Returns only the changed fields in their canonical form rather than a whole
   * `LeadDetail` — re-running the ten-collection assembly on every dropdown
   * change would make an inline edit cost more than the page load.
   */
  @Patch(':id')
  @RequireWrite(ModuleKey.Leads)
  update(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateLeadSchema)) body: UpdateLeadDto,
  ) {
    return this.leadDetailService.update(access, branchId, id, body);
  }
}
