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
import {
  inviteExpiryDays,
  inviteResendCooldownSeconds,
} from '../config/invite.config';
import { MailService } from '../mail/mail.service';
import { AccessResolverService } from '../permissions/access-resolver.service';
import { PermissionsService } from '../permissions/permissions.service';
import { Agency, AgencyDocument } from '../platform/schemas/agency.schema';
import {
  AgencyRole,
  AgencyRoleDocument,
} from '../roles/schemas/agency-role.schema';
import { User, UserDocument } from './schemas/user.schema';
import { InviteResponse, UserDetailResponse } from './users.types';

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
    private permissionsService: PermissionsService,
    private accessResolver: AccessResolverService,
    private mailService: MailService,
    private configService: ConfigService,
  ) {}

  findByAgency(agencyId: string) {
    return this.userModel
      .find({
        agencyId: new Types.ObjectId(agencyId),
        isPlatformAdmin: { $ne: true },
      })
      .select('-passwordHash -inviteToken -passwordResetToken')
      .populate('roleIds', 'name slug')
      .lean();
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
      .populate('roleIds', 'name slug permissions')
      .lean();
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const [effectivePermissions, roleDefaultPermissions] = await Promise.all([
      this.permissionsService.resolveForUser(user as UserDocument),
      this.permissionsService.resolveRoleDefaults(user as UserDocument),
    ]);

    return {
      ...user,
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
      roleIds: input.roleIds.map((id) => new Types.ObjectId(id)),
      firstName: input.firstName,
      lastName: input.lastName,
      isActive: false,
    });

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

    const inviteUrl = this.buildInviteUrl(inviteToken);

    const [agencyName, roleNames, inviterName] = await Promise.all([
      this.resolveAgencyName(user.agencyId),
      this.permissionsService.resolveRoleNames(user),
      this.resolveUserName(invitedByUserId),
    ]);

    await this.mailService.sendInviteEmail({
      to: user.email,
      recipientName: fullName(user.firstName, user.lastName),
      agencyName,
      inviterName,
      roleNames,
      inviteUrl,
      expiresAt,
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
      ...(this.exposeInviteToken() ? { inviteToken } : {}),
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
    return user;
  }

  /**
   * Absolute, because the link is opened from an email client that has no origin
   * to resolve a relative path against.
   */
  private buildInviteUrl(token: string): string {
    const base = this.configService
      .get<string>('APP_BASE_URL', 'http://localhost:5173')
      .replace(/\/+$/, '');
    return `${base}/auth/accept-invite?token=${token}`;
  }

  private exposeInviteToken(): boolean {
    return this.configService.get<string>('NODE_ENV') !== 'production';
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

  async updateRoles(
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

    user.roleIds = roleIds.map((id) => new Types.ObjectId(id));
    await user.save();
    await this.accessResolver.invalidateUser(userId);
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

    user.permissionGrants = grantList;
    user.permissionRevokes = revokeList;
    await user.save();
    await this.accessResolver.invalidateUser(userId);

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
