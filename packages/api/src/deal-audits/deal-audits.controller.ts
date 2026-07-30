import { Controller, Get, Query } from '@nestjs/common';
import { ModuleKey, modulePermission } from '@sfa/shared';
import type { AccessContext } from '@sfa/shared';
import {
  RequireModule,
  RequirePermissions,
} from '../common/decorators/access.decorators';
import { Access, BranchId } from '../common/decorators/user.decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { DealAuditsService } from './deal-audits.service';
import { listDealAuditsSchema } from './dto/list-deal-audits.dto';
import type { ListDealAuditsDto } from './dto/list-deal-audits.dto';

/**
 * Deals Pending Service Hand-off board (read).
 *
 * Page is gated by `dashboard:read` (route level, on the web). This API is
 * separately gated by the `deal_audits` module + `deal_audits:read`, and
 * enforces the caller's `DataScope` in the service layer.
 */
@Controller('deal-audits')
@RequireModule(ModuleKey.DealAudits)
@RequirePermissions(modulePermission(ModuleKey.DealAudits, 'read'))
export class DealAuditsController {
  constructor(private readonly dealAuditsService: DealAuditsService) {}

  @Get()
  list(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
    @Query(new ZodValidationPipe(listDealAuditsSchema))
    query: ListDealAuditsDto,
  ) {
    return this.dealAuditsService.listPendingHandoff(access, branchId, query);
  }
}
