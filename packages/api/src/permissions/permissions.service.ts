import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  AccessContext,
  AccessScope,
  ALL_PLATFORM_PERMISSIONS,
  AgencyPermission,
  DataScope,
  DEFAULT_ROLE_TEMPLATES,
  JwtPayload,
  normalizeLegacyPermission,
  resolvePermissionSet,
} from '@sfa/shared';
import { Model, Types } from 'mongoose';
import { Agency, AgencyDocument } from '../platform/schemas/agency.schema';
import {
  AgencyRole,
  AgencyRoleDocument,
} from '../roles/schemas/agency-role.schema';
import { User, UserDocument } from '../users/schemas/user.schema';

@Injectable()
export class PermissionsService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(AgencyRole.name) private roleModel: Model<AgencyRoleDocument>,
    @InjectModel(Agency.name) private agencyModel: Model<AgencyDocument>,
  ) {}

  /**
   * Resolve the role-default permissions for a user, ignoring any per-user
   * owner overrides (grants/revokes). Used to diff overrides against defaults.
   */
  async resolveRoleDefaults(user: UserDocument): Promise<string[]> {
    if (user.isPlatformAdmin) {
      return ALL_PLATFORM_PERMISSIONS;
    }
    if (!user.agencyId) {
      return [];
    }

    const { rolePermissions, grantsAll, enabledModules } =
      await this.loadRoleContext(user);

    return resolvePermissionSet({
      rolePermissions,
      enabledModules,
      grantsAllEnabledModules: grantsAll,
    });
  }

  /**
   * Resolve the effective permissions for a user: role defaults plus the
   * agency owner's per-user grants, minus revokes, filtered to enabled modules.
   */
  async resolveForUser(user: UserDocument): Promise<string[]> {
    if (user.isPlatformAdmin) {
      return ALL_PLATFORM_PERMISSIONS;
    }

    if (!user.agencyId) {
      return [];
    }

    const { rolePermissions, grantsAll, enabledModules } =
      await this.loadRoleContext(user);

    return resolvePermissionSet({
      rolePermissions,
      grants: user.permissionGrants ?? [],
      revokes: user.permissionRevokes ?? [],
      enabledModules,
      grantsAllEnabledModules: grantsAll,
    });
  }

  private async loadRoleContext(user: UserDocument): Promise<{
    rolePermissions: string[];
    grantsAll: boolean;
    enabledModules: string[];
  }> {
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

    return { rolePermissions, grantsAll, enabledModules };
  }

  /**
   * Human-readable role names for the user (e.g. ["Owner"], ["Producer"]).
   * Used for display in the UI — never for access decisions.
   */
  async resolveRoleNames(user: UserDocument): Promise<string[]> {
    if (user.isPlatformAdmin) {
      return ['Platform Admin'];
    }
    if (!user.roleIds?.length || !user.agencyId) {
      return [];
    }
    const roles = await this.roleModel
      .find({ _id: { $in: user.roleIds }, agencyId: user.agencyId })
      .lean();
    return roles.map((role) => role.name).filter(Boolean);
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

  /**
   * Resolve the full authorization context for a user from the database. This
   * is the source of truth used by the request guards (via the resolver/cache)
   * and to build the login response — never trusted from the JWT.
   */
  async buildAccessContext(user: UserDocument): Promise<AccessContext> {
    const permissions = await this.resolveForUser(user);
    const dataScope = await this.resolveDataScope(user);

    const scope = user.isPlatformAdmin
      ? AccessScope.Platform
      : dataScope === DataScope.Agency
        ? AccessScope.Agency
        : AccessScope.Branch;

    return {
      userId: user._id.toString(),
      agencyId: user.agencyId?.toString() ?? null,
      branchId: user.branchId?.toString() ?? null,
      isPlatformAdmin: user.isPlatformAdmin ?? false,
      scope,
      dataScope,
      permissions,
    };
  }

  /** Slim, stable claims that are safe to embed in the signed JWT. */
  buildJwtClaims(context: AccessContext): JwtPayload {
    return {
      sub: context.userId,
      agencyId: context.agencyId,
      branchId: context.branchId,
      scope: context.scope,
      isPlatformAdmin: context.isPlatformAdmin,
    };
  }

  async seedDefaultRoles(agencyId: Types.ObjectId): Promise<void> {
    for (const template of DEFAULT_ROLE_TEMPLATES) {
      const existing = await this.roleModel.findOne({
        agencyId,
        slug: template.slug,
      });

      if (!existing) {
        await this.roleModel.create({
          agencyId,
          name: template.name,
          slug: template.slug,
          description: template.description,
          permissions: template.permissions,
          dataScope: template.dataScope,
          isSystemTemplate: true,
          grantsAllEnabledModules: template.grantsAllEnabledModules ?? false,
        });
        continue;
      }

      // Reconcile drift: normalize any legacy fine-grained permissions to the
      // simplified read/write model, then merge in template defaults (union),
      // keeping system-template flags current without dropping customizations.
      const normalized = existing.permissions.flatMap((permission) =>
        normalizeLegacyPermission(permission),
      );
      existing.permissions = [
        ...new Set([...normalized, ...template.permissions]),
      ];
      existing.dataScope = template.dataScope;
      existing.grantsAllEnabledModules =
        template.grantsAllEnabledModules ?? false;
      if (!existing.description) {
        existing.description = template.description;
      }
      await existing.save();
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
