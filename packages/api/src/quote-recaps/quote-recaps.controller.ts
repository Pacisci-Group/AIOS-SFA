import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ModuleKey, modulePermission } from '@sfa/shared';
import type { AccessContext } from '@sfa/shared';
import {
  RequireModule,
  RequirePermissions,
  RequireWrite,
} from '../common/decorators/access.decorators';
import { Access, BranchId } from '../common/decorators/user.decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { createQuoteRecapSchema } from './dto/create-quote-recap.dto';
import type { CreateQuoteRecapDto } from './dto/create-quote-recap.dto';
import {
  leadContextSchema,
  presignQuoteDocumentSchema,
} from './dto/presign-quote-document.dto';
import type {
  LeadContextDto,
  PresignQuoteDocumentDto,
} from './dto/presign-quote-document.dto';
import { QuoteRecapsService } from './quote-recaps.service';

/**
 * Quote Recap form (PAC-39) — the proposal a producer quoted a household.
 *
 * Gated by the `quote_recaps` module: `read` for the lead context, `write` for
 * presign and create. `DataScope` is enforced in the service layer — a producer
 * (`own`) can only record a recap against their own lead, and gets a 404 rather
 * than a 403 for anyone else's.
 */
@Controller('quote-recaps')
@RequireModule(ModuleKey.QuoteRecaps)
@RequirePermissions(modulePermission(ModuleKey.QuoteRecaps, 'read'))
export class QuoteRecapsController {
  constructor(private readonly quoteRecapsService: QuoteRecapsService) {}

  // Static segments are declared first: Nest matches in declaration order, so
  // any future `@Get(':id')` must come after these or it will swallow them.

  /** Read-only lead + household header the form shows on mount. */
  @Get('context')
  getContext(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
    @Query(new ZodValidationPipe(leadContextSchema)) query: LeadContextDto,
  ) {
    return this.quoteRecapsService.getLeadContext(
      access,
      branchId,
      query.leadId,
    );
  }

  /** Issue a presigned URL to upload the carrier quote document. */
  @Post('quote-document/presign')
  @RequireWrite(ModuleKey.QuoteRecaps)
  presign(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
    @Body(new ZodValidationPipe(presignQuoteDocumentSchema))
    body: PresignQuoteDocumentDto,
  ) {
    return this.quoteRecapsService.presignQuoteDocument(access, branchId, body);
  }

  /**
   * A presigned, inline URL that opens the uploaded quote document in a new tab
   * (PAC-56 #10, #30).
   *
   * `read`, not `write` — viewing a document you can already see the metadata
   * of is a read. Declared after the static segments above, per the note at the
   * top of the class.
   */
  @Get(':id/document/download')
  downloadDocument(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
    @Param('id') id: string,
  ) {
    return this.quoteRecapsService.getDocumentDownload(access, branchId, id);
  }

  /** Record the proposal. Totals are derived server-side from the policy rows. */
  @Post()
  @RequireWrite(ModuleKey.QuoteRecaps)
  create(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
    @Body(new ZodValidationPipe(createQuoteRecapSchema))
    body: CreateQuoteRecapDto,
  ) {
    return this.quoteRecapsService.create(access, branchId, body);
  }
}
