import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import {
  ALL_MODULE_KEYS,
  allPagePermissionKeys,
  PageLevel,
  PageLevelOverride,
  pageLevelToPermissions,
  permissionsToPageLevel,
} from '@sfa/shared';
import { Model, Types } from 'mongoose';
import { hashResetToken, mintResetToken } from '../common/crypto/reset-token';
import {
  inviteExpiryDays,
  inviteResendCooldownSeconds,
} from '../config/invite.config';
import {
  passwordResetCooldownSeconds,
  passwordResetExpiryHours,
} from '../config/password-reset.config';
import { TenantUrlService } from '../common/tenancy/tenant-url.service';
import { TenantBrandingService } from '../tenant-branding/tenant-branding.service';
import { MailService } from '../mail/mail.service';
import { AccessResolverService } from '../permissions/access-resolver.service';
import { PermissionsService } from '../permissions/permissions.service';
import { Agency, AgencyDocument } from '../platform/schemas/agency.schema';
import {
  AgencyRole,
  AgencyRoleDocument,
} from '../roles/schemas/agency-role.schema';
import { User, UserDocument } from './schemas/user.schema';
import {
  UserWorkReleaseService,
  type ReleasedWork,
} from './user-work-release.service';
import { RoleAssignmentsService } from '../permissions/role-assignments.service';
import {
  ActingUser,
  OwnerProtectionService,
} from '../permissions/owner-protection.service';
import { UserRole } from '../permissions/schemas/user-role.schema';
import {
  AgencyUserListItem,
  InviteResponse,
  PasswordResetResponse,
  UserDetailResponse,
} from './users.types';

/**
 * Per-user overrides only ever move a user between page levels, so every
 * grant/revoke must be a page `{module}:read|write` permission. Owner-only admin
 * permissions are never overridable per user.
 */
const ALLOWED_PAGE_PERMISSIONS = new Set<string>(allPagePermissionKeys());

/** `"Ada Lovelace"`, or null when neither name part is set. */
function fullName(first?: string, last?: string): string | null {
  return [first, last].filter(Boolean).join(' ').trim() || null;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(AgencyRole.name) private roleModel: Model<AgencyRoleDocument>,
    @InjectModel(Agency.name) private agencyModel: Model<AgencyDocument>,
    @InjectModel(UserRole.name) private userRoleModel: Model<UserRole>,
    private permissionsService: PermissionsService,
    private roleAssignments: RoleAssignmentsService,
    private ownerProtection: OwnerProtectionService,
    private accessResolver: AccessResolverService,
    private mailService: MailService,
    private configService: ConfigService,
    private workRelease: UserWorkReleaseService,
    private tenantUrls: TenantUrlService,
    private tenantBranding: TenantBrandingService,
  ) {}

  /**
   * Roles for a set of users, as the `{ _id, name, slug }` shape the web has
   * always received from `.populate('roleIds')`.
   *
   * Replaces that populate now that the assignment lives in `userRoles`. Batched
   * over all the users at once — the alternative, a lookup per row, is how a
   * 15-person agency turns one query into sixteen.
   */
  private async rolesByUser(
    userIds: Types.ObjectId[],
  ): Promise<
    Map<string, { _id: Types.ObjectId; name: string; slug: string }[]>
  > {
    const byUser = new Map<
      string,
      { _id: Types.ObjectId; name: string; slug: string }[]
    >();
    if (!userIds.length) return byUser;

    const links = await this.userRoleModel
      .find({ userId: { $in: userIds } })
      .select({ userId: 1, roleId: 1 })
      .lean();
    if (!links.length) return byUser;

    const roles = await this.roleModel
      .find({ _id: { $in: links.map((link) => link.roleId) } })
      .select({ name: 1, slug: 1 })
      .lean();
    const roleById = new Map(roles.map((role) => [role._id.toString(), role]));

    for (const link of links) {
      const role = roleById.get(link.roleId.toString());
      if (!role) continue;
      const key = link.userId.toString();
      const list = byUser.get(key) ?? [];
      list.push({ _id: role._id, name: role.name, slug: role.slug });
      byUser.set(key, list);
    }
    return byUser;
  }

  async findByAgency(agencyId: string): Promise<AgencyUserListItem[]> {
    const users = await this.userModel
      .find({
        agencyId: new Types.ObjectId(agencyId),
        isPlatformAdmin: { $ne: true },
      })
      .select('-passwordHash -inviteToken -passwordResetToken')
      .lean();

    const byUser = await this.rolesByUser(users.map((user) => user._id));
    return users.map((user) => ({
      ...user,
      roleIds: byUser.get(user._id.toString()) ?? [],
    }));
  }

  async findById(
    agencyId: string,
    userId: string,
  ): Promise<UserDetailResponse> {
    const user = await this.userModel
      .findOne({
        _id: new Types.ObjectId(userId),
        agencyId: new Types.ObjectId(agencyId),
      })
      .select('-passwordHash -inviteToken -passwordResetToken')
      .lean();
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const [effectivePermissions, roleDefaultPermissions, byUser, overrides] =
      await Promise.all([
        this.permissionsService.resolveForUser(user as UserDocument),
        this.permissionsService.resolveRoleDefaults(user as UserDocument),
        this.rolesByUser([user._id]),
        this.roleAssignments.userOverrides(user._id),
      ]);

    // The response keeps the shape the web already consumes — `roleIds` as
    // populated role objects, and the overrides as two string arrays — even
    // though all three now come from join collections rather than fields on the
    // user. Changing the wire format here would be a second, unrelated migration
    // for every caller.
    return {
      ...user,
      roleIds: byUser.get(user._id.toString()) ?? [],
      permissionGrants: overrides.grants,
      permissionRevokes: overrides.revokes,
      effectivePermissions,
      roleDefaultPermissions,
    };
  }

  /**
   * Invite an employee: create them inactive, mint a token, email the link.
   *
   * **The user row is created before the email is dispatched, and that order is
   * deliberate.** If delivery throws, the invite still exists as a pending row
   * the owner can resend from the users list — which is the recoverable
   * outcome. Sending first and creating second would mean a delivered link
   * pointing at no account.
   */
  async inviteUser(input: {
    agencyId: string;
    branchId?: string;
    email: string;
    roleIds: string[];
    firstName?: string;
    lastName?: string;
    invitedByUserId?: string;
  }): Promise<InviteResponse> {
    await this.validateRoles(input.agencyId, input.roleIds);

    const email = input.email.toLowerCase();
    await this.assertEmailAvailable(email);

    const user = await this.userModel.create({
      agencyId: new Types.ObjectId(input.agencyId),
      branchId: input.branchId ? new Types.ObjectId(input.branchId) : undefined,
      email,
      // A random unusable secret, not a known placeholder: until the invite is
      // accepted there is no password, and this row must never be loggable into.
      passwordHash: await bcrypt.hash(randomBytes(16).toString('hex'), 12),
      firstName: input.firstName,
      lastName: input.lastName,
      isActive: false,
    });

    // The inviter is the actor. Owner protection does not fire on a brand-new
    // user — there is no owner role to strip — but routing through the one
    // writer is what keeps that true as the rules grow.
    await this.roleAssignments.setUserRoles(
      {
        userId: input.invitedByUserId ?? user._id.toString(),
        isPlatformAdmin: false,
      },
      input.agencyId,
      user._id,
      input.roleIds,
    );

    return this.issueInvite(user, input.invitedByUserId);
  }

  /**
   * Regenerate the token, reset the expiry, and send again.
   *
   * Issuing a fresh token **invalidates the previous link** — that is the point,
   * not a side effect: an invite that was forwarded or leaked stops working the
   * moment the owner resends.
   */
  async resendInvite(
    agencyId: string,
    userId: string,
    invitedByUserId?: string,
  ): Promise<InviteResponse> {
    const user = await this.findPendingInvite(agencyId, userId);

    const cooldownSeconds = inviteResendCooldownSeconds(
      this.configService.get<string>('INVITE_RESEND_COOLDOWN_SECONDS'),
    );
    const lastSentAt = user.inviteLastSentAt?.getTime();
    if (lastSentAt) {
      const elapsedSeconds = (Date.now() - lastSentAt) / 1000;
      if (elapsedSeconds < cooldownSeconds) {
        const wait = Math.ceil(cooldownSeconds - elapsedSeconds);
        throw new ConflictException(
          `An invite was just sent to this address. Try again in ${wait} second${wait === 1 ? '' : 's'}.`,
        );
      }
    }

    return this.issueInvite(user, invitedByUserId);
  }

  /**
   * Revoke a pending invite by deleting the user.
   *
   * Deleting rather than deactivating because the row is not a person yet — it
   * has never been logged into, owns no records, and leaving a permanently
   * inactive account behind would both clutter the directory and hold the unique
   * `email` index against a future invite to the same address.
   */
  async revokeInvite(agencyId: string, userId: string): Promise<void> {
    const user = await this.findPendingInvite(agencyId, userId);
    await this.userModel.deleteOne({ _id: user._id });
    await this.accessResolver.invalidateUser(userId);
  }

  /**
   * Remove an employee from the agency.
   *
   * ## Why this deactivates rather than deletes
   * The exact inverse of {@link revokeInvite}'s reasoning above. A pending
   * invite "owns no records"; an active user owns a great many — 31 `ref: 'User'`
   * fields across 16 collections, two of them `required`. Deleting the row would
   * point every "produced by" column at a missing id and fail the next write to
   * a producer goal. So the row stays and the person loses access.
   *
   * ## Deactivation really does revoke access, immediately
   * Worth stating because "soft delete" often does not. `AuthService` refuses
   * login for an inactive user, and `AccessResolverService.resolve` returns null
   * for one on **every request** — so an already-issued JWT stops working as
   * soon as the cached context is dropped, which is the `invalidateUser` call at
   * the end. Without that call the old token keeps working until it expires.
   */
  async deactivateUser(
    actor: ActingUser,
    agencyId: string,
    userId: string,
  ): Promise<ReleasedWork> {
    const actorUserId = actor.userId;
    if (!Types.ObjectId.isValid(userId)) {
      throw new NotFoundException('User not found');
    }

    // An owner who removes themselves cannot undo it — the endpoint they would
    // need is the one they just lost. Cheapest check first, before any read.
    if (actorUserId && actorUserId === userId) {
      throw new BadRequestException(
        'You cannot remove your own account. Ask another owner to do it.',
      );
    }

    const user = await this.userModel.findOne({
      _id: new Types.ObjectId(userId),
      agencyId: new Types.ObjectId(agencyId),
      // Platform admins are not the agency's to manage, and `findByAgency`
      // already hides them. A 404 keeps the two consistent — from inside the
      // agency, that user does not exist.
      isPlatformAdmin: { $ne: true },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.deactivatedAt) {
      throw new ConflictException('That user has already been removed.');
    }

    // A pending invite has its own verb, and it is the better one: revoking
    // deletes the row and frees the email for a future invite, where
    // deactivating would hold the unique `email` index forever.
    if (!user.isActive) {
      throw new ConflictException(
        'That invite has not been accepted yet. Revoke the invite instead.',
      );
    }

    // Policy first (an owner may not remove another owner), then integrity
    // (the agency may never be left with none). Both live in
    // OwnerProtectionService so RolesService enforces the identical rules.
    await this.ownerProtection.assertMayDeactivate(actor, agencyId, userId);

    user.isActive = false;
    user.deactivatedAt = new Date();
    user.deactivatedByUserId =
      actorUserId && Types.ObjectId.isValid(actorUserId)
        ? new Types.ObjectId(actorUserId)
        : null;
    // A live credential must not outlive access. Any of these left set would
    // let the removed user walk back in through the invite or reset flow.
    user.inviteToken = undefined;
    user.inviteTokenExpiresAt = undefined;
    user.passwordResetToken = undefined;
    user.passwordResetExpiresAt = undefined;
    await user.save();

    const released = await this.workRelease.release(agencyId, userId);

    // Last, and load-bearing — see the docblock. Their next request re-resolves
    // from Mongo, finds `isActive: false`, and gets nothing.
    await this.accessResolver.invalidateUser(userId);

    return released;
  }

  /**
   * Restore a removed employee's access.
   *
   * Deliberately does **not** restore the work released on the way out. Those
   * tickets have been sitting in the unassigned queue and may well have been
   * picked up by someone else; silently yanking them back would be worse than
   * making reassignment explicit.
   */
  async reactivateUser(
    agencyId: string,
    userId: string,
  ): Promise<UserDetailResponse> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new NotFoundException('User not found');
    }

    const user = await this.userModel.findOne({
      _id: new Types.ObjectId(userId),
      agencyId: new Types.ObjectId(agencyId),
      isPlatformAdmin: { $ne: true },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (!user.deactivatedAt) {
      throw new ConflictException('That user has not been removed.');
    }

    user.isActive = true;
    user.deactivatedAt = null;
    user.deactivatedByUserId = null;
    await user.save();
    await this.accessResolver.invalidateUser(userId);

    return this.findById(agencyId, userId);
  }

  /**
   * Email an active employee a link to set a new password (PAC-79).
   *
   * The way back in for the 14 migrated users, whose `passwordHash` is 24 random
   * bytes from the SmartSuite import rather than a bcrypt digest — so
   * `bcrypt.compare` can never match, and they cannot be re-invited either
   * because `findPendingInvite` refuses an active user.
   *
   * Modelled on {@link issueInvite}, with three deliberate departures:
   *
   * 1. **The stored token is a digest, not the token.** `inviteToken` is stored
   *    raw; do not copy that here. A database read must not yield a working
   *    credential.
   * 2. **Hours, not days.** An owner triggers this on demand and can tell the
   *    person it is coming, so the link should not still work tomorrow.
   * 3. **`isActive` is never touched.** A reset is not a reactivation.
   */
  async sendPasswordReset(
    agencyId: string,
    userId: string,
  ): Promise<PasswordResetResponse> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new NotFoundException('User not found');
    }

    const user = await this.userModel.findOne({
      _id: new Types.ObjectId(userId),
      // Scoping by agency is what stops one tenant resetting another's people.
      agencyId: new Types.ObjectId(agencyId),
      // Platform admins are not the agency's to manage, and `findByAgency`
      // already hides them — a 404 keeps the two consistent.
      isPlatformAdmin: { $ne: true },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    /*
     * Order matters, and this check must come before the `isActive` one below:
     * both states have `isActive: false`, so testing that first would answer a
     * removed employee with "they have not accepted their invite yet".
     *
     * `deactivateUser` clears the reset fields precisely so a removed employee
     * cannot walk back in through this flow. Re-minting here would undo that in
     * one call, which is the whole reason this endpoint refuses rather than
     * treating a deactivated user as just another row.
     */
    if (user.deactivatedAt) {
      throw new ConflictException(
        'That user was removed from the agency. Reactivate them first.',
      );
    }
    if (!user.isActive) {
      throw new ConflictException(
        'That user has not accepted their invite yet. Resend the invite instead.',
      );
    }

    const cooldownSeconds = passwordResetCooldownSeconds(
      this.configService.get<string>('PASSWORD_RESET_COOLDOWN_SECONDS'),
    );
    const lastSentAt = user.passwordResetLastSentAt?.getTime();
    if (lastSentAt) {
      const elapsedSeconds = (Date.now() - lastSentAt) / 1000;
      if (elapsedSeconds < cooldownSeconds) {
        const wait = Math.ceil(cooldownSeconds - elapsedSeconds);
        throw new ConflictException(
          `A reset link was just sent to this address. Try again in ${wait} second${wait === 1 ? '' : 's'}.`,
        );
      }
    }

    const resetToken = mintResetToken();
    const expiryHours = passwordResetExpiryHours(
      this.configService.get<string>('PASSWORD_RESET_EXPIRY_HOURS'),
    );
    const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000);

    // Only the digest is persisted. The raw token exists in the email and, in
    // development, in the response below — nowhere else, ever.
    user.passwordResetToken = hashResetToken(resetToken);
    user.passwordResetExpiresAt = expiresAt;
    user.passwordResetLastSentAt = new Date();
    /*
     * One live credential per account. In practice an active user has no
     * pending invite — `findPendingInvite` and the guards above make the two
     * states disjoint — so this is belt-and-braces, kept so the invariant holds
     * by construction rather than by a chain of reasoning.
     */
    user.inviteToken = undefined;
    user.inviteTokenExpiresAt = undefined;
    await user.save();

    const resetUrl = await this.buildPasswordResetUrl(
      resetToken,
      user.agencyId?.toString() ?? null,
    );
    const agencyName = await this.resolveAgencyName(user.agencyId);

    // Same guarantee as `issueInvite`: both callers reach here with an agency
    // (the user was loaded scoped by one), and the event schema would otherwise
    // reject an empty string with a message about hex digits.
    if (!user.agencyId) {
      throw new Error(
        `Cannot reset password for user ${user._id.toString()}: no agencyId on the record.`,
      );
    }

    await this.mailService.sendPasswordResetEmail({
      userId: user._id.toString(),
      agencyId: user.agencyId.toString(),
      branchId: user.branchId?.toString() ?? null,
      to: user.email,
      recipientName: fullName(user.firstName, user.lastName),
      agencyName,
      resetUrl,
      expiresAt,
    });

    return {
      userId: user._id.toString(),
      resetUrl,
      expiresAt: expiresAt.toISOString(),
      // Withheld in production, where the email is the only delivery channel.
      // See `exposeTokensForDev`.
      ...(this.exposeTokensForDev() ? { resetToken } : {}),
    };
  }

  /**
   * Mint a token onto an existing inactive user and mail the link. Shared by
   * first invite and resend so the two can never drift on expiry or content.
   */
  private async issueInvite(
    user: UserDocument,
    invitedByUserId?: string,
  ): Promise<InviteResponse> {
    const inviteToken = randomBytes(32).toString('hex');
    const expiryDays = inviteExpiryDays(
      this.configService.get<string>('INVITE_EXPIRY_DAYS'),
    );
    const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);

    user.inviteToken = inviteToken;
    user.inviteTokenExpiresAt = expiresAt;
    user.inviteLastSentAt = new Date();
    await user.save();

    const agencyIdString = user.agencyId?.toString() ?? null;
    const [baseUrl, agencyName, roleNames, inviterName] = await Promise.all([
      this.tenantUrls.baseUrlFor(agencyIdString),
      this.resolveAgencyName(user.agencyId),
      this.permissionsService.resolveRoleNames(user),
      this.resolveUserName(invitedByUserId),
    ]);

    const inviteUrl = `${baseUrl}/auth/accept-invite?token=${inviteToken}`;

    // Same origin as the invite link, so the logo is fetched from the host the
    // invitee is about to visit — and so a tenant with its own domain never
    // makes a mail client load an asset from a name the recipient has never
    // heard of.
    const brand = await this.resolveEmailBrand(agencyIdString, baseUrl);

    // `agencyId` is optional on the schema (a platform super admin has none)
    // but is guaranteed on both paths into here: `inviteUser` sets it from a
    // required input, and `resendInvite` loads the user scoped by it. Asserting
    // rather than defaulting keeps that guarantee visible — the event schema
    // would otherwise reject an empty string with a message about hex digits,
    // which says nothing about what actually went wrong.
    if (!user.agencyId) {
      throw new Error(
        `Cannot invite user ${user._id.toString()}: no agencyId on the record.`,
      );
    }

    await this.mailService.sendInviteEmail({
      userId: user._id.toString(),
      agencyId: user.agencyId.toString(),
      branchId: user.branchId?.toString() ?? null,
      to: user.email,
      recipientName: fullName(user.firstName, user.lastName),
      agencyName,
      inviterName,
      roleNames,
      inviteUrl,
      expiresAt,
      brand,
    });

    return {
      userId: user._id.toString(),
      inviteUrl,
      expiresAt: expiresAt.toISOString(),
      // The raw token is a bearer credential and the email is its delivery
      // channel, so it is withheld in production. It is still returned outside
      // production because mail delivery is a logging stub (see `MailService`) —
      // without it there is no way to walk the flow locally or in e2e. Remove
      // this the moment a real transport lands.
      ...(this.exposeTokensForDev() ? { inviteToken } : {}),
    };
  }

  /**
   * Distinguish "already a member" from "already invited" — the owner's next
   * action is completely different (nothing vs. resend), so one generic 409
   * would be useless. Checked explicitly rather than leaning on the unique
   * `email` index, which can only report that *something* collided.
   */
  private async assertEmailAvailable(email: string): Promise<void> {
    const existing = await this.userModel
      .findOne({ email })
      .select('isActive')
      .lean();
    if (!existing) return;

    throw new ConflictException(
      existing.isActive
        ? 'That email already belongs to a member of this agency.'
        : 'That email already has a pending invite. Resend it instead.',
    );
  }

  private async findPendingInvite(
    agencyId: string,
    userId: string,
  ): Promise<UserDocument> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new NotFoundException('User not found');
    }

    const user = await this.userModel.findOne({
      _id: new Types.ObjectId(userId),
      agencyId: new Types.ObjectId(agencyId),
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (user.isActive) {
      throw new ConflictException(
        'That user has already accepted their invite.',
      );
    }
    // ⚠ Security, not tidiness. `isActive: false` covers both "pending invite"
    // and "removed from the agency" — see the table on `User.isActive`. Without
    // this second check, `resendInvite` would accept a **deactivated** user,
    // mint them a fresh token and email a working account-activation link to
    // somebody the owner had just removed. Every caller of this method inherits
    // the guard, which is why it lives here rather than at each call site.
    if (user.deactivatedAt) {
      throw new ConflictException(
        'That user was removed from the agency. Reactivate them instead.',
      );
    }
    return user;
  }

  /**
   * Absolute, because the link is opened from an email client that has no origin
   * to resolve a relative path against.
   */
  /**
   * The agency's identity for the email masthead, or `undefined` to fall back
   * to the platform wordmark.
   *
   * The logo URL is made **absolute against the same base as the invite link**.
   * It cannot be a relative path (a mail client has no origin to resolve it
   * against) and it cannot be a presigned storage URL (those expire, and an
   * invite may sit unread for days — a broken image in a "set your password"
   * email is exactly the thing that makes it look like phishing).
   */
  private async resolveEmailBrand(
    agencyId: string | null,
    baseUrl: string,
  ): Promise<{ name: string; logoUrl: string | null } | undefined> {
    if (!agencyId) return undefined;

    const branding = await this.tenantBranding.forAgency(agencyId);
    if (branding.kind !== 'agency') return undefined;

    return {
      name: branding.name,
      logoUrl: branding.logoUrl ? `${baseUrl}${branding.logoUrl}` : null,
    };
  }

  /**
   * Whether to hand the raw token back in the response body.
   *
   * Shared by the invite and password-reset flows on purpose: two copies of this
   * predicate is how one of them ends up leaking a live credential in production
   * after somebody "cleans up" the other.
   */
  private exposeTokensForDev(): boolean {
    return this.configService.get<string>('NODE_ENV') !== 'production';
  }

  /**
   * Absolute, for the same reason the invite link is — this is opened from an
   * email client, which has no origin to resolve a relative path against.
   *
   * Built on the **recipient's own agency host** (`TenantUrlService`), never on
   * `APP_BASE_URL`: `HostTenantGuard` binds a session to the hostname it was
   * created on, and `AuthService.resetPassword` refuses to mint one on a host
   * the user does not belong to — so a link on the platform base URL is not
   * merely off-brand, it is a link that cannot be completed.
   */
  private async buildPasswordResetUrl(
    token: string,
    agencyId: string | null,
  ): Promise<string> {
    const base = (await this.tenantUrls.baseUrlFor(agencyId)).replace(
      /\/+$/,
      '',
    );
    return `${base}/auth/reset-password?token=${token}`;
  }

  private async resolveAgencyName(
    agencyId: Types.ObjectId | undefined,
  ): Promise<string> {
    if (!agencyId) return 'your agency';
    const agency = await this.agencyModel
      .findById(agencyId)
      .select('name')
      .lean();
    return agency?.name ?? 'your agency';
  }

  private async resolveUserName(userId?: string): Promise<string | null> {
    if (!userId || !Types.ObjectId.isValid(userId)) return null;
    const user = await this.userModel
      .findById(userId)
      .select('firstName lastName')
      .lean();
    if (!user) return null;
    return fullName(user.firstName, user.lastName);
  }

  /**
   * Replace a user's roles.
   *
   * `actor` is threaded from `request.access` because owner protection needs to
   * know *who* is asking: an owner may give up their own owner role, but only a
   * platform admin may take it off someone else. The check lives in
   * `RoleAssignmentsService.setUserRoles`, so it cannot be skipped by a caller
   * that forgets.
   */
  async updateRoles(
    actor: ActingUser,
    agencyId: string,
    userId: string,
    roleIds: string[],
  ): Promise<UserDetailResponse> {
    await this.validateRoles(agencyId, roleIds);

    const user = await this.userModel.findOne({
      _id: new Types.ObjectId(userId),
      agencyId: new Types.ObjectId(agencyId),
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.roleAssignments.setUserRoles(actor, agencyId, userId, roleIds);
    return this.findById(agencyId, userId);
  }

  /**
   * Apply per-page permission overrides for a user. The owner submits a desired
   * level (`none` / `read` / `write`) per page; we diff each page against the
   * user's role defaults and store only the differences as grants/revokes, so
   * the user keeps inheriting role changes for pages left at their default.
   */
  async updatePermissions(
    agencyId: string,
    userId: string,
    overrides: PageLevelOverride[],
  ): Promise<UserDetailResponse> {
    const user = await this.userModel.findOne({
      _id: new Types.ObjectId(userId),
      agencyId: new Types.ObjectId(agencyId),
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const enabledModules = new Set(await this.getEnabledModules(agencyId));
    const roleDefaults = new Set(
      await this.permissionsService.resolveRoleDefaults(user),
    );

    const overrideMap = new Map<string, PageLevel>();
    for (const { moduleKey, level } of overrides) {
      if (enabledModules.has(moduleKey) && this.isValidLevel(level)) {
        overrideMap.set(moduleKey, level);
      }
    }

    const grants = new Set<string>();
    const revokes = new Set<string>();

    for (const moduleKey of ALL_MODULE_KEYS) {
      if (!enabledModules.has(moduleKey)) {
        continue;
      }

      const roleLevel = permissionsToPageLevel(roleDefaults, moduleKey);
      const desiredLevel = overrideMap.get(moduleKey) ?? roleLevel;
      if (desiredLevel === roleLevel) {
        continue;
      }

      const rolePerms = new Set(pageLevelToPermissions(moduleKey, roleLevel));
      const desiredPerms = new Set(
        pageLevelToPermissions(moduleKey, desiredLevel),
      );

      for (const permission of desiredPerms) {
        if (!rolePerms.has(permission)) {
          grants.add(permission);
        }
      }
      for (const permission of rolePerms) {
        if (!desiredPerms.has(permission)) {
          revokes.add(permission);
        }
      }
    }

    const grantList = [...grants];
    const revokeList = [...revokes];
    this.assertPagePermissions([...grantList, ...revokeList]);

    await this.roleAssignments.setUserOverrides(
      agencyId,
      userId,
      grantList,
      revokeList,
    );

    return this.findById(agencyId, userId);
  }

  private isValidLevel(level: string): level is PageLevel {
    return level === 'none' || level === 'read' || level === 'write';
  }

  /**
   * Guard against persisting anything other than page read/write permissions in
   * per-user overrides. Never throws in normal operation; catches regressions.
   */
  private assertPagePermissions(permissions: string[]): void {
    const invalid = permissions.filter(
      (permission) => !ALLOWED_PAGE_PERMISSIONS.has(permission),
    );
    if (invalid.length) {
      throw new BadRequestException(
        `Invalid page permission override(s): ${invalid.join(', ')}`,
      );
    }
  }

  async listAssignablePermissions(agencyId: string): Promise<string[]> {
    const enabledModules = await this.getEnabledModules(agencyId);
    return this.permissionsService.allAssignablePermissions(enabledModules);
  }

  private async validateRoles(agencyId: string, roleIds: string[]) {
    if (!roleIds.length) {
      throw new BadRequestException('At least one role is required');
    }

    const count = await this.roleModel.countDocuments({
      agencyId: new Types.ObjectId(agencyId),
      _id: { $in: roleIds.map((id) => new Types.ObjectId(id)) },
    });
    if (count !== roleIds.length) {
      throw new BadRequestException(
        'One or more roles are invalid for this agency',
      );
    }
  }

  private async getEnabledModules(agencyId: string): Promise<string[]> {
    const agency = await this.agencyModel.findById(agencyId).lean();
    if (!agency) {
      throw new NotFoundException('Agency not found');
    }
    return Object.entries(agency.modules ?? {})
      .filter(([, entry]) => entry.enabled)
      .map(([key]) => key);
  }
}
