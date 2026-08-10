import { Controller, Get, Query } from '@nestjs/common';
import { ModuleKey, modulePermission } from '@sfa/shared';
import type { AccessContext } from '@sfa/shared';
import {
  RequireModule,
  RequirePermissions,
} from '../common/decorators/access.decorators';
import { Access, BranchId } from '../common/decorators/user.decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { getPerformanceSchema } from './dto/get-performance.dto';
import type { GetPerformanceDto } from './dto/get-performance.dto';
import { PerformanceService } from './performance.service';

/**
 * Sold + Quoted scorecards (PAC-10 / PAC-11).
 *
 * The page is gated by `dashboard:read` on the web route; this API is gated by
 * the `performance` module. Read-only by design — there is no mutating handler,
 * because nothing about a scorecard is editable: it is a projection of `deals`
 * and `quoteRecaps`. `DataScope` is enforced in the service layer, so a
 * producer (`own`) only ever aggregates their own rows.
 */
@Controller('performance')
@RequireModule(ModuleKey.Performance)
@RequirePermissions(modulePermission(ModuleKey.Performance, 'read'))
export class PerformanceController {
  constructor(private readonly performanceService: PerformanceService) {}

  @Get()
  get(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
    @Query(new ZodValidationPipe(getPerformanceSchema))
    query: GetPerformanceDto,
  ) {
    return this.performanceService.get(access, branchId, query);
  }
}
