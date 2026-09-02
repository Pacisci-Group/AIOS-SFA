import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { JwtPayload } from '@sfa/shared';
import { PlatformPermission } from '@sfa/shared';
import {
  Public,
  RequirePermissions,
  SkipBranch,
  SkipModule,
  SkipTenant,
} from '../common/decorators/access.decorators';
import { CurrentUser, HostTenant } from '../common/decorators/user.decorators';
import type { HostTenant as ResolvedHostTenant } from '../common/tenancy/host-tenant.resolver';
import {
  CHANGE_PASSWORD_RATE_LIMIT,
  HOUR_MS,
  MINUTE_MS,
  PASSWORD_RESET_PREVIEW_RATE_LIMIT,
  PASSWORD_RESET_REQUEST_HOURLY_LIMIT,
  PASSWORD_RESET_REQUEST_RATE_LIMIT,
  PASSWORD_RESET_SUBMIT_RATE_LIMIT,
} from '../config/rate-limit.config';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import {
  AcceptInviteDto,
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  RefreshTokenDto,
  ResetPasswordDto,
} from './dto/auth.dto';

/**
 * Every route here is `@Public()`, so `HostTenantGuard` does not run and each
 * one carries the host restriction itself — that is what `@HostTenant()` is
 * doing in these signatures. Omitting it on a new route in this controller
 * would quietly open a way to mint a token on any hostname.
 */
@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    // For the forgot-password request only — the mint-and-email path is owned
    // by `UsersService` (PAC-79) and this route is just its public entry point.
    private usersService: UsersService,
  ) {}

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto, @HostTenant() host: ResolvedHostTenant) {
    return this.authService.login(dto, host);
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
    return this.authService.me(user.sub, user.impersonatedBy);
  }

  /**
   * Mint a session as another user (PAC-70).
   *
   * `@SkipTenant`/`@SkipBranch` for the same reason `GET /me` skips them: the
   * caller is a platform admin with no agency of their own, and the target's
   * tenant is derived from the target, not from a request header.
   *
   * Gated on `platform:users:impersonate` — a distinct capability, not something
   * `isPlatformAdmin` implies, so it can be revoked without demoting an admin.
   * The refusals that bound it (never a platform admin, never an inactive user,
   * never yourself) live in `AuthService.impersonate`.
   *
   * Returns exactly what `POST /auth/login` returns, so a client — or Bruno —
   * can use it interchangeably. The only difference is `user.impersonatedBy`.
   */
  @Post('impersonate/:userId')
  @SkipTenant()
  @SkipBranch()
  @SkipModule()
  @RequirePermissions(PlatformPermission.UsersImpersonate)
  impersonate(
    @CurrentUser() user: JwtPayload,
    @Param('userId') userId: string,
  ) {
    return this.authService.impersonate(user, userId);
  }

  @Public()
  @Post('refresh')
  refresh(
    @Body() dto: RefreshTokenDto,
    @HostTenant() host: ResolvedHostTenant,
  ) {
    return this.authService.refresh(dto.refreshToken, host);
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
  acceptInvite(
    @Body() dto: AcceptInviteDto,
    @HostTenant() host: ResolvedHostTenant,
  ) {
    return this.authService.acceptInvite(dto, host);
  }

  /**
   * Authenticated self-service password change (PAC-81).
   *
   * `@SkipTenant`/`@SkipBranch`/`@SkipModule` for the same reason `GET /me`
   * skips them: changing your own password must work for a platform admin
   * too, and it is not a module an agency can switch off. Open to any
   * authenticated session — the current-password check is the identity proof.
   * The one error shape that matters (wrong current password is a `400`, not
   * a `401`) lives on `AuthService.changePassword`.
   *
   * Returns a fresh token pair — the change invalidates the very token that
   * authenticated the request.
   */
  @Post('change-password')
  @SkipTenant()
  @SkipBranch()
  @SkipModule()
  @Throttle({
    short: { limit: CHANGE_PASSWORD_RATE_LIMIT, ttl: MINUTE_MS },
  })
  changePassword(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(user, dto);
  }

  /**
   * The self-service "Forgot password?" request (PAC-81). The one route in
   * this controller whose response deliberately says nothing: always `202`
   * with the same message, whether or not the address exists, belongs on this
   * host, or is inside its resend cooldown — anything else is an account
   * oracle on an unauthenticated route. The silence lives in
   * `UsersService.requestPasswordResetByEmail`; the two throttle windows here
   * are what bound how fast anyone can probe.
   */
  @Public()
  @Post('forgot-password')
  @HttpCode(202)
  @Throttle({
    short: { limit: PASSWORD_RESET_REQUEST_RATE_LIMIT, ttl: MINUTE_MS },
    long: { limit: PASSWORD_RESET_REQUEST_HOURLY_LIMIT, ttl: HOUR_MS },
  })
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @HostTenant() host: ResolvedHostTenant,
  ) {
    await this.usersService.requestPasswordResetByEmail(dto.email, host);
    return {
      message:
        'If an account exists for that address, a password reset link is on its way.',
    };
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
  resetPassword(
    @Body() dto: ResetPasswordDto,
    @HostTenant() host: ResolvedHostTenant,
  ) {
    return this.authService.resetPassword(dto, host);
  }
}
