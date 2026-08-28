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
import { AccessContext, JwtPayload } from '@sfa/shared';
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
  ) {}

  async login(dto: LoginDto) {
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

    return this.issueTokens(user);
  }

  async refresh(refreshToken: string) {
    try {
      const payload = this.jwtService.verify<JwtPayload>(refreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      });
      const user = await this.userModel.findById(payload.sub);
      if (!user || !user.isActive) {
        throw new UnauthorizedException('Invalid refresh token');
      }
      return this.issueTokens(user);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
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

  async acceptInvite(dto: AcceptInviteDto) {
    const user = await this.userModel.findOne({
      inviteToken: dto.token,
      inviteTokenExpiresAt: { $gt: new Date() },
    });
    if (!user) {
      throw new UnauthorizedException('Invalid or expired invite token');
    }

    user.passwordHash = await bcrypt.hash(dto.password, 12);
    user.inviteToken = undefined;
    user.inviteTokenExpiresAt = undefined;
    user.isActive = true;
    await user.save();

    return this.issueTokens(user);
  }

  /**
   * The `user` blob returned by login, refresh, accept-invite and `GET /me`.
   *
   * Factored out so those four can never drift: the whole value of `/me` is
   * that a client can refresh this object and get *exactly* what it was given
   * at login, only current.
   *
   * `roles` are display names. Never branch on them — `permissions` is the
   * authority, and it is resolved from the database, never from the token.
   */
  private toAuthUser(user: UserDocument, access: AccessContext, roles: string[]) {
    return {
      id: user._id.toString(),
      email: user.email,
      name:
        [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || null,
      roles,
      agencyId: access.agencyId,
      branchId: access.branchId,
      permissions: access.permissions,
      scope: access.scope,
      dataScope: access.dataScope,
      isPlatformAdmin: access.isPlatformAdmin,
    };
  }

  /**
   * The caller's current identity and freshly resolved permissions.
   *
   * Exists because the web keeps this blob in `localStorage` and only rewrote it
   * at login, refresh and accept-invite — so a permission change did not reach a
   * signed-in browser for up to the access-token lifetime, even though the API
   * had been enforcing it since the moment it was saved.
   */
  async me(userId: string) {
    const user = await this.userModel.findById(userId);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const [access, roles] = await Promise.all([
      this.permissionsService.buildAccessContext(user),
      this.permissionsService.resolveRoleNames(user),
    ]);
    return this.toAuthUser(user, access, roles);
  }

  private async issueTokens(user: UserDocument) {
    const access = await this.permissionsService.buildAccessContext(user);
    // Only slim, stable identity claims are signed into the token. The effective
    // permission set is resolved from the store on every request, not trusted
    // from here.
    const claims = this.permissionsService.buildJwtClaims(access);
    const roles = await this.permissionsService.resolveRoleNames(user);
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
      user: this.toAuthUser(user, access, roles),
    };
  }
}
