import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ModuleKey,
  modulePermission,
  type AccessContext,
  type ReconciliationAssignedListResponse,
  type ReconciliationAssignedRowDetail,
  type ReconciliationPresignResponse,
  type ReconciliationServiceIntakeOptions,
  type ReconciliationServiceIntakeResponse,
} from '@sfa/shared';
import {
  RequireAnyPermission,
  RequireModule,
} from '../common/decorators/access.decorators';
import { Access, BranchId } from '../common/decorators/user.decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  assignedQuerySchema,
  presignRowDocumentSchema,
  reconciliationIdSchema,
  recordOutcomeSchema,
  serviceIntakeSchema,
  type AssignedQueryDto,
  type PresignRowDocumentDto,
  type RecordOutcomeDto,
  type ServiceIntakeDto,
} from './dto/carrier-reconciliation.dto';
import { ReconciliationAssignmentsService } from './reconciliation-assignments.service';
import { ReconciliationOutcomesService } from './reconciliation-outcomes.service';

/**
 * The assignee's side of Dash Reconciliation: the rows the owner handed to
 * **me** (PAC-173).
 *
 * A class of its own because the report's controller requires
 * `carrier_reconciliation:read` on every route, and no Producer or CSR holds
 * it — nor should: data scope is not applied to the report. Here
 * `leads:read`, which both the Producer and CSR templates carry, is enough,
 * and the service clamps every read to rows assigned to the caller. The
 * module gate still applies: an agency with Dash Reconciliation off has no
 * assignments to show.
 *
 * The assignee records what became of a row here too (PAC-173 PR 4), under
 * the same class gate and **no** `@RequireWrite`: there is no module whose
 * `:write` means "work a row given to me", and the service clamps every
 * write to the row's assignee. Sold and Cancel rewrite book a sale, so those
 * two also need `leads:write` + `deal_audits:write`, checked in the service
 * where the kind is known.
 *
 * A 1-800 row is set up for service here too (PAC-173 PR 5): its signed
 * application's presign, the CSRs its welcome call can go to, and the intake
 * itself — `leads:write` for those, checked in the service the same way.
 */
@Controller('carrier-reconciliation/assigned')
@RequireModule(ModuleKey.CarrierReconciliation)
@RequireAnyPermission(
  modulePermission(ModuleKey.CarrierReconciliation, 'read'),
  modulePermission(ModuleKey.Leads, 'read'),
)
export class ReconciliationAssignmentsController {
  constructor(
    private readonly assignments: ReconciliationAssignmentsService,
    private readonly outcomes: ReconciliationOutcomesService,
  ) {}

  /** My rows still waiting on a decision; 403 for `userId` without `:read`. */
  @Get()
  list(
    @Access() access: AccessContext,
    @Query(new ZodValidationPipe(assignedQuerySchema)) query: AssignedQueryDto,
  ): Promise<ReconciliationAssignedListResponse> {
    return this.assignments.list(access, query);
  }

  /**
   * One of my rows — what a notification opens, with the Dash line as the
   * New Lead and Sold forms want it (`prefill`); 404 if it is not mine.
   */
  @Get(':rowId')
  detail(
    @Access() access: AccessContext,
    @Param('rowId', new ZodValidationPipe(reconciliationIdSchema))
    rowId: string,
  ): Promise<ReconciliationAssignedRowDetail> {
    return this.assignments.detail(access, rowId);
  }

  /**
   * Record what became of my row: `other` (with a note) finishes it now;
   * `sold` / `cancel_rewrite` start it at "record the sale", and sending the
   * same kind again resumes it. 400 for a missing note or
   * `RECONCILIATION_OUTCOME_NOT_ALLOWED` (not offered on the row's tab); 403
   * `RECONCILIATION_OUTCOME_FORBIDDEN` (a sale kind without `leads:write` +
   * `deal_audits:write`); 404 unless it is assigned to me; 409 for a decided
   * row, a replaced or unfinished run, a concurrent change, or
   * `RECONCILIATION_OUTCOME_LOCKED` (switching kind once a sale is booked).
   */
  @Patch(':rowId/outcome')
  recordOutcome(
    @Access() access: AccessContext,
    @Param('rowId', new ZodValidationPipe(reconciliationIdSchema))
    rowId: string,
    @Body(new ZodValidationPipe(recordOutcomeSchema)) body: RecordOutcomeDto,
  ): Promise<ReconciliationAssignedRowDetail> {
    return this.outcomes.record(access, rowId, body);
  }

  /**
   * Where the 1-800 service intake's signed application goes: a presigned
   * PUT under this row, PDF only. 400 for a row that offers no service intake
   * (`RECONCILIATION_OUTCOME_NOT_ALLOWED`) or a body that is not a PDF of at
   * most 10MB; 403 without `leads:write`; 404 unless the row is mine; 409 for
   * a decided row or a replaced run.
   */
  @Post(':rowId/documents/presign')
  presignDocument(
    @Access() access: AccessContext,
    @Param('rowId', new ZodValidationPipe(reconciliationIdSchema))
    rowId: string,
    @Body(new ZodValidationPipe(presignRowDocumentSchema))
    body: PresignRowDocumentDto,
  ): Promise<ReconciliationPresignResponse> {
    return this.outcomes.presignDocument(access, rowId, body);
  }

  /**
   * The CSRs the service intake's welcome call can go to — the ticket
   * picker's pool, which a Producer cannot ask for themselves. 400 for a row
   * that offers no service intake; 403 without `leads:write`; 404 unless the
   * row is mine.
   */
  @Get(':rowId/service-intake/options')
  serviceIntakeOptions(
    @Access() access: AccessContext,
    @Param('rowId', new ZodValidationPipe(reconciliationIdSchema))
    rowId: string,
  ): Promise<ReconciliationServiceIntakeOptions> {
    return this.outcomes.serviceIntakeOptions(access, rowId);
  }

  /**
   * Set my 1-800 row up for service: the household, a `carrier_direct`
   * policy with no deal, and the chosen CSR's welcome call — never a sale.
   * Finishes the row (`service_intake_recorded`). See the service for every
   * refusal.
   */
  @Post(':rowId/service-intake')
  serviceIntake(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
    @Param('rowId', new ZodValidationPipe(reconciliationIdSchema))
    rowId: string,
    @Body(new ZodValidationPipe(serviceIntakeSchema)) body: ServiceIntakeDto,
  ): Promise<ReconciliationServiceIntakeResponse> {
    return this.outcomes.serviceIntake(access, branchId, rowId, body);
  }
}
