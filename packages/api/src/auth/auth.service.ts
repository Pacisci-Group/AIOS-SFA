import {
  GoneException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { Model } from 'mongoose';
import { JwtPayload } from '@sfa/shared';
import {
  HostTenantResolver,
  type HostTenant,
} from '../common/tenancy/host-tenant.resolver';
import { PermissionsService } from '../permissions/permissions.service';
import { Agency, AgencyDocument } from '../platform/schemas/agency.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { AcceptInviteDto, LoginDto } from './dto/auth.dto';
import { InvitePreview } from './auth.types';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Agency.name) private agencyModel: Model<AgencyDocument>,
    private permissionsService: PermissionsService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private hostResolver: HostTenantResolver,
  ) {}

  async login(dto: LoginDto, host: HostTenant | undefined) {
    const user = await this.userModel.findOne({
      email: dto.email.toLowerCase(),
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.assertBelongsOnHost(user, host);

    return this.issueTokens(user);
  }

  async refresh(refreshToken: string, host: HostTenant | undefined) {
    let user: UserDocument | null;
    try {
      const payload = this.jwtService.verify<JwtPayload>(refreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      });
      user = await this.userModel.findById(payload.sub);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Outside the catch on purpose. Inside it, the specific "wrong agency for
    // this address" message would be caught by this method's own handler and
    // rewritten to "Invalid refresh token" — the SPA would show a session
    // expiry for what is actually a host mismatch, and the user would keep
    // signing in on the wrong address forever.
    await this.assertBelongsOnHost(user, host);

    return this.issueTokens(user);
  }

  /**
   * The host restriction, applied at the moment tokens are issued.
   *
   * `HostTenantGuard` already enforces this on every authenticated request, so
   * this is **not** the security boundary — it is the user-facing half. Without
   * it the credentials are accepted, the SPA stores a token, and the very next
   * call 403s: the user sees a working login followed by an app that will not
   * load, with no explanation. Here they get a sentence at the form.
   *
   * ## What it deliberately does not do
   * It runs **after** the password check, and only after. Running it first would
   * turn the login form into an agency-membership oracle: anyone could type an
   * address and learn from the error whether it belongs to this agency. Past the
   * password check the caller has already proven they hold the account, so the
   * specific message tells them nothing they did not know.
   *
   * A wrong password on a wrong host therefore still reads "Invalid
   * credentials", which is the correct answer to both questions at once.
   */
  private async assertBelongsOnHost(
    user: UserDocument,
    host: HostTenant | undefined,
  ): Promise<void> {
    // No resolved host means the middleware did not run. Fail closed: an
    // unresolvable host is exactly the case `HostTenantGuard` 404s on, so
    // issuing a token here would mint one that cannot be used.
    if (!host || host.kind === 'unknown') {
      throw new UnauthorizedException(
        'No application is served on this address.',
      );
    }

    if (host.kind === 'platform') {
      if (user.isPlatformAdmin) {
        return;
      }
      // An agency with no domain of its own has nowhere else to sign in, so the
      // platform host stays open to it. Mirrors `HostTenantGuard` exactly — if
      // these two ever disagree, one of them produces a login that succeeds and
      // is then refused on the next request. See that guard for the full
      // reasoning.
      const agencyId = user.agencyId?.toString();
      if (agencyId && !(await this.hostResolver.agencyHasDomains(agencyId))) {
        return;
      }
      throw new UnauthorizedException(
        'Sign in on your agency’s own address to use this account.',
      );
    }

    if (user.isPlatformAdmin || user.agencyId?.toString() !== host.agencyId) {
      throw new UnauthorizedException(
        'This account is not part of the agency at this address.',
      );
    }
  }

  /**
   * Public preview of an invite, so the accept page can greet the invitee before
   * they have any credentials.
   *
   * **Discloses only what the holder of the token already knows**: the address
   * the email was sent to, the agency, and the role. No user id, no name, no
   * anything that would turn a guessed token into a directory lookup. The token
   * is 32 random bytes, so guessing is not the threat model — leaking extra
   * fields to a forwarded link is.
   *
   * Expired and unknown are answered differently on purpose (410 vs 404): the
   * page tells an expired invitee to ask for a resend, which is actionable,
   * while an unknown token gets a generic failure.
   */
  async getInvitePreview(token: string): Promise<InvitePreview> {
    const user = await this.userModel.findOne({ inviteToken: token });
    if (!user || user.isActive) {
      throw new NotFoundException('Invite not found');
    }

    const expiresAt = user.inviteTokenExpiresAt;
    if (!expiresAt || expiresAt.getTime() <= Date.now()) {
      throw new GoneException('This invite has expired');
    }

    const [agency, roleNames] = await Promise.all([
      user.agencyId
        ? this.agencyModel.findById(user.agencyId).select('name').lean()
        : null,
      this.permissionsService.resolveRoleNames(user),
    ]);

    return {
      email: user.email,
      agencyName: agency?.name ?? 'your agency',
      roleNames,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async acceptInvite(dto: AcceptInviteDto, host: HostTenant | undefined) {
    const user = await this.userModel.findOne({
      inviteToken: dto.token,
      inviteTokenExpiresAt: { $gt: new Date() },
    });
    if (!user) {
      throw new UnauthorizedException('Invalid or expired invite token');
    }

    // Checked before the password is written, so a link opened on the wrong
    // host leaves the invite intact and re-usable on the right one. Doing it
    // after would consume the token and lock the invitee out of an account they
    // have not yet reached — the invite is single-use.
    //
    // In practice this is belt-and-braces: `TenantUrlService` builds the invite
    // URL from the agency's own primary host, so a correctly-generated link
    // already lands here. It catches the hand-edited and the stale-domain case.
    await this.assertBelongsOnHost(user, host);

    user.passwordHash = await bcrypt.hash(dto.password, 12);
    user.inviteToken = undefined;
    user.inviteTokenExpiresAt = undefined;
    user.isActive = true;
    await user.save();

    return this.issueTokens(user);
  }

  private async issueTokens(user: UserDocument) {
    const access = await this.permissionsService.buildAccessContext(user);
    // Only slim, stable identity claims are signed into the token. The effective
    // permission set is resolved from the store on every request, not trusted
    // from here.
    const claims = this.permissionsService.buildJwtClaims(access);
    const roles = await this.permissionsService.resolveRoleNames(user);
    const name =
      [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || null;
    const accessToken = this.jwtService.sign(claims, {
      secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: this.configService.get<string>(
        'JWT_ACCESS_EXPIRES',
        '15m',
      ) as `${number}m`,
    });
    const refreshToken = this.jwtService.sign(claims, {
      secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
      expiresIn: this.configService.get<string>(
        'JWT_REFRESH_EXPIRES',
        '7d',
      ) as `${number}d`,
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: user._id.toString(),
        email: user.email,
        name,
        roles,
        agencyId: access.agencyId,
        branchId: access.branchId,
        permissions: access.permissions,
        scope: access.scope,
        dataScope: access.dataScope,
        isPlatformAdmin: access.isPlatformAdmin,
      },
    };
  }
}
