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
import type { AccessContext } from '@sfa/shared';
import { AgencyPermission, JwtPayload, PageLevelOverride } from '@sfa/shared';
import {
  Access,
  AgencyId,
  CurrentUser,
} from '../common/decorators/user.decorators';
import {
  RequirePermissions,
  SkipModule,
} from '../common/decorators/access.decorators';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import {
  MINUTE_MS,
  PASSWORD_RESET_ISSUE_RATE_LIMIT,
} from '../config/rate-limit.config';
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

  /**
   * Email an active employee a link to set a new password (PAC-79).
   *
   * `agency:users:write` rather than a new permission, for the same reason
   * `DELETE /:userId` below reuses it: managing employees is already what it
   * means, and inventing a `users:password-reset` would leave every existing
   * owner role without it, so the feature would work for nobody until each was
   * re-granted.
   *
   * The `@Throttle` is per-IP and only catches a flood; the limit that matters
   * is the per-**user** cooldown in `UsersService.sendPasswordReset`, because
   * what needs protecting is the employee's inbox, not the API.
   */
  @Post(':userId/password-reset')
  @RequirePermissions(AgencyPermission.UsersWrite)
  @Throttle({
    short: { limit: PASSWORD_RESET_ISSUE_RATE_LIMIT, ttl: MINUTE_MS },
  })
  sendPasswordReset(
    @AgencyId() agencyId: string,
    @Param('userId') userId: string,
  ) {
    return this.usersService.sendPasswordReset(agencyId, userId);
  }

  /**
   * Revoke a pending invite. 204 — there is nothing left to return.
   *
   * ⚠ Must stay declared **before** `DELETE /:userId`. Nest matches routes in
   * declaration order, and the bare `:userId` pattern would otherwise swallow
   * `/:userId/invite`, silently turning every revoke into a removal.
   */
  @Delete(':userId/invite')
  @RequirePermissions(AgencyPermission.UsersWrite)
  @HttpCode(HttpStatus.NO_CONTENT)
  revokeInvite(@AgencyId() agencyId: string, @Param('userId') userId: string) {
    return this.usersService.revokeInvite(agencyId, userId);
  }

  /**
   * Remove an employee from the agency.
   *
   * Deactivates rather than deletes — see `UsersService.deactivateUser` for why,
   * and note that access really is revoked on their very next request, not at
   * token expiry. Returns what was released so the UI can tell the owner how
   * many tickets just went back to the unassigned queue.
   *
   * `agency:users:write` rather than a new permission: managing employees is
   * already exactly what that permission means, and inventing a `users:delete`
   * would leave every existing owner role without it.
   */
  @Delete(':userId')
  @RequirePermissions(AgencyPermission.UsersWrite)
  deactivate(
    @AgencyId() agencyId: string,
    @Access() access: AccessContext,
    @Param('userId') userId: string,
  ) {
    return this.usersService.deactivateUser(access, agencyId, userId);
  }

  /** Restore a removed employee. Does not restore the work released on removal. */
  @Post(':userId/reactivate')
  @RequirePermissions(AgencyPermission.UsersWrite)
  reactivate(@AgencyId() agencyId: string, @Param('userId') userId: string) {
    return this.usersService.reactivateUser(agencyId, userId);
  }

  @Patch(':userId/roles')
  @RequirePermissions(AgencyPermission.UsersWrite)
  updateRoles(
    @AgencyId() agencyId: string,
    @Access() access: AccessContext,
    @Param('userId') userId: string,
    @Body() body: { roleIds: string[] },
  ) {
    return this.usersService.updateRoles(
      access,
      agencyId,
      userId,
      body.roleIds,
    );
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
