import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  AgencyPermission,
  ModuleKey,
  type AccessContext,
  type ChargebackImportCommitResponse,
  type ChargebackImportPresignResponse,
  type ChargebackImportsResponse,
  type ChargebackImportSummary,
  type ChargebackImportView,
  type ImportPeopleResponse,
  type UpdateImportRowResponse,
} from '@sfa/shared';
import {
  RequireModule,
  RequirePermissions,
  SkipBranch,
} from '../common/decorators/access.decorators';
import { Access } from '../common/decorators/user.decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { ChargebackImportsService } from './chargeback-imports.service';
import {
  chargebackImportIdSchema,
  createChargebackImportSchema,
  importRowActionSchema,
  importRowNumberSchema,
  listChargebackImportsQuerySchema,
  presignChargebackImportSchema,
  type CreateChargebackImportDto,
  type ImportRowActionDto,
  type ListChargebackImportsQueryDto,
  type PresignChargebackImportDto,
} from './dto/payouts.dto';

/**
 * The carrier chargeback report import (PAC-180): presign → upload →
 * create (a preview) → resolve lines → commit, or discard.
 *
 * Every route is `agency:payouts:admin`, reads included: a report spans
 * branches, and a branch manager does not see other branches' pay.
 * Agency-wide, so the branch header is not read (`@SkipBranch`).
 */
@Controller('payouts/imports')
@RequireModule(ModuleKey.Payouts)
@RequirePermissions(AgencyPermission.PayoutsAdmin)
@SkipBranch()
export class PayoutsImportsController {
  constructor(private readonly imports: ChargebackImportsService) {}

  /** A presigned PUT for the report (.xlsx or .csv, ≤ 10 MiB). */
  @Post('presign')
  presign(
    @Access() access: AccessContext,
    @Body(new ZodValidationPipe(presignChargebackImportSchema))
    body: PresignChargebackImportDto,
  ): Promise<ChargebackImportPresignResponse> {
    return this.imports.presign(access, body);
  }

  /**
   * Read the uploaded report into a preview. 400 key / upload / size / future
   * month; 409 `PAYOUT_IMPORT_DUPLICATE_FILE` (+ `importId`); 413; 422
   * `PAYOUT_IMPORT_UNREADABLE_FILE` (+ `reason`).
   */
  @Post()
  create(
    @Access() access: AccessContext,
    @Body(new ZodValidationPipe(createChargebackImportSchema))
    body: CreateChargebackImportDto,
  ): Promise<ChargebackImportView> {
    return this.imports.create(access, body);
  }

  /** A month's imports (or the latest of every month), newest first. */
  @Get()
  list(
    @Access() access: AccessContext,
    @Query(new ZodValidationPipe(listChargebackImportsQuerySchema))
    query: ListChargebackImportsQueryDto,
  ): Promise<ChargebackImportsResponse> {
    return this.imports.list(access, query);
  }

  /** Everyone a line may be charged to, people who have left included. */
  @Get('people')
  people(@Access() access: AccessContext): Promise<ImportPeopleResponse> {
    return this.imports.peopleOptions(access);
  }

  @Get(':id')
  get(
    @Access() access: AccessContext,
    @Param('id', new ZodValidationPipe(chargebackImportIdSchema)) id: string,
  ): Promise<ChargebackImportView> {
    return this.imports.get(access, id);
  }

  /** Assign / skip / include / reset one line. 409 once committed or discarded. */
  @Patch(':id/rows/:rowNumber')
  updateRow(
    @Access() access: AccessContext,
    @Param('id', new ZodValidationPipe(chargebackImportIdSchema)) id: string,
    @Param('rowNumber', new ZodValidationPipe(importRowNumberSchema))
    rowNumber: number,
    @Body(new ZodValidationPipe(importRowActionSchema))
    body: ImportRowActionDto,
  ): Promise<UpdateImportRowResponse> {
    return this.imports.updateRow(access, id, rowNumber, body);
  }

  /**
   * Write the charged lines to the ledger and recalculate the month. 400
   * `PAYOUT_IMPORT_UNRESOLVED_ROWS`; 409 `PAYOUT_IMPORT_NOT_EDITABLE`.
   */
  @Post(':id/commit')
  @HttpCode(200)
  commit(
    @Access() access: AccessContext,
    @Param('id', new ZodValidationPipe(chargebackImportIdSchema)) id: string,
  ): Promise<ChargebackImportCommitResponse> {
    return this.imports.commit(access, id);
  }

  /** Discard a preview (frees the file's hash). 409 once committed. */
  @Delete(':id')
  discard(
    @Access() access: AccessContext,
    @Param('id', new ZodValidationPipe(chargebackImportIdSchema)) id: string,
  ): Promise<ChargebackImportSummary> {
    return this.imports.discard(access, id);
  }
}
