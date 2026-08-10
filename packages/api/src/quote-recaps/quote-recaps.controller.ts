import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
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
import { updateQuoteRecapSchema } from './dto/update-quote-recap.dto';
import type { UpdateQuoteRecapDto } from './dto/update-quote-recap.dto';
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

  // Static segments are declared first: Nest matches in declaration order, and
  // `@Get(':id')` below **will** swallow `@Get('context')` if it is moved above
  // it. That hazard is now real rather than hypothetical — do not reorder.

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

  /**
   * The edit form's payload (PAC-56 #11) — the recap plus the lead/household
   * context, so the page renders in one round trip.
   *
   * `read`, inherited from the class: reading a recap you can already see the
   * summary of is a read. The `write` gate is on the PATCH below.
   *
   * ⚠ Declared after every static-segment route above. A one-segment `@Get`
   * placed before `context` would capture it and break the create form.
   */
  @Get(':id')
  getEditView(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
    @Param('id') id: string,
  ) {
    return this.quoteRecapsService.getEditView(access, branchId, id);
  }

  /**
   * Correct a recorded quote (PAC-56 #11).
   *
   * `policies` is a full replacement when present; `quoteDocument` replaces the
   * attachment when present and keeps it when absent. Totals are recomputed;
   * `quoteDate` never moves, because it buckets the Quoted scorecard. See the
   * service docblock for the full list of what this deliberately leaves alone.
   */
  @Patch(':id')
  @RequireWrite(ModuleKey.QuoteRecaps)
  update(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateQuoteRecapSchema))
    body: UpdateQuoteRecapDto,
  ) {
    return this.quoteRecapsService.update(access, branchId, id, body);
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
