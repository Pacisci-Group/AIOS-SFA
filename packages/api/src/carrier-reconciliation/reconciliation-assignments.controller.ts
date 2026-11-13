import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ModuleKey,
  modulePermission,
  type AccessContext,
  type ReconciliationAssignedListResponse,
  type ReconciliationAssignedRow,
} from '@sfa/shared';
import {
  RequireAnyPermission,
  RequireModule,
} from '../common/decorators/access.decorators';
import { Access } from '../common/decorators/user.decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  assignedQuerySchema,
  reconciliationIdSchema,
  type AssignedQueryDto,
} from './dto/carrier-reconciliation.dto';
import { ReconciliationAssignmentsService } from './reconciliation-assignments.service';

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
 */
@Controller('carrier-reconciliation/assigned')
@RequireModule(ModuleKey.CarrierReconciliation)
@RequireAnyPermission(
  modulePermission(ModuleKey.CarrierReconciliation, 'read'),
  modulePermission(ModuleKey.Leads, 'read'),
)
export class ReconciliationAssignmentsController {
  constructor(private readonly assignments: ReconciliationAssignmentsService) {}

  /** My rows still waiting on a decision; 403 for `userId` without `:read`. */
  @Get()
  list(
    @Access() access: AccessContext,
    @Query(new ZodValidationPipe(assignedQuerySchema)) query: AssignedQueryDto,
  ): Promise<ReconciliationAssignedListResponse> {
    return this.assignments.list(access, query);
  }

  /** One of my rows — what a notification opens; 404 if it is not mine. */
  @Get(':rowId')
  detail(
    @Access() access: AccessContext,
    @Param('rowId', new ZodValidationPipe(reconciliationIdSchema))
    rowId: string,
  ): Promise<ReconciliationAssignedRow> {
    return this.assignments.detail(access, rowId);
  }
}
