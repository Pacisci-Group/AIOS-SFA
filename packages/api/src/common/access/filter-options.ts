import {
  type AccessContext,
  type DataExportOptionsResponse,
  DataScope,
} from '@sfa/shared';
import { FilterQuery, Model, Types } from 'mongoose';
import { displayName } from '../domain/user-names';
import { clientAgencyId } from './client-scope';

/** The role whose holders the producer filter lists — keyed by slug, never name. */
const PRODUCER_ROLE_SLUG = 'producer';

type AnyModel = Model<any>;

export interface FilterOptionsDeps {
  branchModel: AnyModel;
  userModel: AnyModel;
  roleModel: AnyModel;
  /** `RoleAssignmentsService.roleUserIds`, passed in so this stays a helper. */
  roleUserIds: (roleId: Types.ObjectId) => Promise<Types.ObjectId[]>;
}

/**
 * The branches and producers a caller may filter a report by — the Data
 * Export page's options (PAC-152), shared with the Analytics page.
 *
 * Served behind each page's own permission rather than `agency:users:read` /
 * `agency:branches:read`: a Data Team member or a producer granted the page
 * holds neither, and every name listed already appears in what the page shows.
 *
 * Branch and own scope see only what they could report on anyway: their own
 * branch, its producers, and — under own — themselves. A deactivated producer
 * stays listed, marked, because historic rows still carry their name.
 */
export async function filterOptionsFor(
  access: AccessContext,
  deps: FilterOptionsDeps,
): Promise<DataExportOptionsResponse> {
  const agencyId = new Types.ObjectId(clientAgencyId(access));
  const agencyWide = access.dataScope === DataScope.Agency;

  const branchFilter: FilterQuery<unknown> = { agencyId };
  if (!agencyWide) {
    if (!access.branchId) return { branches: [], producers: [] };
    branchFilter._id = new Types.ObjectId(access.branchId);
  }
  const branches = await deps.branchModel
    .find(branchFilter, { name: 1 })
    .sort({ name: 1 })
    .lean<{ _id: Types.ObjectId; name: string }[]>();

  const role = await deps.roleModel
    .findOne({ agencyId, slug: PRODUCER_ROLE_SLUG }, { _id: 1 })
    .lean<{ _id: Types.ObjectId } | null>();
  let producerIds = role ? await deps.roleUserIds(role._id) : [];
  if (access.dataScope === DataScope.Own) {
    producerIds = producerIds.filter((id) => id.toString() === access.userId);
  }

  const userFilter: FilterQuery<unknown> = {
    _id: { $in: producerIds },
    agencyId,
    isPlatformAdmin: { $ne: true },
  };
  if (access.dataScope === DataScope.Branch && access.branchId) {
    userFilter.branchId = new Types.ObjectId(access.branchId);
  }
  const users = producerIds.length
    ? await deps.userModel
        .find(userFilter, { firstName: 1, lastName: 1, email: 1, isActive: 1 })
        .lean<
          {
            _id: Types.ObjectId;
            firstName?: string;
            lastName?: string;
            email: string;
            isActive?: boolean;
          }[]
        >()
    : [];

  return {
    branches: branches.map((branch) => ({
      id: String(branch._id),
      name: branch.name,
    })),
    producers: users
      .map((user) => ({
        id: String(user._id),
        name:
          user.isActive === false
            ? `${displayName(user)} (inactive)`
            : displayName(user),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}
