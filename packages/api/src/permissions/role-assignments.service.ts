import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  DEFAULT_ROLE_TEMPLATES,
  normalizeLegacyPermission,
  PERMISSION_BY_KEY,
} from '@sfa/shared';
import { AnyBulkWriteOperation, Model, Types } from 'mongoose';
import { authorshipForInsert } from '../common/context/request-context';
import {
  AgencyRole,
  AgencyRoleDocument,
} from '../roles/schemas/agency-role.schema';
import { AccessResolverService } from './access-resolver.service';
import { ActingUser, OwnerProtectionService } from './owner-protection.service';
import { Permission } from './schemas/permission.schema';
import {
  RolePermission,
  RolePermissionSource,
} from './schemas/role-permission.schema';
import { UserPermission } from './schemas/user-permission.schema';
import { UserRole } from './schemas/user-role.schema';

/** A role as a list view shows it: id for wiring, name and slug for display. */
export interface AssignedRole {
  _id: Types.ObjectId;
  name: string;
  slug: string;
}

/**
 * The **only** writer of `userRoles`, `rolePermissions` and `userPermissions`.
 *
 * That is a rule, not a convention. Three things hang off every write here and
 * each fails silently if a second writer skips them:
 *
 * 1. **Cache invalidation.** A role assignment that does not reach
 *    `AccessResolverService` leaves the user on their old permission set until
 *    the TTL expires. Nothing errors; they simply see the wrong app.
 * 2. **Owner protection.** `setUserRoles` is where an owner is stopped from
 *    demoting another owner. A direct `userRoles` write is a way around it.
 * 3. **Catalog validation.** A `permissionKey` with no catalog row can never be
 *    granted through the UI and never appears in the resolved set, so the
 *    permission looks granted in the database and denied at the guard.
 *
 * Assignment sites converted to route through here: `UsersService.inviteUser`
 * and `.updateRoles`, `PermissionsService.seedDefaultRoles`, the core and demo
 * seeds, the migration, and the e2e fixtures.
 */
@Injectable()
export class RoleAssignmentsService {
  constructor(
    @InjectModel(Permission.name)
    private readonly permissionModel: Model<Permission>,
    @InjectModel(RolePermission.name)
    private readonly rolePermissionModel: Model<RolePermission>,
    @InjectModel(UserRole.name)
    private readonly userRoleModel: Model<UserRole>,
    @InjectModel(UserPermission.name)
    private readonly userPermissionModel: Model<UserPermission>,
    @InjectModel(AgencyRole.name)
    private readonly roleModel: Model<AgencyRoleDocument>,
    private readonly accessResolver: AccessResolverService,
    private readonly ownerProtection: OwnerProtectionService,
  ) {}

  /**
   * Create or reconcile an agency's system roles from `DEFAULT_ROLE_TEMPLATES`.
   *
   * Lives here, not on `PermissionsService`, because it writes
   * `rolePermissions` — and every write to that collection goes through this
   * service. `PermissionsService` is read-only so that `AccessResolverService`
   * can inject it without closing a dependency cycle.
   *
   * ⚠ **The permission merge is a UNION, and that is deliberate.** A template
   * that *drops* a permission does not propagate, so an agency owner's
   * customisations are never silently reverted. `dataScope` and
   * `grantsAllEnabledModules` are overwritten, because those are structural.
   * The asymmetry is long-standing; do not "fix" it without a migration.
   *
   * Idempotent. Also note it only reaches agencies someone re-seeds — pushing a
   * template change across the estate is `sync-role-templates.ts`.
   */
  async seedDefaultRoles(agencyId: Types.ObjectId): Promise<void> {
    for (const template of DEFAULT_ROLE_TEMPLATES) {
      const role = await this.roleModel.findOneAndUpdate(
        { agencyId, slug: template.slug },
        {
          $set: {
            name: template.name,
            dataScope: template.dataScope,
            isSystemTemplate: true,
            grantsAllEnabledModules: template.grantsAllEnabledModules ?? false,
          },
          $setOnInsert: {
            agencyId,
            slug: template.slug,
            description: template.description,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );

      const existing = await this.rolePermissionKeys([role._id]);
      const merged = [
        ...new Set([
          // Normalized for the same reason the old implementation did it: a
          // role carrying a legacy fine-grained string collapses to the
          // read/write model rather than being dropped on the floor.
          ...existing.flatMap((key) => normalizeLegacyPermission(key)),
          ...template.permissions,
        ]),
      ];
      await this.setRolePermissions(agencyId, role._id, merged, 'template');
    }
  }

  /**
   * Catalog rows for the given keys, as a key -> _id map.
   *
   * Throws on an unknown key rather than skipping it. A silently dropped
   * permission is the failure mode this whole service exists to prevent, and
   * the shared `PERMISSION_BY_KEY` check catches a typo before the database
   * round trip.
   */
  private async resolveKeys(
    keys: string[],
  ): Promise<Map<string, Types.ObjectId>> {
    const unique = [...new Set(keys)];
    const unknown = unique.filter((key) => !PERMISSION_BY_KEY.has(key));
    if (unknown.length) {
      throw new BadRequestException(
        `Unknown permission(s): ${unknown.join(', ')}`,
      );
    }

    const rows = await this.permissionModel
      .find({ key: { $in: unique } })
      .select({ key: 1 })
      .lean();
    const map = new Map(rows.map((row) => [row.key, row._id]));

    const missing = unique.filter((key) => !map.has(key));
    if (missing.length) {
      throw new BadRequestException(
        `Permission catalog is missing: ${missing.join(', ')}. Re-run the seed.`,
      );
    }
    return map;
  }

  /**
   * Replace a role's permission set.
   *
   * A full replacement, not a merge — the caller has already decided the final
   * set. `seedDefaultRoles` does its own union first, precisely so a template
   * change never silently reverts an owner's customisation.
   */
  async setRolePermissions(
    agencyId: string | Types.ObjectId,
    roleId: string | Types.ObjectId,
    keys: string[],
    source: RolePermissionSource = 'custom',
  ): Promise<void> {
    const agency = new Types.ObjectId(agencyId.toString());
    const role = new Types.ObjectId(roleId.toString());
    const byKey = await this.resolveKeys(keys);

    const ops: AnyBulkWriteOperation<RolePermission>[] = [...byKey].map(
      ([permissionKey, permissionId]) => ({
        updateOne: {
          filter: { roleId: role, permissionKey },
          update: {
            $set: { agencyId: agency, permissionId, source },
            // bulkWrite bypasses Mongoose middleware entirely, so the
            // authorship plugin does not fire — stamp it by hand.
            $setOnInsert: { ...authorshipForInsert(), roleId: role },
          },
          upsert: true,
        },
      }),
    );
    ops.push({
      deleteMany: {
        filter: { roleId: role, permissionKey: { $nin: [...byKey.keys()] } },
      },
    });

    await this.rolePermissionModel.bulkWrite(ops);
    await this.accessResolver.invalidateRole(
      agency.toString(),
      role.toString(),
    );
  }

  /** Every permission key a role grants. */
  async rolePermissionKeys(
    roleIds: Types.ObjectId[] | string[],
  ): Promise<string[]> {
    if (!roleIds.length) return [];
    const ids = roleIds.map((id) => new Types.ObjectId(id.toString()));
    const rows = await this.rolePermissionModel
      .find({ roleId: { $in: ids } })
      .select({ permissionKey: 1 })
      .lean();
    return [...new Set(rows.map((row) => row.permissionKey))];
  }

  /**
   * Replace a user's roles.
   *
   * `actor` is required, not optional: owner protection is the point of this
   * method, and an optional actor is an invitation to call it without one. Seed
   * and migration callers pass an explicit platform-admin actor.
   */
  async setUserRoles(
    actor: ActingUser,
    agencyId: string | Types.ObjectId,
    userId: string | Types.ObjectId,
    roleIds: (string | Types.ObjectId)[],
  ): Promise<void> {
    const agency = new Types.ObjectId(agencyId.toString());
    const user = new Types.ObjectId(userId.toString());
    const next = [...new Set(roleIds.map((id) => id.toString()))];

    await this.ownerProtection.assertMayChangeOwnerRole(
      actor,
      agency.toString(),
      user.toString(),
      next,
    );

    // Captured before the write: a role the user is *losing* still needs its
    // cache entry dropped, and afterwards there is no row to find it by.
    const previous = await this.userRoleModel
      .find({ userId: user })
      .select({ roleId: 1 })
      .lean();

    const ops: AnyBulkWriteOperation<UserRole>[] = next.map((roleId) => ({
      updateOne: {
        filter: { userId: user, roleId: new Types.ObjectId(roleId) },
        update: {
          $set: { agencyId: agency },
          $setOnInsert: {
            ...authorshipForInsert(),
            userId: user,
            roleId: new Types.ObjectId(roleId),
          },
        },
        upsert: true,
      },
    }));
    ops.push({
      deleteMany: {
        filter: {
          userId: user,
          roleId: { $nin: next.map((id) => new Types.ObjectId(id)) },
        },
      },
    });

    await this.userRoleModel.bulkWrite(ops);
    await this.accessResolver.invalidateUser(user.toString());
    for (const row of previous) {
      if (!next.includes(row.roleId.toString())) {
        await this.accessResolver.invalidateRole(
          agency.toString(),
          row.roleId.toString(),
        );
      }
    }
  }

  /** The role ids a user holds. */
  async userRoleIds(
    userId: string | Types.ObjectId,
  ): Promise<Types.ObjectId[]> {
    const rows = await this.userRoleModel
      .find({ userId: new Types.ObjectId(userId.toString()) })
      .select({ roleId: 1 })
      .lean();
    return rows.map((row) => row.roleId);
  }

  /** The users holding a role. The inverse of {@link userRoleIds}. */
  async roleUserIds(
    roleId: string | Types.ObjectId,
  ): Promise<Types.ObjectId[]> {
    const rows = await this.userRoleModel
      .find({ roleId: new Types.ObjectId(roleId.toString()) })
      .select({ userId: 1 })
      .lean();
    return rows.map((row) => row.userId);
  }

  /**
   * The roles held by each of several users, for a list view.
   *
   * Batched over all the users at once — the alternative, a lookup per row, is
   * how a 15-person agency turns one query into sixteen. Users with no role are
   * simply absent from the map. Shared by the agency user list and the platform
   * user directory (PAC-70), which is why it lives here rather than on
   * `UsersService`.
   */
  async rolesForUsers(
    userIds: Types.ObjectId[],
  ): Promise<Map<string, AssignedRole[]>> {
    const byUser = new Map<string, AssignedRole[]>();
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

  /**
   * Replace a user's per-permission overrides.
   *
   * `grants` and `revokes` must be disjoint — the unique `(userId,
   * permissionKey)` index makes the alternative unrepresentable, so an overlap
   * is a caller bug worth naming rather than a race to resolve.
   */
  async setUserOverrides(
    agencyId: string | Types.ObjectId,
    userId: string | Types.ObjectId,
    grants: string[],
    revokes: string[],
  ): Promise<void> {
    const agency = new Types.ObjectId(agencyId.toString());
    const user = new Types.ObjectId(userId.toString());

    const overlap = grants.filter((key) => revokes.includes(key));
    if (overlap.length) {
      throw new BadRequestException(
        `Cannot grant and revoke the same permission: ${overlap.join(', ')}`,
      );
    }

    const byKey = await this.resolveKeys([...grants, ...revokes]);
    const desired = [
      ...grants.map((key) => ({ key, effect: 'grant' as const })),
      ...revokes.map((key) => ({ key, effect: 'revoke' as const })),
    ];

    const ops: AnyBulkWriteOperation<UserPermission>[] = desired.map(
      ({ key, effect }) => ({
        updateOne: {
          filter: { userId: user, permissionKey: key },
          update: {
            $set: {
              agencyId: agency,
              permissionId: byKey.get(key)!,
              effect,
            },
            $setOnInsert: {
              ...authorshipForInsert(),
              userId: user,
              permissionKey: key,
            },
          },
          upsert: true,
        },
      }),
    );
    ops.push({
      deleteMany: {
        filter: {
          userId: user,
          permissionKey: { $nin: desired.map((entry) => entry.key) },
        },
      },
    });

    await this.userPermissionModel.bulkWrite(ops);
    await this.accessResolver.invalidateUser(user.toString());
  }

  /** A user's overrides, split by effect. */
  async userOverrides(
    userId: string | Types.ObjectId,
  ): Promise<{ grants: string[]; revokes: string[] }> {
    const rows = await this.userPermissionModel
      .find({ userId: new Types.ObjectId(userId.toString()) })
      .select({ permissionKey: 1, effect: 1 })
      .lean();
    return {
      grants: rows
        .filter((r) => r.effect === 'grant')
        .map((r) => r.permissionKey),
      revokes: rows
        .filter((r) => r.effect === 'revoke')
        .map((r) => r.permissionKey),
    };
  }

  /** Remove every assignment referencing a role. Used when a role is deleted. */
  async purgeRole(roleId: string | Types.ObjectId): Promise<void> {
    const role = new Types.ObjectId(roleId.toString());
    await this.rolePermissionModel.deleteMany({ roleId: role });
    await this.userRoleModel.deleteMany({ roleId: role });
  }

  /** Remove every assignment belonging to a user. Used when a user is deleted. */
  async purgeUser(userId: string | Types.ObjectId): Promise<void> {
    const user = new Types.ObjectId(userId.toString());
    await this.userRoleModel.deleteMany({ userId: user });
    await this.userPermissionModel.deleteMany({ userId: user });
  }

  /**
   * Remove every assignment belonging to an agency.
   *
   * Used by one caller: `AgencyProvisioningService` rolling back a failed
   * onboarding (PAC-69). It is here rather than as a `deleteMany` in that
   * service because this class is the **only** writer of these three
   * collections — a rule that exists so cache invalidation, owner protection
   * and catalog validation cannot be bypassed, and that a rollback path is
   * exactly as able to break as a happy path.
   *
   * ⚠ Only safe on an agency being destroyed. It does not invalidate cached
   * access contexts, because the only agency this is ever called for is one
   * whose users were created seconds ago and never signed in.
   */
  async purgeAgency(agencyId: string | Types.ObjectId): Promise<void> {
    const agency = new Types.ObjectId(agencyId.toString());
    await this.rolePermissionModel.deleteMany({ agencyId: agency });
    await this.userRoleModel.deleteMany({ agencyId: agency });
    await this.userPermissionModel.deleteMany({ agencyId: agency });
  }
}
