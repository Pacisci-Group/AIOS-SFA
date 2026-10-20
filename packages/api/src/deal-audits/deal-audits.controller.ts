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
import { DealAuditReviewService } from './deal-audit-review.service';
import { DealAuditsService } from './deal-audits.service';
import { addAuditNoteSchema } from './dto/add-audit-note.dto';
import { listDealAuditQueueSchema } from './dto/list-deal-audit-queue.dto';
import type { ListDealAuditQueueDto } from './dto/list-deal-audit-queue.dto';
import { setItemVerdictSchema } from './dto/set-item-verdict.dto';
import type { SetItemVerdictDto } from './dto/set-item-verdict.dto';
import type { AddAuditNoteDto } from './dto/add-audit-note.dto';
import { assignAuditSchema } from './dto/assign-audit.dto';
import type { AssignAuditDto } from './dto/assign-audit.dto';
import { reviewAuditSchema } from './dto/review-audit.dto';
import type { ReviewAuditDto } from './dto/review-audit.dto';
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
/*
 * "Management roles only" (PAC-106) — the manager's side of the audit.
 *
 * `deal_audits:*` alone is not enough: the Producer template holds
 * `deal_audits:write`, because producers resolve their own items. What
 * separates the people who **rule** on an audit is `management:read`, so the
 * review routes require both — an AND-set, since `@RequirePermissions` lists
 * every key it needs and a handler-level list replaces the class-level one.
 * Never a role name (AGENTS.md §7).
 */
const MANAGER_READ = [
  modulePermission(ModuleKey.DealAudits, 'read'),
  modulePermission(ModuleKey.Management, 'read'),
];
const MANAGER_WRITE = [
  modulePermission(ModuleKey.DealAudits, 'write'),
  modulePermission(ModuleKey.Management, 'read'),
];

@Controller('deal-audits')
@RequireModule(ModuleKey.DealAudits)
@RequirePermissions(modulePermission(ModuleKey.DealAudits, 'read'))
export class DealAuditsController {
  constructor(
    private readonly dealAuditsService: DealAuditsService,
    private readonly reviewService: DealAuditReviewService,
  ) {}

  @Get()
  list(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
    @Query(new ZodValidationPipe(listDealAuditsSchema))
    query: ListDealAuditsDto,
  ) {
    return this.dealAuditsService.listPendingHandoff(access, branchId, query);
  }

  /*
   * The per-deal workflow (PAC-72 section E).
   *
   * ⚠ **These must stay above the `:itemId` routes below.** Nest resolves in
   * declaration order, so `@Post(':itemId/attachments/presign')` would never
   * match `deals/...`, but `@Patch(':itemId/resolve')` and friends share a
   * shape with these — keeping the literal `deals` segment first removes any
   * doubt. Same hazard the module ordering comments in `app.module.ts` describe.
   */

  /**
   * The Deal Audits queue (PAC-106) — one row per deal, longest-waiting
   * first. A literal segment, so it cannot be mistaken for an item id.
   */
  @Get('queue')
  @RequirePermissions(...MANAGER_READ)
  queue(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
    @Query(new ZodValidationPipe(listDealAuditQueueSchema))
    query: ListDealAuditQueueDto,
  ) {
    return this.reviewService.listQueue(access, branchId, query);
  }

  /**
   * Who the queue's producer filter can offer (20 Oct 2026) — the sellers of
   * the deals in the caller's reach. Behind the queue's own gate, so a manager
   * needs no `agency:users:read` to filter by producer. Above `deals/...` with
   * the queue, for the same literal-segment reason.
   */
  @Get('queue/options')
  @RequirePermissions(...MANAGER_READ)
  queueOptions(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
  ) {
    return this.reviewService.queueOptions(access, branchId);
  }

  /** Everything the Deal Audit page shows, in one request (PAC-106). */
  @Get('deals/:dealId/review')
  @RequirePermissions(...MANAGER_READ)
  reviewView(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
    @Param('dealId') dealId: string,
  ) {
    return this.reviewService.getReviewView(access, branchId, dealId);
  }

  /** The sale's quote document, inline, reached through the audit (PAC-106). */
  @Get('deals/:dealId/quote-recap/document/download')
  @RequirePermissions(...MANAGER_READ)
  quoteRecapDocument(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
    @Param('dealId') dealId: string,
  ) {
    return this.reviewService.getQuoteRecapDocumentUrl(
      access,
      branchId,
      dealId,
    );
  }

  /** The deal's audit workflow state — owners, status, and what you may do. */
  @Get('deals/:dealId')
  workflow(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
    @Param('dealId') dealId: string,
  ) {
    return this.dealAuditsService.getWorkflow(access, branchId, dealId);
  }

  /** Set the audit's assignee and/or reviewer. */
  @Patch('deals/:dealId/assignment')
  @RequireWrite(ModuleKey.DealAudits)
  assign(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
    @Param('dealId') dealId: string,
    @Body(new ZodValidationPipe(assignAuditSchema)) body: AssignAuditDto,
  ) {
    return this.dealAuditsService.assign(access, branchId, dealId, body);
  }

  /** Hand the audit to its reviewer. */
  @Post('deals/:dealId/submit')
  @RequireWrite(ModuleKey.DealAudits)
  submit(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
    @Param('dealId') dealId: string,
  ) {
    return this.dealAuditsService.submit(access, branchId, dealId);
  }

  /**
   * Approve, request changes, or send back. Management only since PAC-106 —
   * see `MANAGER_WRITE`.
   */
  @Post('deals/:dealId/review')
  @RequirePermissions(...MANAGER_WRITE)
  review(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
    @Param('dealId') dealId: string,
    @Body(new ZodValidationPipe(reviewAuditSchema)) body: ReviewAuditDto,
  ) {
    return this.dealAuditsService.review(access, branchId, dealId, body);
  }

  /** The audit's note + workflow thread, newest first. */
  @Get('deals/:dealId/notes')
  listNotes(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
    @Param('dealId') dealId: string,
  ) {
    return this.dealAuditsService.listNotes(access, branchId, dealId);
  }

  /** Leave a note on the audit. */
  @Post('deals/:dealId/notes')
  @RequireWrite(ModuleKey.DealAudits)
  addNote(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
    @Param('dealId') dealId: string,
    @Body(new ZodValidationPipe(addAuditNoteSchema)) body: AddAuditNoteDto,
  ) {
    return this.dealAuditsService.addNote(access, branchId, dealId, body);
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

  /** The manager's ruling on one item — pass, fail, or withdrawn (PAC-106). */
  @Patch(':itemId/verdict')
  @RequirePermissions(...MANAGER_WRITE)
  verdict(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(setItemVerdictSchema)) body: SetItemVerdictDto,
  ) {
    return this.reviewService.setItemVerdict(access, branchId, itemId, body);
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
