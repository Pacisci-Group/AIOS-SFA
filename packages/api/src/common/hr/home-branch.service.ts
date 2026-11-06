import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Branch } from '../../branches/schemas/branch.schema';
import { User } from '../../users/schemas/user.schema';

/**
 * The branch a person belongs to **for HR** (PAC-165, lifted here in
 * PAC-169): their own, or — for someone with none, an Agency Owner — the
 * agency's default branch.
 *
 * One rule, three readers: a time off request is stamped with it, a
 * branch-scoped reviewer is tested against it, and an agency event for
 * "these branches" reaches the people whose home branch is named. Written
 * once so an owner cannot be in a branch for one of those and in none for
 * another.
 *
 * In `common/` because the working-day service (which the worker may
 * import) needs it to decide whether a branch event closes a person's day.
 */
@Injectable()
export class HomeBranchService {
  constructor(
    @InjectModel(Branch.name) private readonly branches: Model<Branch>,
    @InjectModel(User.name) private readonly users: Model<User>,
  ) {}

  /** The default branch, else the oldest; `null` for an agency with none. */
  async defaultBranchId(agencyId: string): Promise<string | null> {
    // `Branch.agencyId` is an ObjectId, unlike the HR collections' string.
    const agency = new Types.ObjectId(agencyId);
    const branch =
      (await this.branches
        .findOne({ agencyId: agency, isDefault: true })
        .select('_id')
        .lean<{ _id: Types.ObjectId } | null>()) ??
      (await this.branches
        .findOne({ agencyId: agency })
        .sort({ createdAt: 1 })
        .select('_id')
        .lean<{ _id: Types.ObjectId } | null>());
    return branch?._id.toString() ?? null;
  }

  /** One person's home branch; `null` for an unknown person or no branch. */
  async homeBranchOf(agencyId: string, userId: string): Promise<string | null> {
    return (await this.homeBranchIds(agencyId, [userId])).get(userId) ?? null;
  }

  /**
   * Home branch by user id, for the people who exist in the agency. The
   * default branch is read at most once, and only when somebody needs it.
   */
  async homeBranchIds(
    agencyId: string,
    userIds: readonly string[],
  ): Promise<Map<string, string | null>> {
    const ids = [...new Set(userIds)].filter((id) =>
      Types.ObjectId.isValid(id),
    );
    if (ids.length === 0) return new Map();
    const rows = await this.users
      .find({
        _id: { $in: ids.map((id) => new Types.ObjectId(id)) },
        agencyId: new Types.ObjectId(agencyId),
      })
      .select('branchId')
      .lean<{ _id: Types.ObjectId; branchId?: Types.ObjectId }[]>();
    const fallback = rows.some((row) => !row.branchId)
      ? await this.defaultBranchId(agencyId)
      : null;
    return new Map(
      rows.map((row) => [
        row._id.toString(),
        row.branchId ? row.branchId.toString() : fallback,
      ]),
    );
  }
}
