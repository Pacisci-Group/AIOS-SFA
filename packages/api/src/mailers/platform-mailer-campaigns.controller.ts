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
  UseGuards,
} from '@nestjs/common';
import { PlatformPermission } from '@sfa/shared';
import {
  RequirePermissions,
  SkipBranch,
  SkipModule,
  SkipTenant,
} from '../common/decorators/access.decorators';
import { CurrentUser } from '../common/decorators/user.decorators';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  campaignRecordsSchema,
  commitCampaignSchema,
  createCampaignSchema,
  emailOutputSchema,
  listCampaignsSchema,
  presignCampaignFileSchema,
  updateCampaignSchema,
  type CampaignRecordsDto,
  type CommitCampaignDto,
  type CreateCampaignDto,
  type EmailOutputDto,
  type ListCampaignsDto,
  type PresignCampaignFileDto,
  type UpdateCampaignDto,
} from './dto/mailer-campaign.dto';
import { MailerCampaignsService } from './mailer-campaigns.service';

/**
 * Mailer Campaigns — the Super Admin panel's campaign runner (PAC-71).
 *
 * Replaces Add Mailers (PAC-73), which took the file ApexReports had already
 * processed. This takes the **vendor's** file one stage earlier and runs the
 * transform ourselves, so ApexReports drops out of the loop entirely.
 *
 * ## Why the platform guard stack
 *
 * `@SkipTenant()` because a campaign belongs to no agency — it is run once and
 * can serve many, or all of them; `@SkipBranch()` because a campaign has no
 * branch dimension; `@SkipModule()` because this is not an agency-facing page
 * and must work whether or not any tenant has the `mailers` module enabled.
 * Same stack as `PlatformUsersController`.
 *
 * ⚠ `platform:mailers:*` is **not** the agency-facing `mailers:read` the drawer
 * uses. Nothing here grants access to that, and holding it grants nothing here.
 *
 * ## The upload is three calls, not one
 *
 * `presign` → the browser `PUT`s the bytes straight to object storage →
 * `POST /platform/mailer-campaigns`. The file never passes through the API,
 * which is why there is no multer or `FileInterceptor` anywhere in this
 * codebase and why none should be introduced.
 *
 * ## ⚠ Route order is load-bearing
 *
 * Nest matches in **declaration order**, and `:campaignId` matches anything —
 * so `defaults` and `presign` are declared above it. Adding a static `GET`
 * below them would silently become a campaign-id lookup. Same hazard
 * `LeadsController` documents around `GET /leads/hot`.
 */
@Controller('platform/mailer-campaigns')
@SkipTenant()
@SkipBranch()
@SkipModule()
@UseGuards(PermissionsGuard)
export class PlatformMailerCampaignsController {
  constructor(private readonly service: MailerCampaignsService) {}

  @Get()
  @RequirePermissions(PlatformPermission.MailersRead)
  list(
    @Query(new ZodValidationPipe(listCampaignsSchema)) query: ListCampaignsDto,
  ) {
    return this.service.list(query);
  }

  /** ⚠ Above `:campaignId` — see the class note. */
  @Get('defaults')
  @RequirePermissions(PlatformPermission.MailersRead)
  defaults() {
    return this.service.defaults();
  }

  @Post('presign')
  @RequirePermissions(PlatformPermission.MailersWrite)
  presign(
    @Body(new ZodValidationPipe(presignCampaignFileSchema))
    body: PresignCampaignFileDto,
  ) {
    return this.service.presign(body);
  }

  @Post()
  @RequirePermissions(PlatformPermission.MailersWrite)
  create(
    @Body(new ZodValidationPipe(createCampaignSchema)) body: CreateCampaignDto,
    @CurrentUser() user: { sub: string },
  ) {
    return this.service.create(body, user.sub);
  }

  @Get(':campaignId')
  @RequirePermissions(PlatformPermission.MailersRead)
  get(@Param('campaignId') campaignId: string) {
    return this.service.get(campaignId);
  }

  @Patch(':campaignId')
  @RequirePermissions(PlatformPermission.MailersWrite)
  update(
    @Param('campaignId') campaignId: string,
    @Body(new ZodValidationPipe(updateCampaignSchema)) body: UpdateCampaignDto,
    @CurrentUser() user: { sub: string },
  ) {
    return this.service.patch(campaignId, body, user.sub);
  }

  /**
   * Re-run the preview. 200, not 201: this starts work on an existing record
   * rather than creating one, and the response is that record with a new status.
   */
  @Post(':campaignId/preview')
  @HttpCode(200)
  @RequirePermissions(PlatformPermission.MailersWrite)
  preview(
    @Param('campaignId') campaignId: string,
    @CurrentUser() user: { sub: string },
  ) {
    return this.service.preview(campaignId, user.sub);
  }

  /** 202: the gates passed and the work is queued, not done. */
  @Post(':campaignId/commit')
  @HttpCode(202)
  @RequirePermissions(PlatformPermission.MailersWrite)
  commit(
    @Param('campaignId') campaignId: string,
    @Body(new ZodValidationPipe(commitCampaignSchema)) body: CommitCampaignDto,
    @CurrentUser() user: { sub: string },
  ) {
    return this.service.commit(campaignId, body, user.sub);
  }

  @Get(':campaignId/records')
  @RequirePermissions(PlatformPermission.MailersRead)
  records(
    @Param('campaignId') campaignId: string,
    @Query(new ZodValidationPipe(campaignRecordsSchema))
    query: CampaignRecordsDto,
  ) {
    return this.service.records(campaignId, query);
  }

  /**
   * Mint a download link for one of the campaign's two files.
   *
   * A `GET` that returns a URL rather than a redirect, so the client can decide
   * how to present the download and so the link is not followed by anything
   * that happens to prefetch the route.
   */
  @Get(':campaignId/files/:kind/url')
  @RequirePermissions(PlatformPermission.MailersRead)
  fileUrl(
    @Param('campaignId') campaignId: string,
    @Param('kind') kind: string,
  ) {
    return this.service.fileUrl(
      campaignId,
      kind === 'output' ? 'output' : 'vendor',
    );
  }

  @Post(':campaignId/email')
  @HttpCode(202)
  @RequirePermissions(PlatformPermission.MailersWrite)
  email(
    @Param('campaignId') campaignId: string,
    @Body(new ZodValidationPipe(emailOutputSchema)) body: EmailOutputDto,
    @CurrentUser() user: { sub: string },
  ) {
    return this.service.emailOutput(campaignId, body, user.sub);
  }

  @Delete(':campaignId')
  @RequirePermissions(PlatformPermission.MailersWrite)
  remove(@Param('campaignId') campaignId: string) {
    return this.service.remove(campaignId);
  }
}
