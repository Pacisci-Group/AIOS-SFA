import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
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
  commitMailerImportSchema,
  createMailerImportSchema,
  presignMailerImportSchema,
  type CommitMailerImportDto,
  type CreateMailerImportDto,
  type PresignMailerImportDto,
} from './dto/mailer-import.dto';
import { PlatformMailersService } from './platform-mailers.service';

/**
 * Add Mailers — the Super Admin panel's only live feature (PAC-73).
 *
 * ## Why the platform guard stack
 *
 * `@SkipTenant()` because a platform operator has no `agencyId` of their own
 * and passes the target agency explicitly; `@SkipBranch()` because mailers have
 * no branch dimension; `@SkipModule()` because this is not an agency-facing
 * page and must work whether or not the target agency has the `mailers` module
 * enabled — an operator loading a tenant's first mailer file should not have to
 * flip an entitlement first. Same stack `PlatformController` uses.
 *
 * ⚠ `platform:mailers:*` is **not** the agency-facing `mailers:read` module
 * permission PAC-61's drawer uses. Nothing here grants access to that, and
 * holding it grants nothing here.
 *
 * ## The upload is three calls, not one
 *
 * `presign` → the browser `PUT`s the bytes straight to object storage →
 * `POST /imports`. The file never passes through the API, which is why there is
 * no multer or `FileInterceptor` anywhere in this codebase and why none should
 * be introduced. Same chain as deal-audit attachments and sold documents.
 */
@Controller('platform/mailers')
@SkipTenant()
@SkipBranch()
@SkipModule()
@UseGuards(PermissionsGuard)
export class PlatformMailersController {
  constructor(private readonly service: PlatformMailersService) {}

  @Post('imports/presign')
  @RequirePermissions(PlatformPermission.MailersWrite)
  presign(
    @Body(new ZodValidationPipe(presignMailerImportSchema))
    body: PresignMailerImportDto,
  ) {
    return this.service.presignUpload(body);
  }

  @Post('imports')
  @RequirePermissions(PlatformPermission.MailersWrite)
  createImport(
    @Body(new ZodValidationPipe(createMailerImportSchema))
    body: CreateMailerImportDto,
    @CurrentUser() user: { sub: string },
  ) {
    return this.service.createImport(body, user.sub);
  }

  @Get('imports')
  @RequirePermissions(PlatformPermission.MailersRead)
  listImports(@Query('agencyId') agencyId: string) {
    return this.service.listImports(agencyId);
  }

  @Get('imports/:runId')
  @RequirePermissions(PlatformPermission.MailersRead)
  getImport(@Param('runId') runId: string) {
    return this.service.getImport(runId);
  }

  /**
   * 200 rather than 201: this starts work on an existing run, it does not
   * create a resource. The response is the same run with a new status.
   */
  @Post('imports/:runId/commit')
  @HttpCode(200)
  @RequirePermissions(PlatformPermission.MailersWrite)
  commitImport(
    @Param('runId') runId: string,
    @Body(new ZodValidationPipe(commitMailerImportSchema))
    body: CommitMailerImportDto,
  ) {
    return this.service.commitImport(runId, body);
  }
}
