import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
import { AccessResolverService } from '../permissions/access-resolver.service';
import { PermissionsService } from '../permissions/permissions.service';
import { Agency, AgencyDocument } from '../platform/schemas/agency.schema';
import {
  AgencyRole,
  AgencyRoleDocument,
} from '../roles/schemas/agency-role.schema';
import { User, UserDocument } from './schemas/user.schema';
import { UserDetailResponse } from './users.types';

/**
 * Per-user overrides only ever move a user between page levels, so every
 * grant/revoke must be a page `{module}:read|write` permission. Owner-only admin
 * permissions are never overridable per user.
 */
const ALLOWED_PAGE_PERMISSIONS = new Set<string>(allPagePermissionKeys());

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(AgencyRole.name) private roleModel: Model<AgencyRoleDocument>,
    @InjectModel(Agency.name) private agencyModel: Model<AgencyDocument>,
    private permissionsService: PermissionsService,
    private accessResolver: AccessResolverService,
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

  async inviteUser(input: {
    agencyId: string;
    branchId?: string;
    email: string;
    roleIds: string[];
    firstName?: string;
    lastName?: string;
  }) {
    await this.validateRoles(input.agencyId, input.roleIds);

    const inviteToken = randomBytes(32).toString('hex');
    const inviteTokenExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const user = await this.userModel.create({
      agencyId: new Types.ObjectId(input.agencyId),
      branchId: input.branchId ? new Types.ObjectId(input.branchId) : undefined,
      email: input.email.toLowerCase(),
      passwordHash: await bcrypt.hash(randomBytes(16).toString('hex'), 12),
      roleIds: input.roleIds.map((id) => new Types.ObjectId(id)),
      firstName: input.firstName,
      lastName: input.lastName,
      isActive: false,
      inviteToken,
      inviteTokenExpiresAt,
    });

    return {
      userId: user._id.toString(),
      inviteToken,
      inviteUrl: `/auth/accept-invite?token=${inviteToken}`,
    };
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
