import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  PlatformRoleOption,
  PlatformUserListResponse,
  PlatformUserRow,
} from '@sfa/shared';
import { FilterQuery, Model, Types } from 'mongoose';
import { Branch, BranchDocument } from '../branches/schemas/branch.schema';
import { escapeRegex } from '../common/mongo/escape-regex';
import { RoleAssignmentsService } from '../permissions/role-assignments.service';
import { UserRole } from '../permissions/schemas/user-role.schema';
import {
  AgencyRole,
  AgencyRoleDocument,
} from '../roles/schemas/agency-role.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { ListPlatformUsersDto } from './dto/list-platform-users.dto';
import { Agency, AgencyDocument } from './schemas/agency.schema';

/** Lean projection of the fields the directory renders. */
type UserLean = Pick<
  User,
  'email' | 'firstName' | 'lastName' | 'isActive' | 'deactivatedAt'
> & {
  _id: Types.ObjectId;
  agencyId?: Types.ObjectId;
  branchId?: Types.ObjectId;
};

/**
 * The cross-agency user directory behind the Super Admin panel's
 * *Find / Impersonate User* screen (PAC-70).
 *
 * ## Why two phases rather than one `$lookup` pipeline
 *
 * `users` carries no agency or role *name* — the agency is an id and roles live
 * in the `userRoles` join — so a search over "agency name" or "role name" has
 * to consult those collections. Rather than one aggregation joining three
 * collections per request, matches are resolved to **ids first** (a handful of
 * small `$in` queries), then a single ordinary `find` + `countDocuments` runs
 * against `users`, then rows are enriched in three batches. That is the same
 * batch-then-map style `RoleAssignmentsService.rolesForUsers` already uses,
 * keeps the paged query index-friendly on `agencyId`, and is far easier to
 * reason about when a filter combination misbehaves.
 *
 * ## Search is a scan, and that is fine
 *
 * Free text is a case-insensitive *contains* regex, which no index can serve.
 * The platform's whole `users` collection is a few hundred rows (one agency is
 * ~15 people), so the scan is cheaper than a text index would be — and a text
 * index would break "partial email" matching, since `$text` is whole-word.
 * Revisit if the directory ever grows past low thousands.
 *
 * ## "Resolved to nothing" is not "no filter"
 *
 * A role filter that matches no role, or a search that matches no agency,
 * must yield an **empty** result — `{ _id: { $in: [] } }` — never collapse
 * into "unfiltered". The DTO already turns an *absent* param into
 * `undefined`; the service keeps that distinction all the way down.
 */
@Injectable()
export class PlatformUsersService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Agency.name)
    private readonly agencyModel: Model<AgencyDocument>,
    @InjectModel(Branch.name)
    private readonly branchModel: Model<BranchDocument>,
    @InjectModel(AgencyRole.name)
    private readonly roleModel: Model<AgencyRoleDocument>,
    @InjectModel(UserRole.name) private readonly userRoleModel: Model<UserRole>,
    private readonly roleAssignments: RoleAssignmentsService,
  ) {}

  async list(query: ListPlatformUsersDto): Promise<PlatformUserListResponse> {
    const { page, pageSize } = query;
    const agencyIds = query.agencyIds?.map((id) => new Types.ObjectId(id));

    // Platform admins are never listed: they are not tenant users, and the
    // impersonate endpoint refuses them anyway. `$ne: true` rather than
    // `false` so a document predating the field's default still matches.
    const filter: FilterQuery<UserDocument> = {
      isPlatformAdmin: { $ne: true },
    };
    if (agencyIds) {
      filter.agencyId = { $in: agencyIds };
    }
    if (query.roleSlugs) {
      filter._id = {
        $in: await this.usersHoldingRoles(
          { slug: { $in: query.roleSlugs } },
          agencyIds,
        ),
      };
    }
    const search = await this.buildSearch(query.q, agencyIds);
    if (search) {
      filter.$or = search;
    }

    const [total, users] = await Promise.all([
      this.userModel.countDocuments(filter),
      this.userModel
        .find(filter)
        // Case-insensitive ordering, so "adams" does not sort after "Zimmer".
        .collation({ locale: 'en', strength: 2 })
        // `email` is unique, so the order is fully deterministic between pages.
        .sort({ lastName: 1, firstName: 1, email: 1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .select(
          'email firstName lastName isActive deactivatedAt agencyId branchId',
        )
        .lean<UserLean[]>(),
    ]);

    return {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      items: await this.toRows(users),
    };
  }

  /**
   * One option per distinct slug across every agency, for the Role filter.
   *
   * Sorted by name *before* grouping so `$first` is deterministic: owners can
   * rename a template role, and the filter should show the same label on
   * every load rather than whichever agency's row Mongo visited first.
   */
  async roleOptions(): Promise<PlatformRoleOption[]> {
    const rows = await this.roleModel.aggregate<{ _id: string; name: string }>([
      { $sort: { name: 1 } },
      { $group: { _id: '$slug', name: { $first: '$name' } } },
      { $sort: { name: 1 } },
    ]);
    return rows.map((row) => ({ slug: row._id, name: row.name }));
  }

  /**
   * The `$or` branches for a free-text query, or `null` for no query.
   *
   * Name and email match on `users` directly. Agency and role names are
   * resolved to ids first; a branch that resolves to nothing is simply left
   * out (an empty `$in` inside `$or` matches nothing anyway, so omitting it
   * only saves Mongo a clause). The name/email branches are always present,
   * so the `$or` is never empty.
   */
  private async buildSearch(
    raw: string | undefined,
    agencyIds: Types.ObjectId[] | undefined,
  ): Promise<FilterQuery<UserDocument>[] | null> {
    const q = (raw ?? '').trim();
    if (!q) return null;

    const escaped = escapeRegex(q);
    const contains = { $regex: escaped, $options: 'i' };
    const branches: FilterQuery<UserDocument>[] = [
      { firstName: contains },
      { lastName: contains },
      // Matches a full "first last" query, which neither single field can.
      {
        $expr: {
          $regexMatch: {
            input: {
              $trim: {
                input: {
                  $concat: [
                    { $ifNull: ['$firstName', ''] },
                    ' ',
                    { $ifNull: ['$lastName', ''] },
                  ],
                },
              },
            },
            regex: escaped,
            options: 'i',
          },
        },
      },
      { email: contains },
    ];

    const agencyFilter: FilterQuery<AgencyDocument> = { name: contains };
    if (agencyIds) {
      agencyFilter._id = { $in: agencyIds };
    }
    const agencies = await this.agencyModel
      .find(agencyFilter)
      .select({ _id: 1 })
      .lean();
    if (agencies.length) {
      branches.push({ agencyId: { $in: agencies.map((a) => a._id) } });
    }

    const byRoleName = await this.usersHoldingRoles(
      { name: contains },
      agencyIds,
    );
    if (byRoleName.length) {
      branches.push({ _id: { $in: byRoleName } });
    }

    return branches;
  }

  /**
   * Ids of every user holding any role matching `roleFilter`.
   *
   * When the caller has narrowed to agencies, both lookups are narrowed too —
   * that keeps `userRoles` on its `{ agencyId, roleId }` index (there is no
   * `roleId`-leading index) and avoids pulling every producer on the platform
   * only to discard most of them at the `users` query.
   */
  private async usersHoldingRoles(
    roleFilter: FilterQuery<AgencyRoleDocument>,
    agencyIds: Types.ObjectId[] | undefined,
  ): Promise<Types.ObjectId[]> {
    const scopedRoleFilter: FilterQuery<AgencyRoleDocument> = { ...roleFilter };
    if (agencyIds) {
      scopedRoleFilter.agencyId = { $in: agencyIds };
    }
    const roles = await this.roleModel
      .find(scopedRoleFilter)
      .select({ _id: 1 })
      .lean();
    if (!roles.length) return [];

    const linkFilter: FilterQuery<UserRole> = {
      roleId: { $in: roles.map((role) => role._id) },
    };
    if (agencyIds) {
      linkFilter.agencyId = { $in: agencyIds };
    }
    const links = await this.userRoleModel
      .find(linkFilter)
      .select({ userId: 1 })
      .lean();

    // A user holding two matching roles appears twice in the join; dedupe so
    // the `$in` is as small as the answer.
    const unique = new Set(links.map((link) => link.userId.toString()));
    return [...unique].map((id) => new Types.ObjectId(id));
  }

  /** Enrich a page of users with agency, branch and role names, in three batches. */
  private async toRows(users: UserLean[]): Promise<PlatformUserRow[]> {
    if (!users.length) return [];

    const agencyIdSet = unique(users.map((user) => user.agencyId));
    const branchIdSet = unique(users.map((user) => user.branchId));
    const [agencies, branches, rolesByUser] = await Promise.all([
      this.agencyModel
        .find({ _id: { $in: agencyIdSet } })
        .select({ name: 1, slug: 1 })
        .lean(),
      this.branchModel
        .find({ _id: { $in: branchIdSet } })
        .select({ name: 1 })
        .lean(),
      this.roleAssignments.rolesForUsers(users.map((user) => user._id)),
    ]);
    const agencyById = new Map(agencies.map((a) => [a._id.toString(), a]));
    const branchById = new Map(branches.map((b) => [b._id.toString(), b]));

    return users.map((user) => {
      const agency = user.agencyId
        ? agencyById.get(user.agencyId.toString())
        : undefined;
      const branch = user.branchId
        ? branchById.get(user.branchId.toString())
        : undefined;
      const name =
        [user.firstName, user.lastName].filter(Boolean).join(' ').trim() ||
        null;
      return {
        id: user._id.toString(),
        name,
        firstName: user.firstName ?? null,
        lastName: user.lastName ?? null,
        email: user.email,
        agency: agency
          ? { id: agency._id.toString(), name: agency.name, slug: agency.slug }
          : null,
        branch: branch
          ? { id: branch._id.toString(), name: branch.name }
          : null,
        roles: (rolesByUser.get(user._id.toString()) ?? []).map((role) => ({
          slug: role.slug,
          name: role.name,
        })),
        isActive: user.isActive,
        deactivatedAt: user.deactivatedAt
          ? new Date(user.deactivatedAt).toISOString()
          : null,
      };
    });
  }
}

/** Distinct, non-null ObjectIds from a list that may contain gaps. */
function unique(ids: (Types.ObjectId | undefined)[]): Types.ObjectId[] {
  const seen = new Map<string, Types.ObjectId>();
  for (const id of ids) {
    if (id) seen.set(id.toString(), id);
  }
  return [...seen.values()];
}
