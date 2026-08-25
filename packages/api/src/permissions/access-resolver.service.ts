import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { AccessContext } from '@sfa/shared';
import { Model, Types } from 'mongoose';
import { User, UserDocument } from '../users/schemas/user.schema';
import { PermissionCache } from './cache/permission-cache';
import { PermissionsService } from './permissions.service';

/**
 * Request-time source of truth for authorization. Resolves a user's full
 * {@link AccessContext} from MongoDB, optionally served from a cache. Because
 * this runs on every authenticated request, owner permission/role edits and
 * user de-provisioning take effect on the very next request instead of waiting
 * for the JWT to expire.
 */
@Injectable()
export class AccessResolverService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private permissionsService: PermissionsService,
    private cache: PermissionCache,
  ) {}

  /**
   * Resolve the live access context for a user. Returns `null` when the user no
   * longer exists or has been deactivated — callers treat this as "no access".
   */
  async resolve(userId: string): Promise<AccessContext | null> {
    if (!Types.ObjectId.isValid(userId)) {
      return null;
    }

    const cached = await this.cache.get(userId);
    if (cached) {
      return cached;
    }

    const user = await this.userModel.findById(userId);
    if (!user || !user.isActive) {
      return null;
    }

    const context = await this.permissionsService.buildAccessContext(user);
    await this.cache.set(userId, context);
    return context;
  }

  /** Drop a single user's cached context (e.g. their overrides changed). */
  async invalidateUser(userId: string): Promise<void> {
    await this.cache.del(userId);
  }

  /**
   * Drop cached contexts for every user holding a role in an agency. Used when a
   * role's permission set changes so all its members re-resolve.
   */
  async invalidateRole(agencyId: string, roleId: string): Promise<void> {
    const users = await this.userModel
      .find({
        agencyId: new Types.ObjectId(agencyId),
        roleIds: new Types.ObjectId(roleId),
      })
      .select('_id')
      .lean();
    await this.cache.delMany(users.map((u) => u._id.toString()));
  }

  /**
   * Drop cached contexts for every user in an agency. Used when agency-wide
   * settings change (e.g. module entitlements are toggled).
   */
  async invalidateAgency(agencyId: string): Promise<void> {
    const users = await this.userModel
      .find({ agencyId: new Types.ObjectId(agencyId) })
      .select('_id')
      .lean();
    await this.cache.delMany(users.map((u) => u._id.toString()));
  }
}
