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
import { hashResetToken } from '../common/crypto/reset-token';
import { AccessResolverService } from '../permissions/access-resolver.service';
import { PermissionsService } from '../permissions/permissions.service';
import { Agency, AgencyDocument } from '../platform/schemas/agency.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { AcceptInviteDto, LoginDto, ResetPasswordDto } from './dto/auth.dto';
import { InvitePreview, PasswordResetPreview } from './auth.types';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Agency.name) private agencyModel: Model<AgencyDocument>,
    private permissionsService: PermissionsService,
    private accessResolver: AccessResolverService,
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
      /*
       * Refresh tokens are stateless — there is no revocation list, and this is
       * the only check standing between a stolen one and an endless supply of
       * fresh access tokens. `AccessContextGuard` makes the same comparison for
       * access tokens; without it here, a password reset would lock an attacker
       * out for fifteen minutes and then hand them a new token (PAC-79).
       */
      if ((payload.tokenVersion ?? 0) !== (user.tokenVersion ?? 0)) {
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
    /*
     * A password change by *any* route invalidates every other live credential
     * for that account, not just the one that was used (PAC-79). In practice an
     * invitee has no sessions and no reset token — the guards make the invited
     * and active states disjoint — so this is belt-and-braces. It is here so the
     * invariant holds by construction rather than by a chain of reasoning about
     * which states can coexist.
     */
    user.passwordResetToken = undefined;
    user.passwordResetExpiresAt = undefined;
    user.tokenVersion = (user.tokenVersion ?? 0) + 1;
    await user.save();
    await this.accessResolver.invalidateUser(user._id.toString());

    return this.issueTokens(user);
  }

  /**
   * Public preview of a password-reset link, so the page can show whose account
   * it is and fail early on a dead link. Mirrors {@link getInvitePreview},
   * including its `404` vs `410` split — the page tells an expired user to ask
   * their owner for another, which is actionable, where an unknown token gets a
   * generic failure.
   *
   * Discloses less than the invite preview does: no roles. An invitee has not
   * seen their role yet and the greeting is the point; the holder of a reset
   * link is being reminded which account it is, and the role adds nothing they
   * need.
   */
  async getPasswordResetPreview(token: string): Promise<PasswordResetPreview> {
    // Hash first, always. The stored value is a digest, so a raw-token
    // comparison would simply never match and every link would read as unknown.
    const user = await this.userModel.findOne({
      passwordResetToken: hashResetToken(token),
    });
    if (!user || !user.isActive || user.deactivatedAt) {
      throw new NotFoundException('Password reset not found');
    }

    const expiresAt = user.passwordResetExpiresAt;
    if (!expiresAt || expiresAt.getTime() <= Date.now()) {
      throw new GoneException('This password reset link has expired');
    }

    const agency = user.agencyId
      ? await this.agencyModel.findById(user.agencyId).select('name').lean()
      : null;

    return {
      email: user.email,
      agencyName: agency?.name ?? 'your agency',
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Complete a reset: set the password, burn the token, end every existing
   * session, and sign the caller in.
   *
   * Deliberately unlike {@link acceptInvite} in one respect — `isActive` is not
   * touched. Resetting a password must never reactivate an account, and the
   * checks below mean a deactivated user cannot reach this line anyway.
   */
  async resetPassword(dto: ResetPasswordDto) {
    const user = await this.userModel.findOne({
      passwordResetToken: hashResetToken(dto.token),
      passwordResetExpiresAt: { $gt: new Date() },
    });
    if (!user) {
      throw new UnauthorizedException('Invalid or expired reset token');
    }
    /*
     * Second line of defence. `deactivateUser` clears these fields precisely so
     * a removed employee cannot walk back in, but a link minted *before* the
     * removal is already in an inbox and its digest is gone from the row it
     * pointed at — so this catches the case where the fields were somehow left
     * behind rather than relying on that cleanup having run.
     */
    if (!user.isActive || user.deactivatedAt) {
      throw new UnauthorizedException('Invalid or expired reset token');
    }

    user.passwordHash = await bcrypt.hash(dto.password, 12);
    // One-time use: the token dies here, whether or not it had expired.
    user.passwordResetToken = undefined;
    user.passwordResetExpiresAt = undefined;
    user.passwordResetLastSentAt = undefined;
    // The mutual-exclusion invariant — one live credential per account.
    user.inviteToken = undefined;
    user.inviteTokenExpiresAt = undefined;
    /*
     * What actually ends the sessions that were live a moment ago. Order is
     * load-bearing: `issueTokens` below builds its claims from this same
     * in-memory document, so the pair it returns carries the *new* version and
     * works immediately, while every token issued before this line does not.
     */
    user.tokenVersion = (user.tokenVersion ?? 0) + 1;
    await user.save();
    // Drops the cached context holding the old version, so other requests
    // re-resolve and see the bump rather than waiting out the cache TTL.
    await this.accessResolver.invalidateUser(user._id.toString());

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
  private toAuthUser(
    user: UserDocument,
    access: AccessContext,
    roles: string[],
  ) {
    return {
      id: user._id.toString(),
      email: user.email,
      name:
        [user.firstName, user.lastName].filter(Boolean).join(' ').trim() ||
        null,
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
