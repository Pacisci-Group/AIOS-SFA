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
import { presignSoldDocumentSchema } from './dto/presign-sold-document.dto';
import type { PresignSoldDocumentDto } from './dto/presign-sold-document.dto';
import { SoldDealsService } from './sold-deals.service';

/**
 * Sold form (PAC-40) — the wizard's write path.
 *
 * ## Why `deal_audits` and not `clients`
 *
 * The submission's entire purpose is generating the post-sale audit that feeds
 * the hand-off board, so `deal_audits` describes what this endpoint actually
 * does — and Branch Manager / CRM / Agency Owner all hold it too (unlike
 * `quote_recaps`, which Branch Manager lacks).
 *
 * The original reason was narrower: the Producer template granted no `clients:*`
 * at all, so gating the sold write path where the generated `DealsController`
 * stub sits would have meant no producer could record a sale. PAC-38 has since
 * added `clients:write` to that template for contact editing, so that argument
 * no longer holds — but the gate stays here regardless, because matching the
 * endpoint's own purpose is the durable reason.
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
   * The agency's staff, for the "Cancelled by → SFA staff" picker (PAC-65 #11).
   *
   * Rides this controller's own `deal_audits:read` gate. `GET /users` would be
   * the obvious home, but it is gated on `agency:users:read`, which a Producer
   * does not hold — so the producer filling this form would 403 on their own
   * picker. Declared with the other static segments, above any future `:id`.
   */
  @Get('staff')
  listStaff(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
  ) {
    return this.soldDealsService.listStaff(access, branchId);
  }

  /**
   * Issue a presigned URL for a sold-form document (a discount proof, or the
   * receipt, student transcript).
   *
   * Lead-scoped, not deal-scoped: the upload happens while the wizard is still
   * being filled in, so no deal exists yet.
   */
  @Post('documents/presign')
  @RequireWrite(ModuleKey.DealAudits)
  presignDocument(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
    @Body(new ZodValidationPipe(presignSoldDocumentSchema))
    body: PresignSoldDocumentDto,
  ) {
    return this.soldDealsService.presignDocument(access, branchId, body);
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
