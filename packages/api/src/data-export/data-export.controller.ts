import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  type AccessContext,
  type DataExportDatasetKey,
  type DataExportDictionaryResponse,
  type DataExportFileUrlResponse,
  type DataExportHistoryResponse,
  type DataExportRequestResponse,
  type DataExportOptionsResponse,
  ModuleKey,
  modulePermission,
} from '@sfa/shared';
import {
  RequireModule,
  RequirePermissions,
} from '../common/decorators/access.decorators';
import { Access, BranchId } from '../common/decorators/user.decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { DataExportHistoryService } from './data-export-history.service';
import { DataExportService } from './data-export.service';
import {
  dataExportHistoryQuerySchema,
  dataExportIdSchema,
  dataExportRequestSchema,
  datasetKeySchema,
  type DataExportHistoryQueryDto,
  type DataExportRequestDto,
} from './dto/data-export-query.dto';

/**
 * The Data Export page (PAC-152): report-ready datasets for the agency's data
 * team, as CSV or XLSX.
 *
 * `data_export:read` is the whole gate. The agency owner grants it from the
 * role matrix or a per-user override like any other page, and the Data Team
 * role holds it by default. `data_export:write` exists because the permission
 * model requires the pair, and grants nothing here.
 *
 * Data scope is never bypassed: a Producer granted the page exports their own
 * leads, quotes and sales, and their branch's client records.
 *
 * ## Requested, then fetched
 *
 * Nothing here streams a file. `POST :dataset/exports` validates the request,
 * counts it against the row cap and queues it (202); a worker job writes the
 * file to object storage and emails the requester; the page lists it under
 * `history` and `GET exports/:id/url` mints a short-lived download link on
 * click. A large export therefore never holds a request open, and a file can
 * be fetched again until retention deletes it.
 */
@Controller('data-export')
@RequireModule(ModuleKey.DataExport)
@RequirePermissions(modulePermission(ModuleKey.DataExport, 'read'))
export class DataExportController {
  constructor(
    private readonly service: DataExportService,
    private readonly history: DataExportHistoryService,
  ) {}

  /** The data dictionary: datasets, their date fields, filters and columns. */
  @Get('datasets')
  datasets(): DataExportDictionaryResponse {
    return this.service.dictionary();
  }

  /** Branches and producers the caller may filter by. */
  @Get('options')
  options(@Access() access: AccessContext): Promise<DataExportOptionsResponse> {
    return this.service.options(access);
  }

  /** The download log, newest first. */
  @Get('history')
  list(
    @Access() access: AccessContext,
    @Query(new ZodValidationPipe(dataExportHistoryQuerySchema))
    query: DataExportHistoryQueryDto,
  ): Promise<DataExportHistoryResponse> {
    return this.history.list(access, query);
  }

  /**
   * Queues an export. Validation errors and an over-cap refusal are ordinary
   * JSON 400s; anything accepted is a 202 with the `queued` row.
   */
  @Post(':dataset/exports')
  @HttpCode(HttpStatus.ACCEPTED)
  async request(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
    @Param('dataset', new ZodValidationPipe(datasetKeySchema))
    dataset: DataExportDatasetKey,
    @Body(new ZodValidationPipe(dataExportRequestSchema))
    body: DataExportRequestDto,
  ): Promise<DataExportRequestResponse> {
    return {
      export: await this.service.request(access, branchId, dataset, body),
    };
  }

  /**
   * A presigned link to a finished export's file, minted on click. 409 while
   * it is being prepared, 410 once retention has deleted it, 404 for a row
   * the caller cannot see.
   */
  @Get('exports/:id/url')
  fileUrl(
    @Access() access: AccessContext,
    @Param('id', new ZodValidationPipe(dataExportIdSchema)) id: string,
  ): Promise<DataExportFileUrlResponse> {
    return this.history.fileUrl(access, id);
  }
}
