import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  AgencyPermission,
  ModuleKey,
  modulePermission,
  type AccessContext,
  type PayoutActivityPeopleResponse,
  type PayoutActivityView,
  type PayoutRunResponse,
  type PayStatementPdfLinkResponse,
  type PayStatementsResponse,
  type PayStatementView,
  type SendAllDraftsResponse,
} from '@sfa/shared';
import type { Response } from 'express';
import {
  RequireModule,
  RequirePermissions,
  RequireWrite,
} from '../common/decorators/access.decorators';
import { Access, BranchId } from '../common/decorators/user.decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  acceptPayStatementSchema,
  addStatementAdjustmentSchema,
  rejectPayStatementSchema,
  statementAdjustmentIdSchema,
  type AcceptPayStatementDto,
  type AddStatementAdjustmentDto,
  type RejectPayStatementDto,
  generatePayoutRunSchema,
  getPayoutRunQuerySchema,
  listPayStatementsQuerySchema,
  payoutActivityQuerySchema,
  payoutRunIdSchema,
  payStatementIdSchema,
  payStatementPdfQuerySchema,
  sendAllDraftsQuerySchema,
  updateStatementAdjustmentsSchema,
  updateStatementInputsSchema,
  type GeneratePayoutRunDto,
  type UpdateStatementAdjustmentsDto,
  type UpdateStatementInputsDto,
  type GetPayoutRunQueryDto,
  type ListPayStatementsQueryDto,
  type PayoutActivityQueryDto,
  type PayStatementPdfQueryDto,
  type SendAllDraftsQueryDto,
} from './dto/payouts.dto';
import { PayStatementsService } from './pay-statements.service';
import { PayoutActivityService } from './payout-activity.service';
import { PayoutRunsService } from './payout-runs.service';
import { StatementIssueService } from './statement-issue.service';
import { StatementSignoffService } from './statement-signoff.service';

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
 * Issuing (PAC-181) is the reviewer's: send one statement or every draft of
 * a month, reopen a sent one, preview a draft's PDF. Opening an issued PDF
 * is anyone's who may see the statement — the employee included.
 *
 * Answering (PAC-182) is the employee's alone, on `payouts:read`: accept a
 * sent statement (a signed copy is stored) or dispute it with notes. The
 * reviewer corrects a disputed one — chargeback lines with notes
 * (`POST`/`DELETE …/adjustments`) beside the entered amounts — and sends it
 * again.
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
    private readonly issuing: StatementIssueService,
    private readonly signoff: StatementSignoffService,
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

  /**
   * Send every draft of the run the caller may see (PAC-181); `branchId`
   * narrows an agency-wide reviewer to one branch. 409
   * `PAYOUT_RUN_GENERATING` while the month is being calculated.
   */
  @Post('runs/:id/send-all')
  @HttpCode(200)
  @RequireWrite(ModuleKey.Payouts)
  sendAllDrafts(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
    @Param('id', new ZodValidationPipe(payoutRunIdSchema)) id: string,
    @Query(new ZodValidationPipe(sendAllDraftsQuerySchema))
    query: SendAllDraftsQueryDto,
  ): Promise<SendAllDraftsResponse> {
    return this.issuing.sendAll(access, branchId, id, query);
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

  /**
   * The figures the manager enters (compliance rate, retention, life
   * referrals, meeting attendance), whole; the statement is recalculated.
   * 409 `PAYOUT_STATEMENT_NOT_EDITABLE` once sent; 403
   * `PAYOUT_STATEMENT_OWN_INPUTS` on one's own without the admin permission.
   */
  @Patch('statements/:id/inputs')
  @RequireWrite(ModuleKey.Payouts)
  updateStatementInputs(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
    @Param('id', new ZodValidationPipe(payStatementIdSchema)) id: string,
    @Body(new ZodValidationPipe(updateStatementInputsSchema))
    body: UpdateStatementInputsDto,
  ): Promise<PayStatementView> {
    return this.statements.updateInputs(access, branchId, id, body);
  }

  /**
   * The amounts a reviewer enters (10 Nov 2026): Other bonuses / SPIFFs
   * (added), the compliance adjustment and other adjustments (deducted),
   * whole; the statement is recalculated. 409 `PAYOUT_STATEMENT_NOT_EDITABLE`
   * once sent, `PAYOUT_STATEMENT_CHANGED` when it changed meanwhile; 403
   * `PAYOUT_STATEMENT_OWN_STATEMENT` on one's own without the admin permission.
   */
  @Patch('statements/:id/adjustments')
  @RequireWrite(ModuleKey.Payouts)
  updateStatementAdjustments(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
    @Param('id', new ZodValidationPipe(payStatementIdSchema)) id: string,
    @Body(new ZodValidationPipe(updateStatementAdjustmentsSchema))
    body: UpdateStatementAdjustmentsDto,
  ): Promise<PayStatementView> {
    return this.statements.updateAdjustments(access, branchId, id, body);
  }

  /**
   * One chargeback line with a note (PAC-182): leave a chargeback on the
   * statement out (`exclude_chargeback`), or add one the ledger does not hold
   * (`add_chargeback` — a `manual` ledger row in the statement's month). Then
   * the statement is recalculated. Draft and disputed statements only;
   * 409 `PAYOUT_CHARGEBACK_ALREADY_CHARGED` for a policy that already has a
   * chargeback.
   */
  @Post('statements/:id/adjustments')
  @HttpCode(200)
  @RequireWrite(ModuleKey.Payouts)
  addStatementAdjustment(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
    @Param('id', new ZodValidationPipe(payStatementIdSchema)) id: string,
    @Body(new ZodValidationPipe(addStatementAdjustmentSchema))
    body: AddStatementAdjustmentDto,
  ): Promise<PayStatementView> {
    return this.statements.addAdjustment(access, branchId, id, body);
  }

  /**
   * Undo a chargeback line (PAC-182): restore a left-out chargeback, or
   * remove an added one and delete its ledger row. The entered amounts are
   * `PATCH`ed, not deleted here (400).
   */
  @Delete('statements/:id/adjustments/:adjustmentId')
  @RequireWrite(ModuleKey.Payouts)
  removeStatementAdjustment(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
    @Param('id', new ZodValidationPipe(payStatementIdSchema)) id: string,
    @Param('adjustmentId', new ZodValidationPipe(statementAdjustmentIdSchema))
    adjustmentId: string,
  ): Promise<PayStatementView> {
    return this.statements.removeAdjustment(access, branchId, id, adjustmentId);
  }

  // --- Issuing (PAC-181) -------------------------------------------------

  /**
   * Render the Commission Statement PDF, store it and send the statement to
   * its employee (in-app, push and email; a link, never an attachment). 409
   * `PAYOUT_STATEMENT_NOT_EDITABLE` once sent; `PAYOUT_RUN_GENERATING` while
   * the month is being calculated.
   */
  @Post('statements/:id/send')
  @HttpCode(200)
  @RequireWrite(ModuleKey.Payouts)
  sendStatement(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
    @Param('id', new ZodValidationPipe(payStatementIdSchema)) id: string,
  ): Promise<PayStatementView> {
    return this.issuing.send(access, branchId, id);
  }

  /**
   * A sent statement back to draft, before the employee answers. 409
   * `PAYOUT_STATEMENT_NOT_SENT` for anything else.
   */
  @Post('statements/:id/reopen')
  @HttpCode(200)
  @RequireWrite(ModuleKey.Payouts)
  reopenStatement(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
    @Param('id', new ZodValidationPipe(payStatementIdSchema)) id: string,
  ): Promise<PayStatementView> {
    return this.issuing.reopen(access, branchId, id);
  }

  // --- Answering (PAC-182) -----------------------------------------------

  /**
   * The employee accepts their sent statement: a signed copy of the PDF is
   * stored beside the issued one, and the statement is final. 403
   * `PAYOUT_STATEMENT_NOT_YOURS` for anyone else; 409
   * `PAYOUT_STATEMENT_NOT_SENT` unless it is sent.
   */
  @Post('statements/:id/accept')
  @HttpCode(200)
  acceptStatement(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
    @Param('id', new ZodValidationPipe(payStatementIdSchema)) id: string,
    @Body(new ZodValidationPipe(acceptPayStatementSchema))
    body: AcceptPayStatementDto,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<PayStatementView> {
    return this.signoff.accept(access, branchId, id, body, userAgent);
  }

  /**
   * The employee disputes their sent statement, with notes: it becomes
   * editable for a reviewer to correct and send again. Same 403 / 409.
   */
  @Post('statements/:id/reject')
  @HttpCode(200)
  rejectStatement(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
    @Param('id', new ZodValidationPipe(payStatementIdSchema)) id: string,
    @Body(new ZodValidationPipe(rejectPayStatementSchema))
    body: RejectPayStatementDto,
  ): Promise<PayStatementView> {
    return this.signoff.reject(access, branchId, id, body);
  }

  /**
   * A presigned inline link to the issued PDF — or, with `variant=signed`,
   * the signed copy of an accepted one — minted per read. 404 when the
   * statement is not visible or the version has no such file.
   */
  @Get('statements/:id/pdf')
  statementPdf(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
    @Param('id', new ZodValidationPipe(payStatementIdSchema)) id: string,
    @Query(new ZodValidationPipe(payStatementPdfQuerySchema))
    query: PayStatementPdfQueryDto,
  ): Promise<PayStatementPdfLinkResponse> {
    return this.issuing.pdfLink(
      access,
      branchId,
      id,
      query.version,
      query.variant,
    );
  }

  /** A draft's PDF, rendered now and streamed (`application/pdf`), not stored. */
  @Get('statements/:id/pdf-preview')
  @RequireWrite(ModuleKey.Payouts)
  statementPdfPreview(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
    @Param('id', new ZodValidationPipe(payStatementIdSchema)) id: string,
    @Res() res: Response,
  ): Promise<void> {
    return this.issuing.streamPreview(access, branchId, id, res);
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
