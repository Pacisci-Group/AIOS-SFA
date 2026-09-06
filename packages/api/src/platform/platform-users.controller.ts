import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { PlatformPermission } from '@sfa/shared';
import {
  RequirePermissions,
  SkipBranch,
  SkipModule,
  SkipTenant,
} from '../common/decorators/access.decorators';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  listPlatformUsersSchema,
  type ListPlatformUsersDto,
} from './dto/list-platform-users.dto';
import { PlatformUsersService } from './platform-users.service';

/**
 * Find / Impersonate User — the Super Admin panel's user directory (PAC-70).
 *
 * The read half of impersonation: search every user on the platform, then hand
 * the chosen id to `POST /auth/impersonate/:userId`. Gated on
 * `platform:users:read`, deliberately separate from `platform:users:impersonate`
 * so an operator who only triages can hold the first without the second.
 *
 * ## Why the platform guard stack
 *
 * `@SkipTenant()` because a platform operator has no `agencyId` of their own —
 * the whole point is to see across tenants; `@SkipBranch()` because a
 * directory has no branch dimension; `@SkipModule()` because this is not an
 * agency-facing page and no agency's module entitlements apply to it. Same
 * stack as `PlatformController` and `PlatformMailersController`.
 *
 * ⚠ Do not widen `UsersController.list()` for this. That one is agency-scoped
 * through `@AgencyId()` and is correct as it stands; a cross-tenant read
 * belongs under `/platform/*`, where the permission string says so.
 */
@Controller('platform/users')
@SkipTenant()
@SkipBranch()
@SkipModule()
@UseGuards(PermissionsGuard)
export class PlatformUsersController {
  constructor(private readonly service: PlatformUsersService) {}

  @Get()
  @RequirePermissions(PlatformPermission.UsersRead)
  list(
    @Query(new ZodValidationPipe(listPlatformUsersSchema))
    query: ListPlatformUsersDto,
  ) {
    return this.service.list(query);
  }

  /**
   * Options for the Role filter: one per distinct slug across the platform.
   * Lives here rather than under a `platform:roles:*` permission because it
   * exists only to drive this directory's filter.
   */
  @Get('roles')
  @RequirePermissions(PlatformPermission.UsersRead)
  roles() {
    return this.service.roleOptions();
  }
}
