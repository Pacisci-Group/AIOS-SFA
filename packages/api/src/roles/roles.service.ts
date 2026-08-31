import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  ALL_AGENCY_ADMIN_PERMISSIONS,
  ALL_PLATFORM_PERMISSIONS,
  allPagePermissionKeys,
  DataScope,
  PageLevelOverride,
  pageLevelToPermissions,
} from '@sfa/shared';
import { Model, Types } from 'mongoose';
import { AccessResolverService } from '../permissions/access-resolver.service';
import { OwnerProtectionService } from '../permissions/owner-protection.service';
import { RoleAssignmentsService } from '../permissions/role-assignments.service';
import { UserRole } from '../permissions/schemas/user-role.schema';
import { Agency, AgencyDocument } from '../platform/schemas/agency.schema';
import { AgencyRole, AgencyRoleDocument } from './schemas/agency-role.schema';
import { RoleListItem, RoleResponse } from './roles.types';

/** Slug from a role name: `Branch Manager` -> `branch_manager`. */
function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * The only permission strings that may ever be persisted on a role: page
 * `{module}:read|write` permissions plus the owner-only admin permissions.
 * This is the enforcement point for the all-or-nothing page model.
 */
const ALLOWED_ROLE_PERMISSIONS = new Set<string>([
  ...allPagePermissionKeys(),
  ...ALL_AGENCY_ADMIN_PERMISSIONS,
  ...ALL_PLATFORM_PERMISSIONS,
]);

@Injectable()
export class RolesService {
  constructor(
    @InjectModel(AgencyRole.name) private roleModel: Model<AgencyRoleDocument>,
    @InjectModel(Agency.name) private agencyModel: Model<AgencyDocument>,
    @InjectModel(UserRole.name) private userRoleModel: Model<UserRole>,
    private accessResolver: AccessResolverService,
    private roleAssignments: RoleAssignmentsService,
    private ownerProtection: OwnerProtectionService,
  ) {}

  /**
   * Roles with the permission keys each grants and how many people hold it.
   *
   * `permissions` is rebuilt from the `rolePermissions` join rather than read
   * off the document — the field is gone — so the response shape the web
   * already consumes is unchanged.
   */
  async findByAgency(agencyId: string): Promise<RoleListItem[]> {
    const roles = await this.roleModel
      .find({ agencyId: new Types.ObjectId(agencyId) })
      .sort({ name: 1 })
      .lean();
    return Promise.all(
      roles.map(async (role) => ({
        ...role,
        permissions: await this.roleAssignments.rolePermissionKeys([role._id]),
        userCount: await this.userRoleModel.countDocuments({
          roleId: role._id,
        }),
      })),
    );
  }

  async findById(agencyId: string, roleId: string): Promise<RoleResponse> {
    const role = await this.roleModel
      .findOne({
        _id: new Types.ObjectId(roleId),
        agencyId: new Types.ObjectId(agencyId),
      })
      .lean();
    if (!role) {
      throw new NotFoundException('Role not found');
    }
    return {
      ...role,
      permissions: await this.roleAssignments.rolePermissionKeys([role._id]),
    };
  }

  /**
   * Set a role's page levels and/or its agency-admin capabilities.
   *
   * Each submitted page level expands to `{module}:read` / `{module}:write` for
   * pages whose module the agency has enabled.
   *
   * **Both arguments are independently optional, and omitting one preserves it.**
   * `levels` alone is what the web sent for its whole life; `adminPermissions`
   * alone must not wipe the page matrix. In both cases `[]` is a real
   * instruction to clear that half, which is why the checks are for `undefined`
   * rather than falsiness.
   *
   * ⚠ `platform:*` is preserved and never settable here, whatever is passed.
   * Those permissions sit above the tenant boundary; an agency owner granting
   * themselves one would be a privilege escalation out of their own tenant.
   *
   * ⚠ Refuses a role with `grantsAllEnabledModules`. That role's access is a
   * *rule* — everything the agency has enabled — not a stored set, so editing
   * its page levels would either do nothing or, worse, appear to work. The web
   * has always rendered it read-only; until now the API silently disagreed, and
   * an owner could `PATCH` their own admin permissions away.
   */
  async updateLevels(
    agencyId: string,
    roleId: string,
    levels?: PageLevelOverride[],
    adminPermissions?: string[],
  ): Promise<RoleResponse> {
    const role = await this.roleModel.findOne({
      _id: new Types.ObjectId(roleId),
      agencyId: new Types.ObjectId(agencyId),
    });
    if (!role) {
      throw new NotFoundException('Role not found');
    }
    if (role.grantsAllEnabledModules) {
      throw new ConflictException(
        'The Agency Owner role always has full access to every enabled module and cannot be edited.',
      );
    }

    const agency = await this.agencyModel.findById(agencyId).lean();
    const enabledModules = new Set(
      agency
        ? Object.entries(agency.modules ?? {})
            .filter(([, entry]) => entry.enabled)
            .map(([key]) => key)
        : [],
    );

    const current = await this.roleAssignments.rolePermissionKeys([role._id]);

    // `platform:*` is always carried over and can never be set through this
    // endpoint — see the docblock. Only whitelisted strings survive, so a
    // legacy or unknown permission on the role is dropped rather than
    // reinstated.
    const platform = current.filter(
      (permission) =>
        permission.startsWith('platform:') &&
        ALLOWED_ROLE_PERMISSIONS.has(permission),
    );

    const admin =
      adminPermissions === undefined
        ? current.filter(
            (permission) =>
              permission.startsWith('agency:') &&
              ALLOWED_ROLE_PERMISSIONS.has(permission),
          )
        : this.validateAdminPermissions(adminPermissions);

    const pagePermissions =
      levels === undefined
        ? current.filter((permission) => {
            const [moduleKey] = permission.split(':');
            return (
              !permission.startsWith('agency:') &&
              !permission.startsWith('platform:') &&
              // Same filter the write path applies, so preserving cannot
              // resurrect a page whose module has since been disabled.
              enabledModules.has(moduleKey)
            );
          })
        : levels.flatMap(({ moduleKey, level }) =>
            enabledModules.has(moduleKey)
              ? pageLevelToPermissions(moduleKey, level)
              : [],
          );

    const next = [...new Set([...platform, ...admin, ...pagePermissions])];
    assertAllowedPermissions(next);

    // Writes the join AND invalidates every holder's cached permissions.
    await this.roleAssignments.setRolePermissions(agencyId, role._id, next);

    return this.findById(agencyId, roleId);
  }

  /**
   * Narrow a submitted admin set to real `agency:*` capabilities.
   *
   * Rejects rather than filters. A caller sending `platform:agencies:write`
   * here is either confused or probing, and silently dropping it would let the
   * UI show a permission as saved that was never stored.
   */
  private validateAdminPermissions(permissions: string[]): string[] {
    const invalid = permissions.filter(
      (permission) =>
        !permission.startsWith('agency:') ||
        !ALLOWED_ROLE_PERMISSIONS.has(permission),
    );
    if (invalid.length) {
      throw new BadRequestException(
        `Not an agency capability: ${invalid.join(', ')}`,
      );
    }
    return [...new Set(permissions)];
  }

  /**
   * Create a custom role.
   *
   * `isSystemTemplate` and `grantsAllEnabledModules` are forced off and are not
   * settable over HTTP, ever: the first would make the role undeletable, and the
   * second would mint a second all-access role outside the owner protection
   * rules.
   */
  async create(
    agencyId: string,
    input: { name: string; description?: string; dataScope?: DataScope },
  ): Promise<RoleResponse> {
    const name = input.name?.trim();
    if (!name) {
      throw new BadRequestException('A role name is required.');
    }
    const slug = slugify(name);
    if (!slug) {
      throw new BadRequestException(
        'That role name contains no usable characters.',
      );
    }

    // Checked rather than left to the unique (agencyId, slug) index, so the
    // caller gets a sentence instead of a duplicate-key error.
    const clash = await this.roleModel.exists({
      agencyId: new Types.ObjectId(agencyId),
      slug,
    });
    if (clash) {
      throw new ConflictException(`A role named “${name}” already exists.`);
    }

    const role = await this.roleModel.create({
      agencyId: new Types.ObjectId(agencyId),
      name,
      slug,
      description: input.description?.trim(),
      dataScope: input.dataScope ?? DataScope.Own,
      isSystemTemplate: false,
      grantsAllEnabledModules: false,
    });

    return this.findById(agencyId, role._id.toString());
  }

  /**
   * Rename a role or change its scope.
   *
   * A `dataScope` change invalidates every holder — nothing else did that
   * before, because the field was not editable over HTTP at all, and a stale
   * cached scope is a user reading rows they should no longer see.
   */
  async update(
    agencyId: string,
    roleId: string,
    input: { name?: string; description?: string; dataScope?: DataScope },
  ): Promise<RoleResponse> {
    const role = await this.roleModel.findOne({
      _id: new Types.ObjectId(roleId),
      agencyId: new Types.ObjectId(agencyId),
    });
    if (!role) {
      throw new NotFoundException('Role not found');
    }
    if (role.isSystemTemplate && input.name && slugify(input.name) !== role.slug) {
      throw new ConflictException(
        'A system role can be renamed for display, but its slug is referenced by code and cannot change.',
      );
    }

    const scopeChanged =
      input.dataScope !== undefined && input.dataScope !== role.dataScope;

    if (input.name?.trim()) role.name = input.name.trim();
    if (input.description !== undefined) {
      role.description = input.description.trim();
    }
    if (input.dataScope !== undefined) role.dataScope = input.dataScope;
    await role.save();

    if (scopeChanged) {
      await this.accessResolver.invalidateRole(agencyId, roleId);
    }

    return this.findById(agencyId, roleId);
  }

  /**
   * Delete a custom role.
   *
   * Three separate refusals, because they fail for different reasons and the
   * owner needs to know which: a system role is referenced by code, the owner
   * role would strand the agency, and a role someone still holds would silently
   * strip their access.
   */
  async remove(agencyId: string, roleId: string): Promise<void> {
    const role = await this.roleModel.findOne({
      _id: new Types.ObjectId(roleId),
      agencyId: new Types.ObjectId(agencyId),
    });
    if (!role) {
      throw new NotFoundException('Role not found');
    }
    if (role.isSystemTemplate) {
      throw new ConflictException(
        'System roles cannot be deleted. Remove it from everyone who holds it instead.',
      );
    }
    await this.ownerProtection.assertRoleIsDeletable(agencyId, roleId);

    const holders = await this.userRoleModel.countDocuments({
      roleId: role._id,
    });
    if (holders > 0) {
      throw new ConflictException(
        `${holders} user(s) still hold this role. Reassign them first.`,
      );
    }

    // Before the delete: afterwards there is no role to resolve holders by.
    await this.accessResolver.invalidateRole(agencyId, roleId);
    await this.roleAssignments.purgeRole(role._id);
    await this.roleModel.deleteOne({ _id: role._id });
  }
}

/**
 * Fail fast if any permission outside the page/admin model would be persisted.
 * In normal operation this never throws; it guards against regressions that
 * would reintroduce fine-grained strings the resolver cannot interpret.
 */
function assertAllowedPermissions(permissions: string[]): void {
  const invalid = permissions.filter((p) => !ALLOWED_ROLE_PERMISSIONS.has(p));
  if (invalid.length) {
    throw new BadRequestException(
      `Invalid permission(s) for page-level model: ${invalid.join(', ')}`,
    );
  }
}
