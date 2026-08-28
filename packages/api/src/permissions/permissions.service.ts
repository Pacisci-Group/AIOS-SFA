import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  AccessContext,
  AccessScope,
  ALL_PLATFORM_PERMISSIONS,
  AgencyPermission,
  DataScope,
  JwtPayload,
  resolvePermissionSet,
} from '@sfa/shared';
import { Model, Types } from 'mongoose';
import { Agency, AgencyDocument } from '../platform/schemas/agency.schema';
import {
  AgencyRole,
  AgencyRoleDocument,
} from '../roles/schemas/agency-role.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { RolePermission } from './schemas/role-permission.schema';
import { UserPermission } from './schemas/user-permission.schema';
import { UserRole } from './schemas/user-role.schema';

/** One role a user holds, with the permission keys it grants. */
interface ResolvedRole {
  roleId: string;
  name: string;
  slug: string;
  dataScope: DataScope;
  grantsAllEnabledModules: boolean;
  permissionKeys: string[];
}

/** Everything the four resolve* methods need, from one round trip. */
interface AccessData {
  enabledModules: string[];
  roles: ResolvedRole[];
  grants: string[];
  revokes: string[];
}

const EMPTY: AccessData = {
  enabledModules: [],
  roles: [],
  grants: [],
  revokes: [],
};

/**
 * Turns the relational authorization tables into an {@link AccessContext}.
 *
 * ## Reads only
 *
 * Every write to `userRoles`, `rolePermissions` and `userPermissions` goes
 * through `RoleAssignmentsService`. Keeping this service read-only is what lets
 * it be injected by `AccessResolverService` without a dependency cycle.
 *
 * ## One aggregation, not four queries
 *
 * This used to read `user.roleIds` in four separate methods, each issuing its
 * own `roleModel.find` — so a single request resolved its permissions with four
 * round trips. The relational shape would have made that eight. Instead
 * {@link loadAccessData} fetches the agency, the roles, their permissions and
 * the user's overrides in one `$lookup` pipeline and every method folds the
 * same result. With `NoopPermissionCache` as the default (no `REDIS_URL`) this
 * runs per request, so the count matters.
 *
 * ## `resolvePermissionSet` is untouched
 *
 * The shared pure function still takes and returns permission *strings*. That
 * is deliberate: those strings are the contract for 91 guard decorators and the
 * whole web app. Only the loader became relational.
 */
@Injectable()
export class PermissionsService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(AgencyRole.name) private roleModel: Model<AgencyRoleDocument>,
    @InjectModel(Agency.name) private agencyModel: Model<AgencyDocument>,
    @InjectModel(UserRole.name) private userRoleModel: Model<UserRole>,
    @InjectModel(RolePermission.name)
    private rolePermissionModel: Model<RolePermission>,
    @InjectModel(UserPermission.name)
    private userPermissionModel: Model<UserPermission>,
  ) {}

  /**
   * The single read behind every resolve* method below.
   *
   * `$lookup` accepts `localField`/`foreignField` alongside a `pipeline` from
   * MongoDB 5.0; the deployed clusters are 7.x. The inner pipelines project
   * away everything unused, so the payload stays small even for an owner.
   *
   * Roles are matched on `agencyId` as well as `_id`: a `userRoles` row is not
   * itself proof that the role belongs to the user's tenant, and a stale row
   * pointing at another agency's role must contribute nothing.
   */
  private async loadAccessData(user: UserDocument): Promise<AccessData> {
    if (!user.agencyId) {
      return EMPTY;
    }

    const [row] = await this.userRoleModel.aggregate<{
      roles: {
        _id: Types.ObjectId;
        name: string;
        slug: string;
        dataScope: DataScope;
        grantsAllEnabledModules: boolean;
        permissionKeys: string[];
      }[];
    }>([
      { $match: { userId: user._id } },
      {
        $lookup: {
          from: 'roles',
          localField: 'roleId',
          foreignField: '_id',
          as: 'role',
          pipeline: [
            { $match: { agencyId: user.agencyId } },
            {
              $project: {
                name: 1,
                slug: 1,
                dataScope: 1,
                grantsAllEnabledModules: 1,
              },
            },
          ],
        },
      },
      { $unwind: '$role' },
      {
        $lookup: {
          from: 'rolePermissions',
          localField: 'roleId',
          foreignField: 'roleId',
          as: 'permissions',
          pipeline: [{ $project: { permissionKey: 1, _id: 0 } }],
        },
      },
      {
        $group: {
          _id: null,
          roles: {
            $push: {
              _id: '$role._id',
              name: '$role.name',
              slug: '$role.slug',
              dataScope: '$role.dataScope',
              grantsAllEnabledModules: '$role.grantsAllEnabledModules',
              permissionKeys: '$permissions.permissionKey',
            },
          },
        },
      },
    ]);

    const [agency, overrides] = await Promise.all([
      this.agencyModel.findById(user.agencyId).select({ modules: 1 }).lean(),
      this.userPermissionModel
        .find({ userId: user._id })
        .select({ permissionKey: 1, effect: 1 })
        .lean(),
    ]);

    return {
      enabledModules: Object.entries(agency?.modules ?? {})
        .filter(([, entry]) => entry.enabled)
        .map(([key]) => key),
      roles: (row?.roles ?? []).map((role) => ({
        roleId: role._id.toString(),
        name: role.name,
        slug: role.slug,
        dataScope: role.dataScope,
        grantsAllEnabledModules: role.grantsAllEnabledModules,
        permissionKeys: role.permissionKeys ?? [],
      })),
      grants: overrides
        .filter((o) => o.effect === 'grant')
        .map((o) => o.permissionKey),
      revokes: overrides
        .filter((o) => o.effect === 'revoke')
        .map((o) => o.permissionKey),
    };
  }

  private static rolePermissions(data: AccessData): string[] {
    return [...new Set(data.roles.flatMap((role) => role.permissionKeys))];
  }

  private static grantsAll(data: AccessData): boolean {
    return data.roles.some((role) => role.grantsAllEnabledModules);
  }

  /** Widest scope across the user's roles. */
  private static widestScope(data: AccessData): DataScope {
    if (data.roles.some((r) => r.dataScope === DataScope.Agency)) {
      return DataScope.Agency;
    }
    if (data.roles.some((r) => r.dataScope === DataScope.Branch)) {
      return DataScope.Branch;
    }
    return DataScope.Own;
  }

  /**
   * Role-default permissions, ignoring the user's own grants and revokes.
   * Used to diff overrides against defaults so a user keeps inheriting role
   * changes on everything they have not explicitly overridden.
   */
  async resolveRoleDefaults(user: UserDocument): Promise<string[]> {
    if (user.isPlatformAdmin) {
      return ALL_PLATFORM_PERMISSIONS;
    }
    if (!user.agencyId) {
      return [];
    }
    const data = await this.loadAccessData(user);
    return resolvePermissionSet({
      rolePermissions: PermissionsService.rolePermissions(data),
      enabledModules: data.enabledModules,
      grantsAllEnabledModules: PermissionsService.grantsAll(data),
    });
  }

  /**
   * The effective permission set: role defaults plus per-user grants, minus
   * revokes, filtered to the agency's enabled modules.
   */
  async resolveForUser(user: UserDocument): Promise<string[]> {
    if (user.isPlatformAdmin) {
      return ALL_PLATFORM_PERMISSIONS;
    }
    if (!user.agencyId) {
      return [];
    }
    const data = await this.loadAccessData(user);
    return resolvePermissionSet({
      rolePermissions: PermissionsService.rolePermissions(data),
      grants: data.grants,
      revokes: data.revokes,
      enabledModules: data.enabledModules,
      grantsAllEnabledModules: PermissionsService.grantsAll(data),
    });
  }

  /**
   * Human-readable role names (e.g. ["Agency Owner"]). Display only — never an
   * access decision.
   */
  async resolveRoleNames(user: UserDocument): Promise<string[]> {
    if (user.isPlatformAdmin) {
      return ['Platform Admin'];
    }
    if (!user.agencyId) {
      return [];
    }
    const data = await this.loadAccessData(user);
    return data.roles.map((role) => role.name).filter(Boolean);
  }

  async resolveDataScope(user: UserDocument): Promise<DataScope> {
    if (user.isPlatformAdmin) {
      return DataScope.Agency;
    }
    if (!user.agencyId) {
      return DataScope.Own;
    }
    return PermissionsService.widestScope(await this.loadAccessData(user));
  }

  /**
   * The full authorization context, from the database. The source of truth for
   * the request guards (via the resolver and its cache) and for the login
   * response — never trusted from the JWT.
   *
   * Loads once and folds four ways, rather than calling the four methods above
   * and paying for four aggregations.
   */
  async buildAccessContext(user: UserDocument): Promise<AccessContext> {
    if (user.isPlatformAdmin) {
      return {
        userId: user._id.toString(),
        agencyId: user.agencyId?.toString() ?? null,
        branchId: user.branchId?.toString() ?? null,
        isPlatformAdmin: true,
        scope: AccessScope.Platform,
        dataScope: DataScope.Agency,
        permissions: ALL_PLATFORM_PERMISSIONS,
        roleIds: [],
      };
    }

    const data = user.agencyId ? await this.loadAccessData(user) : EMPTY;
    const dataScope = PermissionsService.widestScope(data);
    const permissions = user.agencyId
      ? resolvePermissionSet({
          rolePermissions: PermissionsService.rolePermissions(data),
          grants: data.grants,
          revokes: data.revokes,
          enabledModules: data.enabledModules,
          grantsAllEnabledModules: PermissionsService.grantsAll(data),
        })
      : [];

    return {
      userId: user._id.toString(),
      agencyId: user.agencyId?.toString() ?? null,
      branchId: user.branchId?.toString() ?? null,
      isPlatformAdmin: false,
      scope:
        dataScope === DataScope.Agency ? AccessScope.Agency : AccessScope.Branch,
      dataScope,
      permissions,
      // Not a permission input. `buildScopeFilter` uses it to match a record
      // assigned to a *role* acting as a work queue rather than to a user
      // (PAC-72) — a DealAudit's `auditAssignee`. Sourced from `userRoles` now
      // that `user.roleIds` is gone; drop it and the hand-off board silently
      // stops matching role-assigned audits.
      roleIds: data.roles.map((role) => role.roleId),
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
