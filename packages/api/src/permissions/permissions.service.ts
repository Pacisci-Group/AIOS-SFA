import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  AccessScope,
  ALL_PLATFORM_PERMISSIONS,
  AgencyPermission,
  DataScope,
  DEFAULT_ROLE_TEMPLATES,
  JwtPayload,
  resolvePermissionSet,
} from '@sfa/shared';
import { Model, Types } from 'mongoose';
import { Agency, AgencyDocument } from '../platform/schemas/agency.schema';
import { AgencyRole, AgencyRoleDocument } from '../roles/schemas/agency-role.schema';
import { User, UserDocument } from '../users/schemas/user.schema';

@Injectable()
export class PermissionsService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(AgencyRole.name) private roleModel: Model<AgencyRoleDocument>,
    @InjectModel(Agency.name) private agencyModel: Model<AgencyDocument>,
  ) {}

  async resolveForUser(user: UserDocument): Promise<string[]> {
    if (user.isPlatformAdmin) {
      return ALL_PLATFORM_PERMISSIONS;
    }

    if (!user.agencyId) {
      return [];
    }

    const agency = await this.agencyModel.findById(user.agencyId).lean();
    const enabledModules = agency
      ? Object.entries(agency.modules ?? {})
          .filter(([, entry]) => entry.enabled)
          .map(([key]) => key)
      : [];

    const roles = user.roleIds?.length
      ? await this.roleModel
          .find({ _id: { $in: user.roleIds }, agencyId: user.agencyId })
          .lean()
      : [];

    const rolePermissions = roles.flatMap((role) => role.permissions);
    const grantsAll = roles.some((role) => role.grantsAllEnabledModules);

    return resolvePermissionSet({
      rolePermissions,
      grants: user.permissionGrants ?? [],
      revokes: user.permissionRevokes ?? [],
      enabledModules,
      grantsAllEnabledModules: grantsAll,
    });
  }

  async resolveDataScope(user: UserDocument): Promise<DataScope> {
    if (user.isPlatformAdmin) {
      return DataScope.Agency;
    }

    if (!user.roleIds?.length || !user.agencyId) {
      return DataScope.Own;
    }

    const roles = await this.roleModel
      .find({ _id: { $in: user.roleIds }, agencyId: user.agencyId })
      .lean();

    if (roles.some((r) => r.dataScope === DataScope.Agency)) {
      return DataScope.Agency;
    }
    if (roles.some((r) => r.dataScope === DataScope.Branch)) {
      return DataScope.Branch;
    }
    return DataScope.Own;
  }

  async buildJwtPayload(user: UserDocument): Promise<JwtPayload> {
    const permissions = await this.resolveForUser(user);
    const dataScope = await this.resolveDataScope(user);

    const scope = user.isPlatformAdmin
      ? AccessScope.Platform
      : dataScope === DataScope.Agency
        ? AccessScope.Agency
        : AccessScope.Branch;

    return {
      sub: user._id.toString(),
      agencyId: user.agencyId?.toString() ?? null,
      branchId: user.branchId?.toString() ?? null,
      permissions,
      scope,
      dataScope,
      isPlatformAdmin: user.isPlatformAdmin ?? false,
    };
  }

  async seedDefaultRoles(agencyId: Types.ObjectId): Promise<void> {
    for (const template of DEFAULT_ROLE_TEMPLATES) {
      await this.roleModel.updateOne(
        { agencyId, slug: template.slug },
        {
          $setOnInsert: {
            agencyId,
            name: template.name,
            slug: template.slug,
            description: template.description,
            permissions: template.permissions,
            dataScope: template.dataScope,
            isSystemTemplate: true,
            grantsAllEnabledModules: template.grantsAllEnabledModules ?? false,
          },
        },
        { upsert: true },
      );
    }
  }

  validatePermissionsAgainstAgency(
    permissions: string[],
    enabledModules: string[],
  ): string[] {
    return permissions.filter((permission) => {
      if (permission.startsWith('platform:')) {
        return false;
      }
      if (permission.startsWith('agency:')) {
        return true;
      }
      const [module] = permission.split(':');
      return module ? enabledModules.includes(module) : false;
    });
  }

  allAssignablePermissions(enabledModules: string[]): string[] {
    const modulePerms = enabledModules.flatMap((module) => [
      `${module}:read`,
      `${module}:write`,
    ]);
    return [...Object.values(AgencyPermission), ...modulePerms];
  }
}
