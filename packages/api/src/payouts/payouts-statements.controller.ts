import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  AgencyPermission,
  ModuleKey,
  modulePermission,
  type AccessContext,
  type PayoutActivityPeopleResponse,
  type PayoutActivityView,
  type PayoutRunResponse,
  type PayStatementsResponse,
  type PayStatementView,
} from '@sfa/shared';
import {
  RequireModule,
  RequirePermissions,
  RequireWrite,
} from '../common/decorators/access.decorators';
import { Access, BranchId } from '../common/decorators/user.decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  generatePayoutRunSchema,
  getPayoutRunQuerySchema,
  listPayStatementsQuerySchema,
  payoutActivityQuerySchema,
  payStatementIdSchema,
  type GeneratePayoutRunDto,
  type GetPayoutRunQueryDto,
  type ListPayStatementsQueryDto,
  type PayoutActivityQueryDto,
} from './dto/payouts.dto';
import { PayStatementsService } from './pay-statements.service';
import { PayoutActivityService } from './payout-activity.service';
import { PayoutRunsService } from './payout-runs.service';

/**
 * Pay statements (PAC-178) and the activity behind them (PAC-179).
 *
 * Three permissions, three audiences:
 *
 * - `payouts:read` — **the employee**: their own statements once sent, and
 *   their own sales and chargebacks. Not widened by data scope (CRM and Data
 *   Team hold it too) — see `statement-visibility.ts`.
 * - `payouts:write` — **the reviewer** (branch manager, owner): the month's
 *   run, every statement and anyone's activity within their data scope, and
 *   recalculating a draft.
 * - `agency:payouts:admin` — **the owner**: Generate / Recalculate a month.
 *
 * The branch header is honoured (no `@SkipBranch`): a branch manager's scope
 * is their branch.
 */
@Controller('payouts')
@RequireModule(ModuleKey.Payouts)
@RequirePermissions(modulePermission(ModuleKey.Payouts, 'read'))
export class PayoutsStatementsController {
  constructor(
    private readonly runs: PayoutRunsService,
    private readonly statements: PayStatementsService,
    private readonly activityService: PayoutActivityService,
  ) {}

  // --- Runs --------------------------------------------------------------

  /** The month's run — agency premium, pools, counts — or `run: null`. */
  @Get('runs')
  @RequireWrite(ModuleKey.Payouts)
  getRun(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
    @Query(new ZodValidationPipe(getPayoutRunQuerySchema))
    query: GetPayoutRunQueryDto,
  ): Promise<PayoutRunResponse> {
    return this.runs.get(access, branchId, query.month);
  }

  /**
   * Generate or recalculate a month (draft and disputed statements only).
   * 400 for a month not yet started; 409 `PAYOUT_RUN_GENERATING` while it is
   * being computed.
   */
  @Post('runs')
  @HttpCode(200)
  @RequirePermissions(AgencyPermission.PayoutsAdmin)
  generateRun(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
    @Body(new ZodValidationPipe(generatePayoutRunSchema))
    body: GeneratePayoutRunDto,
  ): Promise<PayoutRunResponse> {
    return this.runs.generate(access, branchId, body.month);
  }

  // --- Statements --------------------------------------------------------

  @Get('statements')
  listStatements(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
    @Query(new ZodValidationPipe(listPayStatementsQuerySchema))
    query: ListPayStatementsQueryDto,
  ): Promise<PayStatementsResponse> {
    return this.statements.list(access, branchId, query);
  }

  /** 404 for a statement the caller may not see. */
  @Get('statements/:id')
  getStatement(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
    @Param('id', new ZodValidationPipe(payStatementIdSchema)) id: string,
  ): Promise<PayStatementView> {
    return this.statements.detail(access, branchId, id);
  }

  /** 409 `PAYOUT_STATEMENT_NOT_EDITABLE` once sent or accepted. */
  @Post('statements/:id/recalculate')
  @HttpCode(200)
  @RequireWrite(ModuleKey.Payouts)
  recalculateStatement(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
    @Param('id', new ZodValidationPipe(payStatementIdSchema)) id: string,
  ): Promise<PayStatementView> {
    return this.statements.recalculate(access, branchId, id);
  }

  // --- Activity (PAC-179) ------------------------------------------------

  /** Whose activity the caller may open. Declared before `activity`. */
  @Get('activity/people')
  @RequireWrite(ModuleKey.Payouts)
  activityPeople(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
  ): Promise<PayoutActivityPeopleResponse> {
    return this.activityService.people(access, branchId);
  }

  /** 403 for another person without `payouts:write`; 404 outside scope. */
  @Get('activity')
  activity(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
    @Query(new ZodValidationPipe(payoutActivityQuerySchema))
    query: PayoutActivityQueryDto,
  ): Promise<PayoutActivityView> {
    return this.activityService.activity(access, branchId, query);
  }
}
