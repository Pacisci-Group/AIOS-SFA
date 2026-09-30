import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
} from '@nestjs/common';
import { ModuleKey, modulePermission } from '@sfa/shared';
import type { AccessContext } from '@sfa/shared';
import { Types } from 'mongoose';
import {
  RequireModule,
  RequirePermissions,
} from '../common/decorators/access.decorators';
import { Access, BranchId } from '../common/decorators/user.decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  managementAlertListQuerySchema,
  managementDashboardQuerySchema,
} from './dto/management-dashboard-query.dto';
import type {
  ManagementAlertListQueryDto,
  ManagementDashboardQueryDto,
} from './dto/management-dashboard-query.dto';
import { ManagementDashboardService } from './management-dashboard.service';

/**
 * The Manager View dashboard — "Action Hub" (PAC-139).
 *
 * Six reads, one filter, no writes. The page is a summary — "checks and
 * balances" in David's words — so there is deliberately nothing here that
 * approves, resolves or edits; the Deal Audits page (PAC-106) is where that
 * lives. Replaces the `{ status: 'ready' }` stub that served `management`
 * from `feature.controllers.ts`.
 *
 * Gated on `management:read`. The Branch Manager template carries it since
 * this ticket; their `DataScope` is `branch`, and every read here starts from
 * the same scope clamp the Owner view uses, so a branch manager sees their
 * branch and the owner the agency.
 */
@Controller('management-dashboard')
@RequireModule(ModuleKey.Management)
@RequirePermissions(modulePermission(ModuleKey.Management, 'read'))
export class ManagementDashboardController {
  constructor(private readonly service: ManagementDashboardService) {}

  /** The three alert cards. */
  @Get('alerts')
  alerts(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
    @Query(new ZodValidationPipe(managementDashboardQuerySchema))
    query: ManagementDashboardQueryDto,
  ) {
    return this.service.alerts(access, branchId, query);
  }

  /** The Stalled Leads drawer. */
  @Get('alerts/stalled-leads')
  stalledLeads(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
    @Query(new ZodValidationPipe(managementAlertListQuerySchema))
    query: ManagementAlertListQueryDto,
  ) {
    return this.service.stalledLeads(access, branchId, query);
  }

  /** The Aging Audits drawer. */
  @Get('alerts/aging-audits')
  agingAudits(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
    @Query(new ZodValidationPipe(managementAlertListQuerySchema))
    query: ManagementAlertListQueryDto,
  ) {
    return this.service.agingAudits(access, branchId, query);
  }

  /** The Overdue Tickets drawer. */
  @Get('alerts/overdue-tickets')
  overdueTickets(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
    @Query(new ZodValidationPipe(managementAlertListQuerySchema))
    query: ManagementAlertListQueryDto,
  ) {
    return this.service.overdueTickets(access, branchId, query);
  }

  /** The Team Activity table. */
  @Get('team')
  team(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
    @Query(new ZodValidationPipe(managementDashboardQuerySchema))
    query: ManagementDashboardQueryDto,
  ) {
    return this.service.team(access, branchId, query);
  }

  /** The producer drawer: the row's figures, the pipeline, the open items. */
  @Get('producers/:producerId')
  producer(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
    @Param('producerId') producerId: string,
    @Query(new ZodValidationPipe(managementDashboardQuerySchema))
    query: ManagementDashboardQueryDto,
  ) {
    if (!Types.ObjectId.isValid(producerId)) {
      throw new BadRequestException('producerId must be a record id');
    }
    return this.service.producer(access, branchId, producerId, query);
  }
}
