import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AccessResolverService } from '../permissions/access-resolver.service';
import { User, type UserDocument } from '../users/schemas/user.schema';
import { reviewsBranch } from './time-off-access';

/**
 * Who can decide a request (PAC-165): the agency's active people holding
 * `hr:write` whose data scope covers the request's branch.
 *
 * Resolved through `AccessResolverService` — the same answer the guards
 * give on a request — rather than a query over `rolePermissions`, which
 * would miss everyone the pure resolver adds or removes: an Agency Owner
 * holds `hr:write` through `grantsAllEnabledModules` with no row at all, a
 * per-user grant or revoke changes it, and it disappears when the agency
 * turns the module off. An agency is tens of people and the resolver is
 * cached, so asking for each is cheap and cannot disagree with the guard.
 *
 * Lives in the feature, not in `common/time-off`: the worker imports that
 * module, and must not pull the permissions module (and its Redis client)
 * in with it.
 *
 * There is **no fallback audience** (decided 2026-11-05). Nobody in scope
 * means an empty list — the request waits, and the form says so.
 */
@Injectable()
export class TimeOffReviewersService {
  constructor(
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    private readonly accessResolver: AccessResolverService,
  ) {}

  /** The user ids that can decide a request stamped with `branchId`, minus `exclude`. */
  async reviewersFor(
    agencyId: string,
    branchId: string,
    exclude: readonly (string | null | undefined)[] = [],
  ): Promise<string[]> {
    const skip = new Set(exclude.filter(Boolean));
    const candidates = await this.users
      .find({
        agencyId: new Types.ObjectId(agencyId),
        isActive: true,
        deactivatedAt: null,
        isPlatformAdmin: { $ne: true },
      })
      .select('_id')
      .lean<{ _id: Types.ObjectId }[]>();

    const reviewers: string[] = [];
    for (const candidate of candidates) {
      const id = candidate._id.toString();
      if (skip.has(id)) continue;
      const access = await this.accessResolver.resolve(id);
      if (access && reviewsBranch(access, branchId)) reviewers.push(id);
    }
    return reviewers;
  }
}
