import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
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
  listZipMarketsSchema,
  upsertZipMarketsSchema,
  type ListZipMarketsDto,
  type UpsertZipMarketsDto,
} from './dto/mailer-zip-market.dto';
import { MailerZipMarketsService } from './mailer-zip-markets.service';

/**
 * The ZIP → market table, in the Super Admin panel (PAC-71).
 *
 * ## Why the platform guard stack
 *
 * `@SkipTenant()` because the table is platform-global — a campaign can serve
 * many agencies, so during a preview no single agency owns the resolution;
 * `@SkipBranch()` because a ZIP mapping has no branch dimension; `@SkipModule()`
 * because this is not an agency-facing page and no tenant's module entitlements
 * apply. Same stack as `PlatformUsersController`.
 *
 * ⚠ `platform:mailers:*` is **not** the agency-facing `mailers:read` the drawer
 * uses. Nothing here grants access to that, and holding it grants nothing here.
 *
 * ## `PUT` rather than `POST`
 *
 * Every write is an upsert keyed on `(agencyId, zip5)`, so the operation is
 * idempotent: sending the same block twice leaves the table in the same state.
 * A `POST` would imply a second row per send, which the unique index refuses.
 */
@Controller('platform/mailer-zip-markets')
@SkipTenant()
@SkipBranch()
@SkipModule()
@UseGuards(PermissionsGuard)
export class PlatformMailerZipMarketsController {
  constructor(private readonly service: MailerZipMarketsService) {}

  @Get()
  @RequirePermissions(PlatformPermission.MailersRead)
  list(
    @Query(new ZodValidationPipe(listZipMarketsSchema))
    query: ListZipMarketsDto,
  ) {
    return this.service.list(query);
  }

  @Put()
  @RequirePermissions(PlatformPermission.MailersWrite)
  upsert(
    @Body(new ZodValidationPipe(upsertZipMarketsSchema))
    body: UpsertZipMarketsDto,
    @CurrentUser() user: { sub: string },
  ) {
    return this.service.upsertMany(body, user.sub);
  }

  @Delete(':id')
  @RequirePermissions(PlatformPermission.MailersWrite)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
