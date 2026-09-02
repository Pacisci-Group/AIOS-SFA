import {
  BadRequestException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { createHash } from 'crypto';
import { Model } from 'mongoose';
import { AccessContext, JwtPayload } from '@sfa/shared';
import { hashResetToken } from '../common/crypto/reset-token';
import {
  HostTenantResolver,
  type HostTenant,
} from '../common/tenancy/host-tenant.resolver';
import { TenantUrlService } from '../common/tenancy/tenant-url.service';
import { AccessResolverService } from '../permissions/access-resolver.service';
import { PermissionsService } from '../permissions/permissions.service';
import { Agency, AgencyDocument } from '../platform/schemas/agency.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  AcceptInviteDto,
  ChangePasswordDto,
  LoginDto,
  ResetPasswordDto,
} from './dto/auth.dto';
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
    private hostResolver: HostTenantResolver,
    private tenantUrls: TenantUrlService,
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
      /*
       * Refresh tokens are stateless — there is no revocation list, and this is
       * the only check standing between a stolen one and an endless supply of
       * fresh access tokens. `AccessContextGuard` makes the same comparison for
       * access tokens; without it here, a password reset would lock an attacker
       * out for fifteen minutes and then hand them a new token (PAC-79).
       */
      if (user && (payload.tokenVersion ?? 0) !== (user.tokenVersion ?? 0)) {
        throw new UnauthorizedException('Invalid refresh token');
      }
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
  async resetPassword(dto: ResetPasswordDto, host: HostTenant | undefined) {
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

    // Same rule as login/refresh/accept-invite: a session may only be minted on
    // the host that owns the user. Holding a valid reset link is not a licence
    // to sign in at another agency's address. Placed after the token checks so
    // it cannot be used to probe which agency an unknown token belongs to.
    await this.assertBelongsOnHost(user, host);

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
   * Authenticated self-service password change (PAC-81).
   *
   * The credential half of the profile page. Mirrors {@link resetPassword}
   * from the hash down — same cost, same one-live-credential clearing, same
   * bump-save-invalidate-issue ordering — with a current-password check in
   * place of a token.
   *
   * Any authenticated session may call this, impersonated ones included
   * (product call) — the current-password check below is the identity proof
   * either way, and it applies to everyone equally.
   *
   * One deliberate departure from the usual error shapes: **a wrong current
   * password is a `400`, never a `401`.** The web client's fetch wrapper
   * treats a 401 as a dead session — refresh, retry, then wipe tokens — so a
   * 401 here would sign the user out for a typo.
   *
   * Returns a fresh token pair: the `tokenVersion` bump below invalidates the
   * very token that authenticated this request, so without the new pair the
   * caller's next request would 401.
   */
  async changePassword(payload: JwtPayload, dto: ChangePasswordDto) {
    const user = await this.userModel.findById(payload.sub);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!valid) {
      throw new BadRequestException('Current password is incorrect.');
    }

    user.passwordHash = await bcrypt.hash(dto.newPassword, 12);
    // One live credential per account: a password change by any route burns
    // any pending reset link (and, belt-and-braces, any invite token).
    user.passwordResetToken = undefined;
    user.passwordResetExpiresAt = undefined;
    user.passwordResetLastSentAt = undefined;
    user.inviteToken = undefined;
    user.inviteTokenExpiresAt = undefined;
    // Same load-bearing order as `resetPassword`: bump, save, invalidate,
    // then issue off the same in-memory doc so the returned pair carries the
    // new version while every other live session dies.
    user.tokenVersion = (user.tokenVersion ?? 0) + 1;
    await user.save();
    await this.accessResolver.invalidateUser(user._id.toString());

    // Forwarded so an impersonated session stays *marked* as impersonated on
    // the fresh pair — dropping it here would silently launder the provenance
    // (and the client's banner) the moment the password changed.
    return this.issueTokens(user, payload.impersonatedBy);
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
    impersonatedBy?: string,
  ) {
    return {
      id: user._id.toString(),
      email: user.email,
      name:
        [user.firstName, user.lastName].filter(Boolean).join(' ').trim() ||
        null,
      firstName: user.firstName ?? null,
      lastName: user.lastName ?? null,
      /**
       * A stable relative path, not a presigned URL (PAC-81). The blob sits in
       * the client's `localStorage` indefinitely, so anything that expires
       * would rot there; the client fetches this path with its own auth
       * header. `v` is a cache-buster derived from the key — same convention
       * as the tenant logo — so replacing the photo changes the URL.
       */
      avatarUrl: user.avatarKey
        ? `/me/avatar?v=${createHash('sha1').update(user.avatarKey).digest('hex').slice(0, 8)}`
        : null,
      roles,
      agencyId: access.agencyId,
      branchId: access.branchId,
      permissions: access.permissions,
      scope: access.scope,
      dataScope: access.dataScope,
      isPlatformAdmin: access.isPlatformAdmin,
      /**
       * Present only on an impersonated session (PAC-70), so a client can show
       * a banner. `null` rather than omitted, because the web stores this blob
       * and an absent key would leave a stale `true` behind after switching
       * back to an ordinary login.
       */
      impersonatedBy: impersonatedBy ?? null,
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
  async me(userId: string, impersonatedBy?: string) {
    const user = await this.userModel.findById(userId);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const [access, roles] = await Promise.all([
      this.permissionsService.buildAccessContext(user),
      this.permissionsService.resolveRoleNames(user),
    ]);
    return this.toAuthUser(user, access, roles, impersonatedBy);
  }

  /**
   * Mint a session as another user, without their password (PAC-70).
   *
   * The Super Admin's way into a tenant to see what a real user sees. It is also
   * the only way to exercise an `own`-scope screen against **migrated** data: the
   * SmartSuite import gives every user an unusable random `passwordHash`
   * (`migration.service.ts`), so nobody imported can ever log in normally.
   *
   * **Why this hands back an ordinary token.** The session is the target's, not a
   * hybrid: `sub` is the target, so `AccessContextGuard` resolves *their* live
   * permissions, data scope and tenant from the store exactly as it would for
   * their own login. `impersonatedBy` rides along as provenance only. That means
   * an impersonated session can never do something the target could not, and no
   * guard needs to learn a new special case.
   *
   * The refusals below are the whole security model, and they bound the *target*
   * rather than the caller:
   *
   * - **Never another platform admin.** Otherwise this is a sideways climb into
   *   a peer's authority. Downwards into a tenant is the only direction.
   * - **Never an inactive user**, matching {@link login} — a deprovisioned
   *   account must not be reachable by a second route.
   * - **Never yourself** — the caller is already signed in as that user.
   *
   * **Deliberately not audited, logged or announced.** Product decision
   * (PAC-70, 2026-09-02): impersonation is a plain support tool with no
   * strings attached. Do not reintroduce an events collection here.
   *
   * **`appBaseUrl`** is the one addition to the login envelope. The session has
   * to be *used* on the target's own host — `HostTenantGuard` refuses a
   * domain-bearing agency's user on the platform host and a platform admin on
   * an agency host — and browser storage is per origin, so the client cannot
   * simply keep the tokens where it is. It navigates to
   * `<appBaseUrl>/auth/impersonate` carrying them, and that page stores them
   * in the right origin.
   */
  async impersonate(actor: JwtPayload, targetUserId: string) {
    if (actor.sub === targetUserId) {
      throw new BadRequestException('You are already signed in as this user');
    }

    const target = await this.userModel.findById(targetUserId);
    // Same opaque 404 for "no such user" and "not active": who exists in another
    // tenant is not something this endpoint should confirm.
    if (!target || !target.isActive) {
      throw new NotFoundException('User not found');
    }
    if (target.isPlatformAdmin) {
      throw new ForbiddenException('Platform admins cannot be impersonated');
    }

    const session = await this.issueTokens(target, actor.sub);
    const appBaseUrl = await this.tenantUrls.baseUrlFor(
      target.agencyId?.toString() ?? null,
    );
    return { ...session, appBaseUrl };
  }

  private async issueTokens(user: UserDocument, impersonatedBy?: string) {
    const access = await this.permissionsService.buildAccessContext(user);
    // Only slim, stable identity claims are signed into the token. The effective
    // permission set is resolved from the store on every request, not trusted
    // from here.
    const claims = this.permissionsService.buildJwtClaims(access);
    /*
     * Provenance, stamped onto the claims rather than built into them.
     *
     * `buildJwtClaims` derives from `AccessContext`, which is per *user* and is
     * what `PermissionCache` serializes — impersonation is per *session*, so it
     * cannot live there without leaking one admin's session into the target's
     * cached context. See `JwtPayload.impersonatedBy`.
     */
    if (impersonatedBy) {
      claims.impersonatedBy = impersonatedBy;
    }
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
      user: this.toAuthUser(user, access, roles, impersonatedBy),
    };
  }
}
