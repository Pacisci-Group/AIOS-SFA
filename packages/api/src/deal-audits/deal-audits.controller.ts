import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
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
import { DealAuditsService } from './deal-audits.service';
import { listDealAuditsSchema } from './dto/list-deal-audits.dto';
import type { ListDealAuditsDto } from './dto/list-deal-audits.dto';
import { presignAttachmentSchema } from './dto/presign-attachment.dto';
import type { PresignAttachmentDto } from './dto/presign-attachment.dto';
import { resolveDealAuditSchema } from './dto/resolve-deal-audit.dto';
import type { ResolveDealAuditDto } from './dto/resolve-deal-audit.dto';

/**
 * Deals Pending Service Hand-off board (read) + resolve (write).
 *
 * The page is gated by `dashboard:read` (route level, on the web). This API is
 * gated by the `deal_audits` module: `read` for the board, `write` for resolve
 * and attachment presign. `DataScope` is enforced in the service layer — a
 * producer (`own`) can only see/resolve their own deals' audit items.
 */
@Controller('deal-audits')
@RequireModule(ModuleKey.DealAudits)
@RequirePermissions(modulePermission(ModuleKey.DealAudits, 'read'))
export class DealAuditsController {
  constructor(private readonly dealAuditsService: DealAuditsService) {}

  @Get()
  list(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
    @Query(new ZodValidationPipe(listDealAuditsSchema))
    query: ListDealAuditsDto,
  ) {
    return this.dealAuditsService.listPendingHandoff(access, branchId, query);
  }

  /** Issue a presigned URL to upload a resolution document. */
  @Post(':itemId/attachments/presign')
  @RequireWrite(ModuleKey.DealAudits)
  presign(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(presignAttachmentSchema))
    body: PresignAttachmentDto,
  ) {
    return this.dealAuditsService.presignAttachment(
      access,
      branchId,
      itemId,
      body,
    );
  }

  /** Resolve (verify) an audit item, optionally with a note and/or document. */
  @Patch(':itemId/resolve')
  @RequireWrite(ModuleKey.DealAudits)
  resolve(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(resolveDealAuditSchema))
    body: ResolveDealAuditDto,
  ) {
    return this.dealAuditsService.resolveItem(access, branchId, itemId, body);
  }

  /** Presigned URL to view/download a stored resolution document. */
  @Get(':itemId/attachments/:index/download')
  download(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
    @Param('itemId') itemId: string,
    @Param('index', ParseIntPipe) index: number,
  ) {
    return this.dealAuditsService.getAttachmentDownloadUrl(
      access,
      branchId,
      itemId,
      index,
    );
  }
}
