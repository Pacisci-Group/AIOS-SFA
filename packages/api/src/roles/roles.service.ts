import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  ALL_AGENCY_ADMIN_PERMISSIONS,
  ALL_PLATFORM_PERMISSIONS,
  allPagePermissionKeys,
  PageLevelOverride,
  pageLevelToPermissions,
} from '@sfa/shared';
import { Model, Types } from 'mongoose';
import { Agency, AgencyDocument } from '../platform/schemas/agency.schema';
import { AgencyRole, AgencyRoleDocument } from './schemas/agency-role.schema';

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
  ) {}

  findByAgency(agencyId: string) {
    return this.roleModel
      .find({ agencyId: new Types.ObjectId(agencyId) })
      .sort({ name: 1 })
      .lean();
  }

  async findById(agencyId: string, roleId: string) {
    const role = await this.roleModel
      .findOne({
        _id: new Types.ObjectId(roleId),
        agencyId: new Types.ObjectId(agencyId),
      })
      .lean();
    if (!role) {
      throw new NotFoundException('Role not found');
    }
    return role;
  }

  /**
   * Set a role's per-page permission levels. Each submitted page level is
   * expanded to `{module}:read` / `{module}:write` strings for pages whose
   * module is enabled for the agency. Agency-admin (`agency:*`) and platform
   * permissions already on the role are preserved.
   */
  async updateLevels(
    agencyId: string,
    roleId: string,
    levels: PageLevelOverride[],
  ) {
    const role = await this.roleModel.findOne({
      _id: new Types.ObjectId(roleId),
      agencyId: new Types.ObjectId(agencyId),
    });
    if (!role) {
      throw new NotFoundException('Role not found');
    }

    const agency = await this.agencyModel.findById(agencyId).lean();
    const enabledModules = new Set(
      agency
        ? Object.entries(agency.modules ?? {})
            .filter(([, entry]) => entry.enabled)
            .map(([key]) => key)
        : [],
    );

    // Preserve owner-only admin permissions (agency / platform). Only whitelisted
    // admin permissions survive — no fine-grained or unknown strings.
    const preserved = role.permissions.filter(
      (permission) =>
        (permission.startsWith('agency:') ||
          permission.startsWith('platform:')) &&
        ALLOWED_ROLE_PERMISSIONS.has(permission),
    );

    const pagePermissions = levels.flatMap(({ moduleKey, level }) =>
      enabledModules.has(moduleKey)
        ? pageLevelToPermissions(moduleKey, level)
        : [],
    );

    const next = [...new Set([...preserved, ...pagePermissions])];
    assertAllowedPermissions(next);

    role.permissions = next;
    await role.save();

    return role.toObject();
  }
}

/**
 * Fail fast if any permission outside the page/admin model would be persisted.
 * In normal operation this never throws; it guards against regressions that
 * reintroduce fine-grained permission strings.
 */
function assertAllowedPermissions(permissions: string[]): void {
  const invalid = permissions.filter((p) => !ALLOWED_ROLE_PERMISSIONS.has(p));
  if (invalid.length) {
    throw new BadRequestException(
      `Invalid permission(s) for page-level model: ${invalid.join(', ')}`,
    );
  }
}
