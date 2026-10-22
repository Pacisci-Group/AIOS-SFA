import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Branch, BranchDocument } from '../branches/schemas/branch.schema';
import { displayNamesFor } from '../common/domain/user-names';
import { LeadSourcesService } from '../lead-sources/lead-sources.service';
import { User, UserDocument } from '../users/schemas/user.schema';

/** Which kind of id a dimension's keys are. */
export type LabelKind = 'user' | 'leadSource' | 'branch' | 'self';

/**
 * Names for the ids a breakdown groups by (PAC-152, part 2) — one batched
 * read per kind, never a `$lookup` per row (the `LeadSourcesService.labelsFor`
 * / `displayNamesFor` idiom).
 *
 * An id with no name — a deleted user, an archived source — is labelled
 * "Unknown …" rather than folded into the null bucket, which would misstate
 * both.
 */
@Injectable()
export class AnalyticsLabelsService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Branch.name)
    private readonly branchModel: Model<BranchDocument>,
    private readonly leadSources: LeadSourcesService,
  ) {}

  async labels(
    agencyId: string,
    kind: LabelKind,
    ids: readonly string[],
  ): Promise<Map<string, string>> {
    const wanted = [...new Set(ids.filter(Boolean))];
    if (kind === 'self' || wanted.length === 0) return new Map();

    if (kind === 'user') {
      return displayNamesFor(
        this.userModel,
        wanted.filter((id) => Types.ObjectId.isValid(id)),
      );
    }
    if (kind === 'leadSource') {
      return this.leadSources.labelsFor(agencyId);
    }
    // `branches` carries an ObjectId `agencyId`, unlike every TenantRecord.
    const rows = await this.branchModel
      .find(
        {
          agencyId: new Types.ObjectId(agencyId),
          _id: {
            $in: wanted
              .filter((id) => Types.ObjectId.isValid(id))
              .map((id) => new Types.ObjectId(id)),
          },
        },
        { name: 1 },
      )
      .lean<{ _id: Types.ObjectId; name: string }[]>();
    return new Map(rows.map((row) => [String(row._id), row.name]));
  }
}

/** What an id with no name is called, per kind. */
export const UNKNOWN_LABEL: Record<LabelKind, string> = {
  user: 'Unknown user',
  leadSource: 'Unknown source',
  branch: 'Unknown branch',
  self: 'Unknown',
};
