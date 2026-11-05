import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  type AccessContext,
  ModuleKey,
  modulePermission,
  type TimeOffPreview,
  type TimeOffRequestList,
  type TimeOffRequestView,
  type TimeOffSummary,
} from '@sfa/shared';
import {
  RequireModule,
  RequirePermissions,
  SkipBranch,
} from '../common/decorators/access.decorators';
import { Access, AgencyId } from '../common/decorators/user.decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  createTimeOffRequestSchema,
  listMyTimeOffRequestsSchema,
  listTeamTimeOffRequestsSchema,
  previewTimeOffRequestSchema,
  submitTimeOffRequestSchema,
  timeOffDecisionSchema,
  timeOffNoteRequiredSchema,
  timeOffRequestIdParamSchema,
  timeOffRequestSchema,
  type CreateTimeOffRequestDto,
  type ListMyTimeOffRequestsDto,
  type ListTeamTimeOffRequestsDto,
  type PreviewTimeOffRequestDto,
  type SubmitTimeOffRequestDto,
  type TimeOffDecisionDto,
  type TimeOffNoteRequiredDto,
  type TimeOffRequestDto,
} from './dto/time-off.dto';
import { TimeOffRequestsService } from './time-off-requests.service';

const HR_READ = modulePermission(ModuleKey.Hr, 'read');
const HR_WRITE = modulePermission(ModuleKey.Hr, 'write');

const requestId = () => new ZodValidationPipe(timeOffRequestIdParamSchema);

/**
 * Time off (PAC-165) — the Time off page: an employee's balances and
 * requests, and the team's requests for the people who review them.
 *
 * Two capabilities, both the HR module's:
 *
 * - `hr:read` — every employee. Their own balances and their own requests,
 *   **always pinned to themself**: the data scope of a role that only reads
 *   (a CRM's branch, the Data Team's agency) opens nobody else's leave.
 * - `hr:write` — a reviewer. The requests of the people in their data scope
 *   (a Branch Manager's branch, an owner's agency), which they decide —
 *   never their own.
 *
 * `cancel` and the single read are `hr:read` because both people use them;
 * the service decides which of the two the caller is for that request.
 *
 * `@SkipBranch()` — the scope is applied by the service from the access
 * context (`time-off-access.ts`), not by the branch header: an owner has no
 * branch, and a reader's branch must not widen what they see.
 */
@Controller('time-off')
@RequireModule(ModuleKey.Hr)
@SkipBranch()
export class TimeOffController {
  constructor(private readonly requests: TimeOffRequestsService) {}

  /** The caller's cards: a balance per time off policy they are in. */
  @Get('summary')
  @RequirePermissions(HR_READ)
  summary(
    @Access() access: AccessContext,
    @AgencyId() agencyId: string,
  ): Promise<TimeOffSummary> {
    return this.requests.summary(access, agencyId);
  }

  /** The caller's own requests, every group unless `group` narrows them. */
  @Get('requests/mine')
  @RequirePermissions(HR_READ)
  mine(
    @Access() access: AccessContext,
    @AgencyId() agencyId: string,
    @Query(new ZodValidationPipe(listMyTimeOffRequestsSchema))
    query: ListMyTimeOffRequestsDto,
  ): Promise<TimeOffRequestList> {
    return this.requests.listMine(access, agencyId, query);
  }

  /**
   * What a request would amount to — the hours per date, the balance lines,
   * and what stops it being sent. Writes nothing; a broken rule is a
   * `blockers` entry, not a 400.
   */
  @Post('requests/preview')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(HR_READ)
  preview(
    @Access() access: AccessContext,
    @AgencyId() agencyId: string,
    @Body(new ZodValidationPipe(previewTimeOffRequestSchema))
    body: PreviewTimeOffRequestDto,
  ): Promise<TimeOffPreview> {
    return this.requests.preview(access, agencyId, body);
  }

  /** The team's requests — To review unless `group` says otherwise. */
  @Get('requests')
  @RequirePermissions(HR_WRITE)
  team(
    @Access() access: AccessContext,
    @AgencyId() agencyId: string,
    @Query(new ZodValidationPipe(listTeamTimeOffRequestsSchema))
    query: ListTeamTimeOffRequestsDto,
  ): Promise<TimeOffRequestList> {
    return this.requests.listTeam(access, agencyId, query);
  }

  /**
   * Save a Draft (`send: false`) or send a request. A sent request is
   * Submitted, or Approved at once when the policy's auto-approval rules
   * pass. 400 with the failed check's `code` when it cannot be sent.
   */
  @Post('requests')
  @RequirePermissions(HR_READ)
  create(
    @Access() access: AccessContext,
    @AgencyId() agencyId: string,
    @Body(new ZodValidationPipe(createTimeOffRequestSchema))
    body: CreateTimeOffRequestDto,
  ): Promise<TimeOffRequestView> {
    return this.requests.create(access, agencyId, body);
  }

  /** One request: the caller's own, or one they review. 404 otherwise. */
  @Get('requests/:requestId')
  @RequirePermissions(HR_READ)
  get(
    @Access() access: AccessContext,
    @AgencyId() agencyId: string,
    @Param('requestId', requestId()) id: string,
  ): Promise<TimeOffRequestView> {
    return this.requests.get(access, agencyId, id);
  }

  /** Edit the caller's Draft, or their request sent back for changes. */
  @Patch('requests/:requestId')
  @RequirePermissions(HR_READ)
  update(
    @Access() access: AccessContext,
    @AgencyId() agencyId: string,
    @Param('requestId', requestId()) id: string,
    @Body(new ZodValidationPipe(timeOffRequestSchema)) body: TimeOffRequestDto,
  ): Promise<TimeOffRequestView> {
    return this.requests.update(access, agencyId, id, body);
  }

  /**
   * Send a Draft, or resend after changes. The edited form may ride along;
   * an empty body sends the request as saved.
   */
  @Post('requests/:requestId/submit')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(HR_READ)
  submit(
    @Access() access: AccessContext,
    @AgencyId() agencyId: string,
    @Param('requestId', requestId()) id: string,
    @Body(new ZodValidationPipe(submitTimeOffRequestSchema))
    body: SubmitTimeOffRequestDto,
  ): Promise<TimeOffRequestView> {
    return this.requests.submit(
      access,
      agencyId,
      id,
      'policyId' in body ? (body as TimeOffRequestDto) : null,
    );
  }

  /** Discard the caller's Draft. The row is stamped deleted, never removed. */
  @Delete('requests/:requestId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(HR_READ)
  discard(
    @Access() access: AccessContext,
    @AgencyId() agencyId: string,
    @Param('requestId', requestId()) id: string,
  ): Promise<void> {
    return this.requests.discard(access, agencyId, id);
  }

  /**
   * The employee withdraws their request, or cancels Approved leave until
   * the day before it starts; a reviewer cancels someone else's Approved
   * leave with a note. Approved leave gets its hours back.
   */
  @Post('requests/:requestId/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(HR_READ)
  cancel(
    @Access() access: AccessContext,
    @AgencyId() agencyId: string,
    @Param('requestId', requestId()) id: string,
    @Body(new ZodValidationPipe(timeOffDecisionSchema))
    body: TimeOffDecisionDto,
  ): Promise<TimeOffRequestView> {
    return this.requests.cancel(access, agencyId, id, body.note ?? null);
  }

  /** Approve a Submitted request; its hours are posted. 409 once decided. */
  @Post('requests/:requestId/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(HR_WRITE)
  approve(
    @Access() access: AccessContext,
    @AgencyId() agencyId: string,
    @Param('requestId', requestId()) id: string,
    @Body(new ZodValidationPipe(timeOffDecisionSchema))
    body: TimeOffDecisionDto,
  ): Promise<TimeOffRequestView> {
    return this.requests.approve(access, agencyId, id, body.note ?? null);
  }

  /** Send a Submitted request back to the employee, saying what to change. */
  @Post('requests/:requestId/request-changes')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(HR_WRITE)
  requestChanges(
    @Access() access: AccessContext,
    @AgencyId() agencyId: string,
    @Param('requestId', requestId()) id: string,
    @Body(new ZodValidationPipe(timeOffNoteRequiredSchema))
    body: TimeOffNoteRequiredDto,
  ): Promise<TimeOffRequestView> {
    return this.requests.requestChanges(access, agencyId, id, body.note);
  }

  /** Decline a Submitted request, saying why. Terminal. */
  @Post('requests/:requestId/decline')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(HR_WRITE)
  decline(
    @Access() access: AccessContext,
    @AgencyId() agencyId: string,
    @Param('requestId', requestId()) id: string,
    @Body(new ZodValidationPipe(timeOffNoteRequiredSchema))
    body: TimeOffNoteRequiredDto,
  ): Promise<TimeOffRequestView> {
    return this.requests.decline(access, agencyId, id, body.note);
  }
}
