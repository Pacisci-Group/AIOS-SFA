import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { AgencyPermission } from '@sfa/shared';
import { Model } from 'mongoose';
import {
  RequirePermissions,
  SkipModule,
} from '../common/decorators/access.decorators';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permission } from './schemas/permission.schema';

/**
 * The permission catalog.
 *
 * What makes a role editor possible for the 13 `agency:*` / `platform:*`
 * capabilities that have no UI at all today — the web's matrix is driven by the
 * static `PAGES` list, which only covers the 26 page permissions.
 *
 * `@SkipModule()` for the same reason as `RolesController`: administering
 * permissions cannot depend on which pages the agency has switched on.
 */
@Controller('permissions')
@SkipModule()
@UseGuards(PermissionsGuard)
export class PermissionsController {
  constructor(
    @InjectModel(Permission.name)
    private readonly permissionModel: Model<Permission>,
  ) {}

  /**
   * Deprecated permissions are hidden by default. They are kept as rows because
   * `rolePermissions` may still reference them, but offering one in a picker
   * would invite granting a permission nothing checks.
   */
  @Get()
  @RequirePermissions(AgencyPermission.RolesRead)
  list(@Query('includeDeprecated') includeDeprecated?: string) {
    const filter =
      includeDeprecated === 'true' ? {} : { isDeprecated: { $ne: true } };
    return this.permissionModel
      .find(filter)
      .sort({ kind: 1, sortOrder: 1 })
      .select('-__v')
      .lean();
  }
}
