import { Controller, Get, Query } from '@nestjs/common';
import { ModuleKey, modulePermission } from '@sfa/shared';
import type { AccessContext } from '@sfa/shared';
import {
  RequireModule,
  RequirePermissions,
} from '../common/decorators/access.decorators';
import { Access, BranchId } from '../common/decorators/user.decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { ownerDashboardQuerySchema } from './dto/owner-dashboard-query.dto';
import type { OwnerDashboardQueryDto } from './dto/owner-dashboard-query.dto';
import { OwnerDashboardService } from './owner-dashboard.service';

/**
 * The Owner View dashboard — "Strategy Hub" (PAC-135).
 *
 * Three reads, one query schema: the page promises that its KPI row, its
 * leaderboard and its lead-source table agree, and sharing the schema is what
 * stops them being asked different questions.
 *
 * ## Why this is not `leaderboard:read`
 *
 * `GET /leaderboard` is deliberately **aggregates only** — a producer sees ranks
 * and attainment, never a colleague's dollars, and the e2e suite asserts it.
 * The owner's leaderboard *is* per-producer dollars, so it lives behind
 * `owner_dashboard:read` instead of widening a contract producers rely on.
 *
 * Read-only by design: every figure is a projection of `deals`, `policies`,
 * `quoteRecaps` and `leads`. `DataScope` is enforced in the service.
 */
@Controller('owner-dashboard')
@RequireModule(ModuleKey.OwnerDashboard)
@RequirePermissions(modulePermission(ModuleKey.OwnerDashboard, 'read'))
export class OwnerDashboardController {
  constructor(private readonly service: OwnerDashboardService) {}

  /** The KPI row, each figure with its comparison window. */
  @Get('summary')
  summary(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
    @Query(new ZodValidationPipe(ownerDashboardQuerySchema))
    query: OwnerDashboardQueryDto,
  ) {
    return this.service.summary(access, branchId, query);
  }

  /** The producer leaderboard, ranked by premium. */
  @Get('producers')
  producers(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
    @Query(new ZodValidationPipe(ownerDashboardQuerySchema))
    query: OwnerDashboardQueryDto,
  ) {
    return this.service.producers(access, branchId, query);
  }

  /** The lead-source matrix: volume, premium, premium conversion. */
  @Get('lead-sources')
  leadSources(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
    @Query(new ZodValidationPipe(ownerDashboardQuerySchema))
    query: OwnerDashboardQueryDto,
  ) {
    return this.service.leadSourceMatrix(access, branchId, query);
  }
}
