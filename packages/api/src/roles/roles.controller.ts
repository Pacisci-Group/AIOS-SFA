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
import { AgencyPermission, PageLevelOverride } from '@sfa/shared';
import { AgencyId } from '../common/decorators/user.decorators';
import {
  RequirePermissions,
  SkipModule,
} from '../common/decorators/access.decorators';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { CreateRoleDto, UpdateRoleDto } from './dto/role.dto';
import { RolesService } from './roles.service';
import { RoleListItem, RoleResponse } from './roles.types';

/**
 * Agency roles: read, create, edit and delete.
 *
 * `@SkipModule()` because role management is an agency capability, not a page —
 * it must stay reachable whatever modules the agency has enabled.
 */
@Controller('roles')
@SkipModule()
@UseGuards(PermissionsGuard)
export class RolesController {
  constructor(private rolesService: RolesService) {}

  @Get()
  @RequirePermissions(AgencyPermission.RolesRead)
  list(@AgencyId() agencyId: string): Promise<RoleListItem[]> {
    return this.rolesService.findByAgency(agencyId);
  }

  @Get(':roleId')
  @RequirePermissions(AgencyPermission.RolesRead)
  getOne(
    @AgencyId() agencyId: string,
    @Param('roleId') roleId: string,
  ): Promise<RoleResponse> {
    return this.rolesService.findById(agencyId, roleId);
  }

  @Post()
  @RequirePermissions(AgencyPermission.RolesWrite)
  create(
    @AgencyId() agencyId: string,
    @Body() body: CreateRoleDto,
  ): Promise<RoleResponse> {
    return this.rolesService.create(agencyId, body);
  }

  /**
   * Update a role: its name, description, data scope, and/or its per-page
   * permission levels.
   *
   * One endpoint taking both on purpose. `{ levels }` is the shape the web has
   * always sent here, so splitting the metadata onto a second route would break
   * `updateRoleLevels` for no gain. Each part is applied only when present.
   */
  @Patch(':roleId')
  @RequirePermissions(AgencyPermission.RolesWrite)
  async update(
    @AgencyId() agencyId: string,
    @Param('roleId') roleId: string,
    @Body() body: UpdateRoleDto & { levels?: PageLevelOverride[] },
  ): Promise<RoleResponse> {
    const { levels, ...details } = body;
    let role = await this.rolesService.findById(agencyId, roleId);
    if (Object.values(details).some((value) => value !== undefined)) {
      role = await this.rolesService.update(agencyId, roleId, details);
    }
    if (levels) {
      role = await this.rolesService.updateLevels(agencyId, roleId, levels);
    }
    return role;
  }

  @Delete(':roleId')
  @HttpCode(204)
  @RequirePermissions(AgencyPermission.RolesWrite)
  remove(
    @AgencyId() agencyId: string,
    @Param('roleId') roleId: string,
  ): Promise<void> {
    return this.rolesService.remove(agencyId, roleId);
  }
}
