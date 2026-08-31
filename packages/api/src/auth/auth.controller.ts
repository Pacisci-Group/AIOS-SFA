import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import type { JwtPayload } from '@sfa/shared';
import {
  Public,
  SkipBranch,
  SkipModule,
  SkipTenant,
} from '../common/decorators/access.decorators';
import { CurrentUser } from '../common/decorators/user.decorators';
import { AuthService } from './auth.service';
import { AcceptInviteDto, LoginDto, RefreshTokenDto } from './dto/auth.dto';

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
}
