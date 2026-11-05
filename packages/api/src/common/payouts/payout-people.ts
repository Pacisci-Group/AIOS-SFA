import type { PayoutPersonStatus } from '@sfa/shared';
import { Types, type FilterQuery, type Model } from 'mongoose';
import type { BranchDocument } from '../../branches/schemas/branch.schema';
import type { UserRole } from '../../permissions/schemas/user-role.schema';
import type { AgencyRoleDocument } from '../../roles/schemas/agency-role.schema';
import type { UserDocument } from '../../users/schemas/user.schema';

export interface PayoutPeopleModels {
  userModel: Model<UserDocument>;
  roleModel: Model<AgencyRoleDocument>;
  userRoleModel: Model<UserRole>;
  branchModel: Model<BranchDocument>;
}

/** One agency person as the Payouts pages show them. */
export interface PayoutPerson {
  id: string;
  name: string;
  email: string;
  /** Role names, for display. */
  roles: string[];
  /** Role slugs — what the statement engine reads (`payoutPoolFor`). */
  roleSlugs: string[];
  status: PayoutPersonStatus;
  branchId: string | null;
  branchName: string | null;
  /** The "SOK number" — the statement's Producer ID. */
  allstateBindId: string | null;
}

interface LeanUser {
  _id: Types.ObjectId;
  firstName?: string;
  lastName?: string;
  email: string;
  isActive?: boolean;
  deactivatedAt?: Date | null;
  branchId?: Types.ObjectId | null;
  allstateBindId?: string | null;
}

/**
 * Removed beats invited beats active. `deactivatedAt` is checked first because
 * a removed account is also `isActive: false` — the same two-field reading
 * `UsersService.findPendingInvite` makes for the invite flow.
 */
export function payoutPersonStatus(user: {
  isActive?: boolean;
  deactivatedAt?: Date | null;
}): PayoutPersonStatus {
  if (user.deactivatedAt) return 'deactivated';
  if (user.isActive === false) return 'invited';
  return 'active';
}

/**
 * The agency's people, with their role names and branch, keyed by id.
 *
 * - With `ids`, exactly those people (removed ones included), clamped to the
 *   agency — a structure's members, or the ids a save names.
 * - Without, everyone who has not been removed: the people step offers
 *   invitees too, so a structure can be ready before someone's first day.
 *
 * Platform admins are never an agency's people.
 *
 * In `common/` (moved from `payouts/` in PAC-178) because the monthly
 * statement job needs the same people — removed ones included, which
 * `activeRoleHolders` leaves out — and the worker may not import a feature
 * directory.
 */
export async function loadPayoutPeople(
  models: PayoutPeopleModels,
  agencyId: string,
  ids?: readonly (string | Types.ObjectId)[],
): Promise<Map<string, PayoutPerson>> {
  const agencyOid = new Types.ObjectId(agencyId);
  const where: FilterQuery<UserDocument> = {
    agencyId: agencyOid,
    isPlatformAdmin: { $ne: true },
  };
  if (ids) {
    if (!ids.length) return new Map();
    where._id = { $in: ids.map((id) => new Types.ObjectId(String(id))) };
  } else {
    where.deactivatedAt = null;
  }
  const users = await models.userModel
    .find(where)
    .select(
      'firstName lastName email isActive deactivatedAt branchId allstateBindId',
    )
    .sort({ firstName: 1, lastName: 1, email: 1 })
    .lean<LeanUser[]>();
  if (!users.length) return new Map();

  // Role names through the join, clamped to the agency's own roles.
  const links = await models.userRoleModel
    .find({ userId: { $in: users.map((user) => user._id) } })
    .select({ userId: 1, roleId: 1 })
    .lean<{ userId: Types.ObjectId; roleId: Types.ObjectId }[]>();
  const roles = links.length
    ? await models.roleModel
        .find({
          agencyId: agencyOid,
          _id: { $in: [...new Set(links.map((link) => String(link.roleId)))] },
        })
        .select('name slug')
        .lean<{ _id: Types.ObjectId; name: string; slug: string }[]>()
    : [];
  const roleById = new Map(roles.map((role) => [String(role._id), role]));
  const rolesByUser = new Map<string, string[]>();
  const slugsByUser = new Map<string, string[]>();
  for (const link of links) {
    const role = roleById.get(String(link.roleId));
    if (!role) continue;
    const key = String(link.userId);
    rolesByUser.set(key, [...(rolesByUser.get(key) ?? []), role.name]);
    slugsByUser.set(key, [...(slugsByUser.get(key) ?? []), role.slug]);
  }

  const branchIds = [
    ...new Set(
      users
        .map((user) => user.branchId)
        .filter(Boolean)
        .map(String),
    ),
  ];
  const branches = branchIds.length
    ? await models.branchModel
        .find({ agencyId: agencyOid, _id: { $in: branchIds } })
        .select('name')
        .lean<{ _id: Types.ObjectId; name: string }[]>()
    : [];
  const branchName = new Map(
    branches.map((branch) => [String(branch._id), branch.name]),
  );

  const people = new Map<string, PayoutPerson>();
  for (const user of users) {
    const id = String(user._id);
    const branchId = user.branchId ? String(user.branchId) : null;
    people.set(id, {
      id,
      name:
        [user.firstName, user.lastName].filter(Boolean).join(' ').trim() ||
        user.email,
      email: user.email,
      roles: (rolesByUser.get(id) ?? []).sort((a, b) => a.localeCompare(b)),
      roleSlugs: (slugsByUser.get(id) ?? []).sort(),
      status: payoutPersonStatus(user),
      branchId,
      branchName: branchId ? (branchName.get(branchId) ?? null) : null,
      allstateBindId: user.allstateBindId?.trim() || null,
    });
  }
  return people;
}
