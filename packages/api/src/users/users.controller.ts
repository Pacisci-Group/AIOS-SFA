import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AgencyPermission } from '@sfa/shared';
import { AgencyId } from '../common/decorators/user.decorators';
import {
  RequirePermissions,
  SkipModule,
} from '../common/decorators/access.decorators';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { UsersService } from './users.service';

@Controller('users')
@SkipModule()
@UseGuards(PermissionsGuard)
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get()
  @RequirePermissions(AgencyPermission.UsersRead)
  list(@AgencyId() agencyId: string) {
    return this.usersService.findByAgency(agencyId!);
  }

  @Get('assignable-permissions')
  @RequirePermissions(AgencyPermission.UsersPermissions)
  assignablePermissions(@AgencyId() agencyId: string) {
    return this.usersService.listAssignablePermissions(agencyId!);
  }

  @Get(':userId')
  @RequirePermissions(AgencyPermission.UsersRead)
  getOne(@AgencyId() agencyId: string, @Param('userId') userId: string) {
    return this.usersService.findById(agencyId!, userId);
  }

  @Post('invite')
  @RequirePermissions(AgencyPermission.UsersWrite)
  invite(
    @AgencyId() agencyId: string,
    @Body()
    body: {
      email: string;
      roleIds: string[];
      branchId?: string;
      firstName?: string;
      lastName?: string;
    },
  ) {
    return this.usersService.inviteUser({ agencyId: agencyId!, ...body });
  }

  @Patch(':userId/roles')
  @RequirePermissions(AgencyPermission.UsersWrite)
  updateRoles(
    @AgencyId() agencyId: string,
    @Param('userId') userId: string,
    @Body() body: { roleIds: string[] },
  ) {
    return this.usersService.updateRoles(agencyId!, userId, body.roleIds);
  }

  @Patch(':userId/permissions')
  @RequirePermissions(AgencyPermission.UsersPermissions)
  updatePermissions(
    @AgencyId() agencyId: string,
    @Param('userId') userId: string,
    @Body() body: { grants?: string[]; revokes?: string[] },
  ) {
    return this.usersService.updatePermissions(agencyId!, userId, body);
  }
}
