import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { Model, Types } from 'mongoose';
import { PermissionsService } from '../permissions/permissions.service';
import { Agency, AgencyDocument } from '../platform/schemas/agency.schema';
import { AgencyRole, AgencyRoleDocument } from '../roles/schemas/agency-role.schema';
import { User, UserDocument } from './schemas/user.schema';
import { UserDetailResponse } from './users.types';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(AgencyRole.name) private roleModel: Model<AgencyRoleDocument>,
    @InjectModel(Agency.name) private agencyModel: Model<AgencyDocument>,
    private permissionsService: PermissionsService,
  ) {}

  findByAgency(agencyId: string) {
    return this.userModel
      .find({ agencyId: new Types.ObjectId(agencyId) })
      .select('-passwordHash -inviteToken -passwordResetToken')
      .populate('roleIds', 'name slug')
      .lean();
  }

  async findById(agencyId: string, userId: string): Promise<UserDetailResponse> {
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

    const effectivePermissions = await this.permissionsService.resolveForUser(
      user as UserDocument,
    );

    return { ...user, effectivePermissions } as UserDetailResponse;
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
    return this.findById(agencyId, userId);
  }

  async updatePermissions(
    agencyId: string,
    userId: string,
    input: { grants?: string[]; revokes?: string[] },
  ): Promise<UserDetailResponse> {
    const user = await this.userModel.findOne({
      _id: new Types.ObjectId(userId),
      agencyId: new Types.ObjectId(agencyId),
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const enabledModules = await this.getEnabledModules(agencyId);
    const assignable = new Set(
      this.permissionsService.allAssignablePermissions(enabledModules),
    );

    if (input.grants) {
      const invalid = input.grants.filter((p) => !assignable.has(p));
      if (invalid.length) {
        throw new BadRequestException(
          `Cannot grant permissions not available for this agency: ${invalid.join(', ')}`,
        );
      }
      user.permissionGrants = [...new Set(input.grants)];
    }

    if (input.revokes) {
      user.permissionRevokes = [...new Set(input.revokes)];
    }

    await user.save();
    return this.findById(agencyId, userId);
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
      throw new BadRequestException('One or more roles are invalid for this agency');
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
