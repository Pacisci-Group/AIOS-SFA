import { Types, type FilterQuery, type Model } from 'mongoose';
import type { AgencyRoleDocument } from '../roles/schemas/agency-role.schema';
import type { UserDocument } from '../users/schemas/user.schema';
import type { UserRole } from './schemas/user-role.schema';

/**
 * "Who in this agency can be handed X" — the people holding a role with one
 * of a few slugs. The ticket picker asks it for CSRs and CRMs; Dash
 * Reconciliation for Producers and CSRs.
 *
 * Models in, no DI (the `common/access/filter-options.ts` pattern), so each
 * caller passes the models its module already registers. Read only:
 * `RoleAssignmentsService` stays the sole writer of `userRoles`.
 */
export interface RoleHolderModels {
  roleModel: Model<AgencyRoleDocument>;
  userRoleModel: Model<UserRole>;
  userModel: Model<UserDocument>;
}

export interface RoleHolder {
  _id: Types.ObjectId;
  firstName?: string;
  lastName?: string;
  email: string;
  /** Which of the asked-for slugs this person holds. */
  roles: string[];
}

/**
 * The agency's **active** users holding a role with one of `slugs`, by first
 * then last name. Active means `isActive` is not false, which leaves out both
 * a pending invite and a deactivated account; platform admins never count.
 *
 * `where` narrows the users further — a branch, or the one person a write
 * names — and can never widen the agency clamp.
 */
export async function activeRoleHolders(
  models: RoleHolderModels,
  agencyId: string,
  slugs: readonly string[],
  where: FilterQuery<UserDocument> = {},
): Promise<RoleHolder[]> {
  // `roles.agencyId` and `users.agencyId` are ObjectIds, unlike TenantRecord.
  const agencyOid = new Types.ObjectId(agencyId);
  const roles = await models.roleModel
    .find({ agencyId: agencyOid, slug: { $in: [...slugs] } })
    .select('slug')
    .lean();
  if (!roles.length) return [];
  const slugById = new Map(roles.map((role) => [String(role._id), role.slug]));

  // Who holds one of those roles, from the join. `user.roleIds` is gone —
  // the assignment lives in `userRoles` so a role can be queried from either
  // side, which is what cache invalidation needs.
  const links = await models.userRoleModel
    .find({ roleId: { $in: roles.map((role) => role._id) } })
    .select({ userId: 1, roleId: 1 })
    .lean();
  if (!links.length) return [];
  const slugsByUser = new Map<string, string[]>();
  for (const link of links) {
    const slug = slugById.get(String(link.roleId));
    if (!slug) continue;
    const key = String(link.userId);
    slugsByUser.set(key, [...(slugsByUser.get(key) ?? []), slug]);
  }

  const holders: FilterQuery<UserDocument> = {
    agencyId: agencyOid,
    isPlatformAdmin: { $ne: true },
    isActive: { $ne: false },
    _id: { $in: [...slugsByUser.keys()].map((id) => new Types.ObjectId(id)) },
  };
  const users = await models.userModel
    .find(Object.keys(where).length ? { $and: [holders, where] } : holders)
    .select('firstName lastName email')
    .sort({ firstName: 1, lastName: 1 })
    .lean<Omit<RoleHolder, 'roles'>[]>();
  return users.map((user) => ({
    ...user,
    roles: slugsByUser.get(String(user._id)) ?? [],
  }));
}
