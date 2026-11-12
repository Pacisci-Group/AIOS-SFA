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
import { Model, Types, type FilterQuery } from 'mongoose';
import {
  DEFAULT_AGENCY_TIME_ZONE,
  isIanaTimeZone,
} from '../common/dates/time-zones';
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
  /** The agency's calendar (PAC-141). See {@link AccessContext.timeZone}. */
  timeZone: string;
  roles: ResolvedRole[];
  grants: string[];
  revokes: string[];
}

/** What resolving needs of a user: who, and which agency. */
interface AccessUser {
  _id: Types.ObjectId;
  agencyId?: Types.ObjectId | null;
  isPlatformAdmin?: boolean;
}

/** Someone {@link PermissionsService.activeUsersHolding} found. */
export interface PermissionHolder {
  _id: Types.ObjectId;
  firstName?: string;
  lastName?: string;
  email: string;
  /** Their effective permissions, for any further check the caller makes. */
  permissions: string[];
  /** Display only — never an access decision. */
  roleNames: string[];
}

const EMPTY: AccessData = {
  enabledModules: [],
  timeZone: DEFAULT_AGENCY_TIME_ZONE,
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
   * The single read behind every resolve* method below — for one user, the
   * many-user read with a list of one.
   */
  private async loadAccessData(user: AccessUser): Promise<AccessData> {
    return (await this.loadAccessDataMany([user])).get(String(user._id))!;
  }

  /**
   * Every user's roles, permission keys, overrides and agency in three reads
   * per agency, however many users are asked about — what an assignee picker
   * needs, where a resolve per person is a read storm.
   *
   * `$lookup` accepts `localField`/`foreignField` alongside a `pipeline` from
   * MongoDB 5.0; the deployed clusters are 7.x. The inner pipelines project
   * away everything unused, so the payload stays small even for an owner.
   *
   * Roles are matched on `agencyId` as well as `_id`: a `userRoles` row is not
   * itself proof that the role belongs to the user's tenant, and a stale row
   * pointing at another agency's role must contribute nothing.
   */
  private async loadAccessDataMany(
    users: readonly AccessUser[],
  ): Promise<Map<string, AccessData>> {
    const result = new Map<string, AccessData>();
    const byAgency = new Map<string, AccessUser[]>();
    for (const user of users) {
      if (!user.agencyId) {
        result.set(String(user._id), EMPTY);
        continue;
      }
      const key = String(user.agencyId);
      byAgency.set(key, [...(byAgency.get(key) ?? []), user]);
    }

    for (const members of byAgency.values()) {
      const agencyId = members[0].agencyId!;
      const userIds = members.map((user) => user._id);
      const [roleRows, agency, overrides] = await Promise.all([
        this.userRoleModel.aggregate<{
          _id: Types.ObjectId;
          roles: {
            _id: Types.ObjectId;
            name: string;
            slug: string;
            dataScope: DataScope;
            grantsAllEnabledModules: boolean;
            permissionKeys: string[];
          }[];
        }>([
          { $match: { userId: { $in: userIds } } },
          {
            $lookup: {
              from: 'roles',
              localField: 'roleId',
              foreignField: '_id',
              as: 'role',
              pipeline: [
                { $match: { agencyId } },
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
              _id: '$userId',
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
        ]),
        this.agencyModel
          .findById(agencyId)
          .select({ modules: 1, timezone: 1 })
          .lean(),
        this.userPermissionModel
          .find({ userId: { $in: userIds } })
          .select({ userId: 1, permissionKey: 1, effect: 1 })
          .lean(),
      ]);

      const enabledModules = Object.entries(agency?.modules ?? {})
        .filter(([, entry]) => entry.enabled)
        .map(([key]) => key);
      // Validated, not just defaulted: a zone the runtime cannot resolve would
      // otherwise surface as a 500 in the first date helper of every request.
      // The schema validator and the write paths make this unreachable; the
      // check is for a row edited by hand.
      const timeZone = isIanaTimeZone(agency?.timezone)
        ? agency.timezone
        : DEFAULT_AGENCY_TIME_ZONE;
      const rolesByUser = new Map(
        roleRows.map((row) => [String(row._id), row.roles]),
      );
      for (const user of members) {
        const id = String(user._id);
        const own = overrides.filter((o) => String(o.userId) === id);
        result.set(id, {
          enabledModules,
          timeZone,
          roles: (rolesByUser.get(id) ?? []).map((role) => ({
            roleId: role._id.toString(),
            name: role.name,
            slug: role.slug,
            dataScope: role.dataScope,
            grantsAllEnabledModules: role.grantsAllEnabledModules,
            permissionKeys: role.permissionKeys ?? [],
          })),
          grants: own
            .filter((o) => o.effect === 'grant')
            .map((o) => o.permissionKey),
          revokes: own
            .filter((o) => o.effect === 'revoke')
            .map((o) => o.permissionKey),
        });
      }
    }
    return result;
  }

  /** The effective set {@link resolveForUser} computes, from loaded data. */
  private static effective(data: AccessData): string[] {
    return resolvePermissionSet({
      rolePermissions: PermissionsService.rolePermissions(data),
      grants: data.grants,
      revokes: data.revokes,
      enabledModules: data.enabledModules,
      grantsAllEnabledModules: PermissionsService.grantsAll(data),
    });
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
    return PermissionsService.effective(await this.loadAccessData(user));
  }

  /**
   * The agency's **active** users whose effective permissions include
   * `permission`, by first then last name, each with that set and their role
   * names (display only). Active leaves out pending invites and deactivated
   * accounts; platform admins never count. `where` narrows the users — a
   * branch, or the one person a write names — and never widens the agency.
   *
   * The "who can be handed X" question asked by permission, never by role
   * name, so a custom role that carries the permission qualifies and someone
   * whose permission was revoked does not.
   */
  async activeUsersHolding(
    agencyId: string,
    permission: string,
    where: FilterQuery<UserDocument> = {},
  ): Promise<PermissionHolder[]> {
    const base: FilterQuery<UserDocument> = {
      agencyId: new Types.ObjectId(agencyId),
      isPlatformAdmin: { $ne: true },
      isActive: { $ne: false },
    };
    const users = await this.userModel
      .find(Object.keys(where).length ? { $and: [base, where] } : base)
      .select('firstName lastName email agencyId isPlatformAdmin')
      .sort({ firstName: 1, lastName: 1 })
      .lean<
        (AccessUser & Omit<PermissionHolder, 'permissions' | 'roleNames'>)[]
      >();
    const access = await this.loadAccessDataMany(users);
    return users.flatMap((user) => {
      const data = access.get(String(user._id)) ?? EMPTY;
      const permissions = PermissionsService.effective(data);
      if (!permissions.includes(permission)) return [];
      return [
        {
          _id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          permissions,
          roleNames: data.roles.map((role) => role.name),
        },
      ];
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
        // A platform admin holds no agency permission, so no date helper ever
        // runs on their behalf; the field is filled so the context is whole.
        timeZone: DEFAULT_AGENCY_TIME_ZONE,
        tokenVersion: user.tokenVersion ?? 0,
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
        dataScope === DataScope.Agency
          ? AccessScope.Agency
          : AccessScope.Branch,
      dataScope,
      permissions,
      // Not a permission input. `buildScopeFilter` uses it to match a record
      // assigned to a *role* acting as a work queue rather than to a user
      // (PAC-72) — a DealAudit's `auditAssignee`. Sourced from `userRoles` now
      // that `user.roleIds` is gone; drop it and the hand-off board silently
      // stops matching role-assigned audits.
      roleIds: data.roles.map((role) => role.roleId),
      timeZone: data.timeZone,
      // Straight off the document, not derived. `AccessContextGuard` compares it
      // to the caller's signed claim so a password reset ends every session that
      // was live when it happened (PAC-79).
      tokenVersion: user.tokenVersion ?? 0,
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
      tokenVersion: context.tokenVersion ?? 0,
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
