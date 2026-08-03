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
import {
  createSoldDealSchema,
  soldDealContextSchema,
} from './dto/create-sold-deal.dto';
import type {
  CreateSoldDealDto,
  SoldDealContextDto,
} from './dto/create-sold-deal.dto';
import { SoldDealsService } from './sold-deals.service';

/**
 * Sold form (PAC-40) — the 8-card wizard's write path.
 *
 * ## Why `deal_audits` and not `clients`
 *
 * The Producer role template grants `leads`, `quote_recaps` and `deal_audits`
 * — and no `clients:*`, which is where the generated `DealsController` stub
 * sits. Gating the sold write path there would mean **no producer could record
 * a sale**, which is the blocking problem this story opened with.
 *
 * `deal_audits` is the honest choice of the permissions a producer already
 * holds: the submission's entire purpose is generating the post-sale audit that
 * feeds the hand-off board, and Branch Manager / CRM / Agency Owner all hold it
 * too (unlike `quote_recaps`, which Branch Manager lacks).
 *
 * ⚠ Consequence: disabling the `deal_audits` module for an agency also disables
 * sold submission.
 *
 * `DataScope` is enforced in the service layer — a producer (`own`) can only
 * record a sale against their own lead, and gets a 404 rather than a 403 for
 * anyone else's.
 */
@Controller('sold-deals')
@RequireModule(ModuleKey.DealAudits)
@RequirePermissions(modulePermission(ModuleKey.DealAudits, 'read'))
export class SoldDealsController {
  constructor(private readonly soldDealsService: SoldDealsService) {}

  // Static segments are declared first: Nest matches in declaration order, so
  // any future `@Get(':id')` must come after these or it will swallow them.

  /** Lead + household header and the driver picker's contact list. */
  @Get('context')
  getContext(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
    @Query(new ZodValidationPipe(soldDealContextSchema))
    query: SoldDealContextDto,
  ) {
    return this.soldDealsService.getLeadContext(access, branchId, query);
  }

  /**
   * Record the sale: the deal, every policy, and the prior-insurance records,
   * atomically. Totals are derived server-side from the policy rows.
   */
  @Post()
  @RequireWrite(ModuleKey.DealAudits)
  create(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
    @Body(new ZodValidationPipe(createSoldDealSchema)) body: CreateSoldDealDto,
  ) {
    return this.soldDealsService.create(access, branchId, body);
  }
}
