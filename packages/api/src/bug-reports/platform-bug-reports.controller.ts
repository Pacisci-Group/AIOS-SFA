import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { BugReportDetail, BugReportListResponse } from '@sfa/shared';
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
  listBugReportsSchema,
  updateBugReportSchema,
  type ListBugReportsDto,
  type UpdateBugReportDto,
} from './dto/bug-report.dto';
import { PlatformBugReportsService } from './platform-bug-reports.service';

/**
 * The Super Admin bug queue.
 *
 * Same platform guard stack as `PlatformController` and
 * `PlatformMailersController`: `@SkipTenant()` because the operator has no
 * agency of their own and reads across all of them, `@SkipBranch()` because a
 * bug report has no branch dimension, `@SkipModule()` because this is not an
 * agency-facing page and must not depend on any tenant's entitlements.
 *
 * ⚠ The reporter-facing half (`BugReportsController`) deliberately requires
 * **no** permission. These two are the read and write ends of the same
 * collection with very different gates, and that asymmetry is the design:
 * anyone may report, only the platform may read.
 */
@Controller('platform/bug-reports')
@SkipTenant()
@SkipBranch()
@SkipModule()
@UseGuards(PermissionsGuard)
export class PlatformBugReportsController {
  constructor(private readonly service: PlatformBugReportsService) {}

  @Get()
  @RequirePermissions(PlatformPermission.BugsRead)
  list(
    @Query(new ZodValidationPipe(listBugReportsSchema))
    query: ListBugReportsDto,
  ): Promise<BugReportListResponse> {
    return this.service.list(query);
  }

  @Get(':id')
  @RequirePermissions(PlatformPermission.BugsRead)
  get(@Param('id') id: string): Promise<BugReportDetail> {
    return this.service.get(id);
  }

  @Patch(':id')
  @RequirePermissions(PlatformPermission.BugsWrite)
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateBugReportSchema))
    body: UpdateBugReportDto,
    @CurrentUser() user: { sub: string },
  ): Promise<BugReportDetail> {
    return this.service.update(id, body, user.sub);
  }
}
