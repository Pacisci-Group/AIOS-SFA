import { Controller, Get, Query } from '@nestjs/common';
import {
  type AccessContext,
  type AnalyticsOptionsResponse,
  type AnalyticsSalesSummary,
  ModuleKey,
  modulePermission,
  type SalesBreakdownResponse,
  type SalesTimeseriesResponse,
  type ServiceBreakdownResponse,
  type ServiceSummary,
  type ServiceTimeseriesResponse,
} from '@sfa/shared';
import {
  RequireModule,
  RequirePermissions,
} from '../common/decorators/access.decorators';
import { Access, BranchId } from '../common/decorators/user.decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { AnalyticsOptionsService } from './analytics-options.service';
import {
  salesBreakdownQuerySchema,
  salesSummaryQuerySchema,
  salesTimeseriesQuerySchema,
  serviceBreakdownQuerySchema,
  serviceSummaryQuerySchema,
  serviceTimeseriesQuerySchema,
  type SalesBreakdownQuery,
  type SalesSummaryQuery,
  type SalesTimeseriesQuery,
  type ServiceBreakdownQuery,
  type ServiceSummaryQuery,
  type ServiceTimeseriesQuery,
} from './dto/analytics-query.dto';
import { SalesAnalyticsService } from './sales-analytics.service';
import { ServiceAnalyticsService } from './service-analytics.service';

/**
 * The Analytics page (PAC-152, part 2): sales and service, broken down by any
 * dimension, over time, with goal pacing.
 *
 * `analytics:read` is the whole gate. The Agency Owner holds it through
 * enabled modules, the Branch Manager by template; the owner can grant it to
 * anyone else from the role matrix or a per-user override. `analytics:write`
 * exists because the permission model needs the pair, and grants nothing.
 *
 * Data scope is never bypassed. Sales use the dashboards' clamp (own → own
 * sales); tickets use the CRM's (own → branch). `branchId` narrows an
 * agency-scope caller to one office; anyone else may name only their own
 * branch — `BranchGuard` refuses another with a 403.
 */
@Controller('analytics')
@RequireModule(ModuleKey.Analytics)
@RequirePermissions(modulePermission(ModuleKey.Analytics, 'read'))
export class AnalyticsController {
  constructor(
    private readonly sales: SalesAnalyticsService,
    private readonly service: ServiceAnalyticsService,
    private readonly optionsService: AnalyticsOptionsService,
  ) {}

  /** Branches, producers, assignees and carriers the caller may filter by. */
  @Get('options')
  options(@Access() access: AccessContext): Promise<AnalyticsOptionsResponse> {
    return this.optionsService.options(access);
  }

  /** The sales KPI row, each against its comparison window, plus goal pacing. */
  @Get('sales/summary')
  salesSummary(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
    @Query(new ZodValidationPipe(salesSummaryQuerySchema))
    query: SalesSummaryQuery,
  ): Promise<AnalyticsSalesSummary> {
    return this.sales.summary(access, branchId, query);
  }

  /** Sales grouped by one dimension, optionally split by a second. */
  @Get('sales/breakdown')
  salesBreakdown(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
    @Query(new ZodValidationPipe(salesBreakdownQuerySchema))
    query: SalesBreakdownQuery,
  ): Promise<SalesBreakdownResponse> {
    return this.sales.breakdown(access, branchId, query);
  }

  /** Sales and quotes per day, week or month across the window. */
  @Get('sales/timeseries')
  salesTimeseries(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
    @Query(new ZodValidationPipe(salesTimeseriesQuerySchema))
    query: SalesTimeseriesQuery,
  ): Promise<SalesTimeseriesResponse> {
    return this.sales.timeseries(access, branchId, query);
  }

  /** Tickets opened and resolved in the window, and open work now. */
  @Get('service/summary')
  serviceSummary(
    @Access() access: AccessContext,
    @Query(new ZodValidationPipe(serviceSummaryQuerySchema))
    query: ServiceSummaryQuery,
  ): Promise<ServiceSummary> {
    return this.service.summary(access, query);
  }

  /** Tickets opened in the window, grouped by one dimension. */
  @Get('service/breakdown')
  serviceBreakdown(
    @Access() access: AccessContext,
    @Query(new ZodValidationPipe(serviceBreakdownQuerySchema))
    query: ServiceBreakdownQuery,
  ): Promise<ServiceBreakdownResponse> {
    return this.service.breakdown(access, query);
  }

  /** Tickets opened vs resolved per day, week or month. */
  @Get('service/timeseries')
  serviceTimeseries(
    @Access() access: AccessContext,
    @Query(new ZodValidationPipe(serviceTimeseriesQuerySchema))
    query: ServiceTimeseriesQuery,
  ): Promise<ServiceTimeseriesResponse> {
    return this.service.timeseries(access, query);
  }
}
