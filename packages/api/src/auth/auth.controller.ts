import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { JwtPayload } from '@sfa/shared';
import {
  Public,
  SkipBranch,
  SkipModule,
  SkipTenant,
} from '../common/decorators/access.decorators';
import { CurrentUser } from '../common/decorators/user.decorators';
import {
  MINUTE_MS,
  PASSWORD_RESET_PREVIEW_RATE_LIMIT,
  PASSWORD_RESET_SUBMIT_RATE_LIMIT,
} from '../config/rate-limit.config';
import { AuthService } from './auth.service';
import {
  AcceptInviteDto,
  LoginDto,
  RefreshTokenDto,
  ResetPasswordDto,
} from './dto/auth.dto';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  /**
   * The caller's own identity and current permissions.
   *
   * Authenticated but otherwise ungated — `@SkipTenant`/`@SkipBranch` because a
   * platform admin has no agency or branch, and asking "who am I" must work for
   * them too.
   *
   * The client keeps this blob and reads permissions from it; without this
   * endpoint it could only refresh at login or token refresh, so a permission
   * change took up to the token lifetime to reach a signed-in browser.
   */
  @Get('me')
  @SkipTenant()
  @SkipBranch()
  @SkipModule()
  me(@CurrentUser() user: JwtPayload) {
    return this.authService.me(user.sub);
  }

  @Public()
  @Post('refresh')
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  /**
   * Public invite preview for the accept page. `200` valid · `410` expired ·
   * `404` unknown or already accepted.
   */
  @Public()
  @Get('invite/:token')
  getInvite(@Param('token') token: string) {
    return this.authService.getInvitePreview(token);
  }

  @Public()
  @Post('accept-invite')
  acceptInvite(@Body() dto: AcceptInviteDto) {
    return this.authService.acceptInvite(dto);
  }

  /**
   * Public preview of an admin-triggered password reset (PAC-79). `200` valid ·
   * `410` expired · `404` unknown, already used, or the user has since been
   * deactivated.
   *
   * Carries its own `@Throttle` because the rest of `/auth/*` sits on the
   * generous authenticated baseline, and this is an unauthenticated route that
   * returns an email address.
   */
  @Public()
  @Get('password-reset/:token')
  @Throttle({
    short: { limit: PASSWORD_RESET_PREVIEW_RATE_LIMIT, ttl: MINUTE_MS },
  })
  getPasswordReset(@Param('token') token: string) {
    return this.authService.getPasswordResetPreview(token);
  }

  /**
   * Set a new password from a reset link and sign in (PAC-79).
   *
   * The tightest public limit in the API: an unauthenticated write that changes
   * a credential.
   */
  @Public()
  @Post('reset-password')
  @Throttle({
    short: { limit: PASSWORD_RESET_SUBMIT_RATE_LIMIT, ttl: MINUTE_MS },
  })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }
}
