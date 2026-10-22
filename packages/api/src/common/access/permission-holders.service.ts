import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { resolvePermissionSet } from '@sfa/shared';
import { Model, Types } from 'mongoose';
import { RolePermission } from '../../permissions/schemas/role-permission.schema';
import { UserPermission } from '../../permissions/schemas/user-permission.schema';
import { UserRole } from '../../permissions/schemas/user-role.schema';
import { Agency } from '../../platform/schemas/agency.schema';
import { AgencyRole } from '../../roles/schemas/agency-role.schema';
import { User } from '../../users/schemas/user.schema';

export interface PermissionHoldersOptions {
  /** Only users pinned to this branch. */
  branchId?: string | Types.ObjectId | null;
  /** Left out of the answer — the submitter of the thing being routed. */
  exceptUserId?: string | Types.ObjectId | null;
}

type UserRow = { _id: Types.ObjectId; branchId?: Types.ObjectId | null };
type RoleRow = {
  _id: Types.ObjectId;
  grantsAllEnabledModules?: boolean;
};

/**
 * "Who in this agency holds permission X?" (PAC-161) — the recipient
 * resolver the HR notifications route through. The Q4 holiday job needs
 * every `agency:hr:admin` holder; PAC-165 needs every `hr:write` holder in
 * the employee's branch minus the submitter.
 *
 * Reads the same join collections `PermissionsService.loadAccessData` reads
 * and resolves each user with the same pure `resolvePermissionSet`, so the
 * answer is the one the guards would give. In `common/access/` because the
 * worker may not import `PermissionsService`.
 *
 * Active, non-platform users only: a notification to a deactivated account
 * is noise, and a platform admin is not an agency's person.
 */
@Injectable()
export class PermissionHoldersService {
  constructor(
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(UserRole.name) private readonly userRoles: Model<UserRole>,
    @InjectModel(AgencyRole.name) private readonly roles: Model<AgencyRole>,
    @InjectModel(RolePermission.name)
    private readonly rolePermissions: Model<RolePermission>,
    @InjectModel(UserPermission.name)
    private readonly userPermissions: Model<UserPermission>,
    @InjectModel(Agency.name) private readonly agencies: Model<Agency>,
  ) {}

  async usersHolding(
    agencyId: string | Types.ObjectId,
    permission: string,
    options: PermissionHoldersOptions = {},
  ): Promise<Types.ObjectId[]> {
    const agencyObjectId = new Types.ObjectId(String(agencyId));
    const userFilter: Record<string, unknown> = {
      agencyId: agencyObjectId,
      isActive: true,
      isPlatformAdmin: { $ne: true },
    };
    if (options.branchId) {
      userFilter.branchId = new Types.ObjectId(String(options.branchId));
    }
    if (options.exceptUserId) {
      userFilter._id = {
        $ne: new Types.ObjectId(String(options.exceptUserId)),
      };
    }
    const candidates = await this.users
      .find(userFilter)
      .select({ _id: 1 })
      .lean<UserRow[]>();
    if (candidates.length === 0) return [];
    const candidateIds = candidates.map((user) => user._id);

    const [agency, roles, assignments, overrides] = await Promise.all([
      this.agencies
        .findById(agencyObjectId)
        .select({ modules: 1 })
        .lean<{ modules?: Record<string, { enabled?: boolean }> } | null>(),
      this.roles
        .find({ agencyId: agencyObjectId })
        .select({ _id: 1, grantsAllEnabledModules: 1 })
        .lean<RoleRow[]>(),
      this.userRoles
        .find({ userId: { $in: candidateIds } })
        .select({ userId: 1, roleId: 1 })
        .lean<{ userId: Types.ObjectId; roleId: Types.ObjectId }[]>(),
      this.userPermissions
        .find({ userId: { $in: candidateIds } })
        .select({ userId: 1, permissionKey: 1, effect: 1 })
        .lean<
          {
            userId: Types.ObjectId;
            permissionKey: string;
            effect: 'grant' | 'revoke';
          }[]
        >(),
    ]);

    const enabledModules = Object.entries(agency?.modules ?? {})
      .filter(([, entry]) => entry?.enabled)
      .map(([key]) => key);

    // Roles are matched on the agency, so a stale `userRoles` row pointing at
    // another tenant's role contributes nothing — same rule as the loader.
    const roleById = new Map(
      roles.map((role) => [role._id.toHexString(), role]),
    );
    const roleIds = roles.map((role) => role._id);
    const rolePermissionRows = await this.rolePermissions
      .find({ roleId: { $in: roleIds } })
      .select({ roleId: 1, permissionKey: 1 })
      .lean<{ roleId: Types.ObjectId; permissionKey: string }[]>();
    const keysByRole = new Map<string, string[]>();
    for (const row of rolePermissionRows) {
      const key = row.roleId.toHexString();
      const list = keysByRole.get(key) ?? [];
      list.push(row.permissionKey);
      keysByRole.set(key, list);
    }

    const rolesByUser = new Map<string, RoleRow[]>();
    for (const row of assignments) {
      const role = roleById.get(row.roleId.toHexString());
      if (!role) continue;
      const key = row.userId.toHexString();
      const list = rolesByUser.get(key) ?? [];
      list.push(role);
      rolesByUser.set(key, list);
    }
    const overridesByUser = new Map<
      string,
      { grants: string[]; revokes: string[] }
    >();
    for (const row of overrides) {
      const key = row.userId.toHexString();
      const entry = overridesByUser.get(key) ?? { grants: [], revokes: [] };
      (row.effect === 'grant' ? entry.grants : entry.revokes).push(
        row.permissionKey,
      );
      overridesByUser.set(key, entry);
    }

    const holders: Types.ObjectId[] = [];
    for (const user of candidates) {
      const key = user._id.toHexString();
      const userRoleRows = rolesByUser.get(key) ?? [];
      const resolved = resolvePermissionSet({
        rolePermissions: userRoleRows.flatMap(
          (role) => keysByRole.get(role._id.toHexString()) ?? [],
        ),
        grants: overridesByUser.get(key)?.grants,
        revokes: overridesByUser.get(key)?.revokes,
        enabledModules,
        grantsAllEnabledModules: userRoleRows.some(
          (role) => role.grantsAllEnabledModules === true,
        ),
      });
      if (resolved.includes(permission)) holders.push(user._id);
    }
    return holders;
  }
}
