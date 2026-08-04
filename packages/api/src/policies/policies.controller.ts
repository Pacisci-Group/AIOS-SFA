import { Controller, Get, Query } from '@nestjs/common';
import { ModuleKey, modulePermission } from '@sfa/shared';
import type { AccessContext } from '@sfa/shared';
import {
  RequireModule,
  RequirePermissions,
} from '../common/decorators/access.decorators';
import { Access, BranchId } from '../common/decorators/user.decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { checkPolicySchema } from './dto/check-policy.dto';
import type { CheckPolicyDto } from './dto/check-policy.dto';
import { PoliciesService } from './policies.service';

/**
 * Policies (PAC-40) — currently only the Sold wizard's duplicate check.
 *
 * ## Why this is gated on `deal_audits`
 *
 * This route exists solely to serve Card 3 of the Sold form, and the Sold
 * write path is gated on `deal_audits` because that is the permission a
 * Producer actually holds — the role template grants no `clients:*`, which is
 * where `DealsController` sits. Gating the check on anything a producer lacks
 * would make the dedupe silently unavailable to the only people who use it.
 *
 * A future *general* Policies read API (a household's policy portfolio, say)
 * belongs under `ModuleKey.Clients` and should be a separate controller rather
 * than an addition here.
 *
 * ⚠ Consequence worth knowing: disabling the `deal_audits` module for an
 * agency also disables the duplicate check and sold submission.
 */
@Controller('policies')
@RequireModule(ModuleKey.DealAudits)
@RequirePermissions(modulePermission(ModuleKey.DealAudits, 'read'))
export class PoliciesController {
  constructor(private readonly policiesService: PoliciesService) {}

  // Static segment first: Nest matches in declaration order, so any future
  // `@Get(':id')` must come after this or it will swallow `/check`.

  /**
   * Existing policies with the same number, so the wizard can offer to link
   * rather than duplicate. Always 200 — "no matches" and "input too short" are
   * both normal answers, not errors.
   */
  @Get('check')
  check(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
    @Query(new ZodValidationPipe(checkPolicySchema)) query: CheckPolicyDto,
  ) {
    return this.policiesService.check(access, branchId, query);
  }
}
