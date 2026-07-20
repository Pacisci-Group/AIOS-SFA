import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { AgencyPermission, PageLevelOverride } from '@sfa/shared';
import { AgencyId } from '../common/decorators/user.decorators';
import {
  RequirePermissions,
  SkipModule,
} from '../common/decorators/access.decorators';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RolesService } from './roles.service';

/** Read + permission-set editing for agency roles. */
@Controller('roles')
@SkipModule()
@UseGuards(PermissionsGuard)
export class RolesController {
  constructor(private rolesService: RolesService) {}

  @Get()
  @RequirePermissions(AgencyPermission.RolesRead)
  list(@AgencyId() agencyId: string) {
    return this.rolesService.findByAgency(agencyId!);
  }

  @Get(':roleId')
  @RequirePermissions(AgencyPermission.RolesRead)
  getOne(@AgencyId() agencyId: string, @Param('roleId') roleId: string) {
    return this.rolesService.findById(agencyId!, roleId);
  }

  @Patch(':roleId')
  @RequirePermissions(AgencyPermission.RolesWrite)
  updateLevels(
    @AgencyId() agencyId: string,
    @Param('roleId') roleId: string,
    @Body() body: { levels: PageLevelOverride[] },
  ) {
    return this.rolesService.updateLevels(agencyId!, roleId, body.levels ?? []);
  }
}
