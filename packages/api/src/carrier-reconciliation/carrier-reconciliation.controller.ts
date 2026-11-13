import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ModuleKey,
  modulePermission,
  type AccessContext,
  type ReclassifyRunResponse,
  type ReconciliationOptionsResponse,
  type ReconciliationPresignResponse,
  type ReconciliationRowListResponse,
  type ReconciliationRowView,
  type ReconciliationRunDetail,
  type ReconciliationRunListResponse,
} from '@sfa/shared';
import type { Response } from 'express';
import {
  RequireModule,
  RequirePermissions,
  RequireWrite,
} from '../common/decorators/access.decorators';
import { Access } from '../common/decorators/user.decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  createRunSchema,
  exportQuerySchema,
  listRunsSchema,
  presignRunSchema,
  reconciliationIdSchema,
  reviewRowSchema,
  rowsQuerySchema,
  type CreateRunDto,
  type ExportQueryDto,
  type ListRunsDto,
  type PresignRunDto,
  type ReviewRowDto,
  type RowsQueryDto,
} from './dto/carrier-reconciliation.dto';
import { ReconciliationRunsService } from './reconciliation-runs.service';

const Id = () => new ZodValidationPipe(reconciliationIdSchema);

/**
 * The Dash Reconciliation page: upload Allstate's monthly "New Business
 * Details" report and reconcile it against the agency's sales.
 *
 * `carrier_reconciliation:read` views runs, rows and the export; `:write`
 * uploads reports, reviews rows and re-checks a run. Producer identity is the
 * Allstate codes on each user (set on the Users and profile pages). No
 * default role carries the module — the agency owner holds it through every
 * enabled module, and grants it to anyone else from the role matrix.
 *
 * ## Agency-wide, deliberately
 *
 * Data scope is **not** applied. A carrier report has no branch and no
 * owner: it is the agency's whole book for the month, and a reconciliation
 * that showed a branch manager "their half" would report the other half as
 * missing. Whoever is granted the page sees the agency's report.
 */
@Controller('carrier-reconciliation')
@RequireModule(ModuleKey.CarrierReconciliation)
@RequirePermissions(modulePermission(ModuleKey.CarrierReconciliation, 'read'))
export class CarrierReconciliationController {
  constructor(private readonly runs: ReconciliationRunsService) {}

  /** Agency users, for the page's user pickers. */
  @Get('options')
  options(
    @Access() access: AccessContext,
  ): Promise<ReconciliationOptionsResponse> {
    return this.runs.options(access);
  }

  // --- Runs ----------------------------------------------------------------

  /** A presigned PUT for the report; the browser uploads straight to storage. */
  @Post('runs/presign')
  @RequireWrite(ModuleKey.CarrierReconciliation)
  presign(
    @Access() access: AccessContext,
    @Body(new ZodValidationPipe(presignRunSchema)) body: PresignRunDto,
  ): Promise<ReconciliationPresignResponse> {
    return this.runs.presign(access, body);
  }

  /**
   * Reconcile an uploaded report, synchronously. 201 with the finished run;
   * 400 for a key that is not this agency's or an upload that did not land;
   * 409 `RECONCILIATION_DUPLICATE_FILE`; 413 over the size cap; 422
   * `RECONCILIATION_UNREADABLE_FILE` / `RECONCILIATION_WRONG_AGENCY` /
   * `RECONCILIATION_NO_APPOINTMENT`.
   */
  @Post('runs')
  @RequireWrite(ModuleKey.CarrierReconciliation)
  create(
    @Access() access: AccessContext,
    @Body(new ZodValidationPipe(createRunSchema)) body: CreateRunDto,
  ): Promise<ReconciliationRunDetail> {
    return this.runs.create(access, body);
  }

  @Get('runs')
  list(
    @Access() access: AccessContext,
    @Query(new ZodValidationPipe(listRunsSchema)) query: ListRunsDto,
  ): Promise<ReconciliationRunListResponse> {
    return this.runs.list(access, query);
  }

  @Get('runs/:id')
  detail(
    @Access() access: AccessContext,
    @Param('id', Id()) id: string,
  ): Promise<ReconciliationRunDetail> {
    return this.runs.detail(access, id);
  }

  @Get('runs/:id/rows')
  rows(
    @Access() access: AccessContext,
    @Param('id', Id()) id: string,
    @Query(new ZodValidationPipe(rowsQuerySchema)) query: RowsQueryDto,
  ): Promise<ReconciliationRowListResponse> {
    return this.runs.rows(access, id, query);
  }

  /** The exception list (or one tab) as a streamed CSV / XLSX download. */
  @Get('runs/:id/export')
  export(
    @Access() access: AccessContext,
    @Param('id', Id()) id: string,
    @Query(new ZodValidationPipe(exportQuerySchema)) query: ExportQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    return this.runs.export(access, id, query, res);
  }

  /** Re-apply the users' current Allstate codes to a run; 409 unless it finished. */
  @Post('runs/:id/reclassify')
  @RequireWrite(ModuleKey.CarrierReconciliation)
  reclassify(
    @Access() access: AccessContext,
    @Param('id', Id()) id: string,
  ): Promise<ReclassifyRunResponse> {
    return this.runs.reclassify(access, id);
  }

  @Patch('runs/:id/rows/:rowId/review')
  @RequireWrite(ModuleKey.CarrierReconciliation)
  review(
    @Access() access: AccessContext,
    @Param('id', Id()) id: string,
    @Param('rowId', Id()) rowId: string,
    @Body(new ZodValidationPipe(reviewRowSchema)) body: ReviewRowDto,
  ): Promise<ReconciliationRowView> {
    return this.runs.review(access, id, rowId, body);
  }
}
