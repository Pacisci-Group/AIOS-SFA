import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { AccessContext } from '@sfa/shared';
import { Model, Types } from 'mongoose';
import { Branch, BranchDocument } from '../../branches/schemas/branch.schema';

export interface ResolvedTenantContext {
  agencyId: string;
  branchId: string;
}

/**
 * Resolves the `(agencyId, branchId)` pair a tenant record must be written
 * under, for any authenticated write path.
 *
 * Shared because every writer needs the identical rule and they would otherwise
 * drift: `TenantRecord` requires both fields, but an **Agency Owner is
 * agency-scoped and normally carries no `branchId` at all**. Without the
 * default-branch fallback, an owner or manager submitting a perfectly valid
 * form gets an unexplained 403 — and `leads:write` is a permission they hold.
 */
@Injectable()
export class TenantContextResolver {
  constructor(
    @InjectModel(Branch.name)
    private readonly branchModel: Model<BranchDocument>,
  ) {}

  async resolve(
    access: AccessContext,
    branchIdHeader: string | null,
  ): Promise<ResolvedTenantContext> {
    // A platform super admin has no agency of their own, so there is no tenant
    // to file the record under. An explicit 403 beats writing a record with a
    // null agencyId that no read path would ever return.
    if (!access.agencyId) {
      throw new ForbiddenException(
        'This action requires an agency-scoped user.',
      );
    }

    const branchId =
      branchIdHeader ??
      access.branchId ??
      (await this.findDefaultBranchId(access.agencyId));

    if (!branchId) {
      throw new ForbiddenException(
        'This action requires a branch; this agency has no default branch.',
      );
    }

    return { agencyId: access.agencyId, branchId };
  }

  private async findDefaultBranchId(agencyId: string): Promise<string | null> {
    if (!Types.ObjectId.isValid(agencyId)) return null;
    const branch = await this.branchModel
      .findOne({ agencyId: new Types.ObjectId(agencyId), isDefault: true })
      .select('_id');
    return branch?._id.toString() ?? null;
  }
}
