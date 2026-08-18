import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AgencyPermission, JwtPayload, PageLevelOverride } from '@sfa/shared';
import { AgencyId, CurrentUser } from '../common/decorators/user.decorators';
import {
  RequirePermissions,
  SkipModule,
} from '../common/decorators/access.decorators';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { MINUTE_MS } from '../config/rate-limit.config';
import { InviteUserDto } from './dto/invite-user.dto';
import { UsersService } from './users.service';

@Controller('users')
@SkipModule()
@UseGuards(PermissionsGuard)
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get()
  @RequirePermissions(AgencyPermission.UsersRead)
  list(@AgencyId() agencyId: string) {
    return this.usersService.findByAgency(agencyId);
  }

  @Get('assignable-permissions')
  @RequirePermissions(AgencyPermission.UsersPermissions)
  assignablePermissions(@AgencyId() agencyId: string) {
    return this.usersService.listAssignablePermissions(agencyId);
  }

  @Get(':userId')
  @RequirePermissions(AgencyPermission.UsersRead)
  getOne(@AgencyId() agencyId: string, @Param('userId') userId: string) {
    return this.usersService.findById(agencyId, userId);
  }

  @Post('invite')
  @RequirePermissions(AgencyPermission.UsersWrite)
  invite(
    @AgencyId() agencyId: string,
    @CurrentUser() actor: JwtPayload | undefined,
    @Body() body: InviteUserDto,
  ) {
    return this.usersService.inviteUser({
      agencyId,
      ...body,
      invitedByUserId: actor?.sub,
    });
  }

  /**
   * Resend a pending invite with a fresh token.
   *
   * The `@Throttle` here is per-IP and only catches a flood; the meaningful
   * limit is the per-**user** cooldown in `UsersService.resendInvite`, because
   * what needs protecting is the invitee's inbox, not the API.
   */
  @Post(':userId/invite/resend')
  @RequirePermissions(AgencyPermission.UsersWrite)
  @Throttle({ short: { limit: 10, ttl: MINUTE_MS } })
  resendInvite(
    @AgencyId() agencyId: string,
    @CurrentUser() actor: JwtPayload | undefined,
    @Param('userId') userId: string,
  ) {
    return this.usersService.resendInvite(agencyId, userId, actor?.sub);
  }

  /** Revoke a pending invite. 204 — there is nothing left to return. */
  @Delete(':userId/invite')
  @RequirePermissions(AgencyPermission.UsersWrite)
  @HttpCode(HttpStatus.NO_CONTENT)
  revokeInvite(@AgencyId() agencyId: string, @Param('userId') userId: string) {
    return this.usersService.revokeInvite(agencyId, userId);
  }

  @Patch(':userId/roles')
  @RequirePermissions(AgencyPermission.UsersWrite)
  updateRoles(
    @AgencyId() agencyId: string,
    @Param('userId') userId: string,
    @Body() body: { roleIds: string[] },
  ) {
    return this.usersService.updateRoles(agencyId, userId, body.roleIds);
  }

  @Patch(':userId/permissions')
  @RequirePermissions(AgencyPermission.UsersPermissions)
  updatePermissions(
    @AgencyId() agencyId: string,
    @Param('userId') userId: string,
    @Body() body: { overrides: PageLevelOverride[] },
  ) {
    return this.usersService.updatePermissions(
      agencyId,
      userId,
      body.overrides ?? [],
    );
  }
}
