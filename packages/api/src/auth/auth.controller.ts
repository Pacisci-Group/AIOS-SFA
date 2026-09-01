import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Public } from '../common/decorators/access.decorators';
import { HostTenant } from '../common/decorators/user.decorators';
import type { HostTenant as ResolvedHostTenant } from '../common/tenancy/host-tenant.resolver';
import { AuthService } from './auth.service';
import { AcceptInviteDto, LoginDto, RefreshTokenDto } from './dto/auth.dto';

/**
 * Every route here is `@Public()`, so `HostTenantGuard` does not run and each
 * one carries the host restriction itself — that is what `@HostTenant()` is
 * doing in these signatures. Omitting it on a new route in this controller
 * would quietly open a way to mint a token on any hostname.
 */
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto, @HostTenant() host: ResolvedHostTenant) {
    return this.authService.login(dto, host);
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
}
