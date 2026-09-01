import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { AccessContext, BugReportReceipt } from '@sfa/shared';
import {
  SkipBranch,
  SkipModule,
  SkipTenant,
} from '../common/decorators/access.decorators';
import { Access } from '../common/decorators/user.decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { BUG_REPORT_RATE_LIMIT, MINUTE_MS } from '../config/rate-limit.config';
import type { PresignedUpload } from '../storage/storage.service';
import { BugReportsService } from './bug-reports.service';
import {
  createBugReportSchema,
  presignBugScreenshotSchema,
  type CreateBugReportDto,
  type PresignBugScreenshotDto,
} from './dto/bug-report.dto';

/**
 * "Report a bug" — the floating widget's two endpoints.
 *
 * ## The guard stack, and why it is this permissive
 *
 * Authenticated, and nothing more. No `@RequirePermissions`, so
 * `PermissionsGuard` waves it through; `@SkipModule()` so it works whatever the
 * agency's entitlements; `@SkipTenant()`/`@SkipBranch()` so a **platform
 * operator** — who has no agency and no branch — can file one too. That last
 * one is not a hypothetical: the Super Admin panel is a surface with bugs in it,
 * and `TenantGuard` would otherwise reject its operator with "Agency context
 * required".
 *
 * The identity on the report is still `request.access.userId`, resolved from
 * the database by `AccessContextGuard`. Nothing about who filed a report is
 * client-supplied.
 *
 * ## The upload is three calls, not one
 *
 * `presign` -> the browser `PUT`s the bytes straight to object storage ->
 * `POST /bug-reports` with the keys. The file never passes through the API,
 * which is why there is no multer or `FileInterceptor` anywhere in this
 * codebase. Same chain as deal-audit attachments, quote documents and mailer
 * imports.
 */
@Controller('bug-reports')
@SkipTenant()
@SkipBranch()
@SkipModule()
export class BugReportsController {
  constructor(private readonly service: BugReportsService) {}

  /**
   * The per-screenshot limit rather than the per-report one: five screenshots
   * is five presigns, and a user who mis-clicks and retries should not be
   * locked out of filing the report.
   */
  @Post('screenshots/presign')
  @Throttle({ short: { limit: BUG_REPORT_RATE_LIMIT * 6, ttl: MINUTE_MS } })
  presignScreenshot(
    @Access() access: AccessContext,
    @Body(new ZodValidationPipe(presignBugScreenshotSchema))
    body: PresignBugScreenshotDto,
  ): Promise<PresignedUpload> {
    return this.service.presignScreenshot(access, body);
  }

  @Post()
  @Throttle({ short: { limit: BUG_REPORT_RATE_LIMIT, ttl: MINUTE_MS } })
  create(
    @Access() access: AccessContext,
    @Body(new ZodValidationPipe(createBugReportSchema))
    body: CreateBugReportDto,
  ): Promise<BugReportReceipt> {
    return this.service.create(access, body);
  }
}
