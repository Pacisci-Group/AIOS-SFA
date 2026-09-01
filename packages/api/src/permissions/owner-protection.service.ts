import {
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AgencyRole } from '../roles/schemas/agency-role.schema';
import { UserRole } from './schemas/user-role.schema';

/** The system role slug that owns an agency. */
export const AGENCY_OWNER_SLUG = 'agency_owner';

/**
 * Who is performing the action. A subset of `AccessContext`, so a caller can
 * pass `request.access` straight in.
 */
export interface ActingUser {
  userId: string;
  isPlatformAdmin: boolean;
}

/**
 * The rules protecting agency owners from each other.
 *
 * Two different failure modes are being prevented, and they warrant different
 * answers:
 *
 * - **Policy** — one owner quietly demoting another during a disagreement.
 *   Blocked outright with a 403. Removing an owner is a support operation.
 * - **Integrity** — an agency ending up with no owner at all. That is a 409,
 *   and it fires even for self-demotion, because the recovery needs a platform
 *   admin and a database edit.
 *
 * The platform super admin is exempt from the policy rules. It is deliberately
 * *not* exempt from the integrity rule by default; see
 * {@link assertOwnerRemains}.
 *
 * ⚠ Owner counts only consider `isActive` users. An invited-but-not-accepted
 * owner cannot log in, so they must not satisfy "there is still an owner" — the
 * agency would be just as locked out.
 */
@Injectable()
export class OwnerProtectionService {
  constructor(
    @InjectModel(AgencyRole.name)
    private readonly roleModel: Model<AgencyRole>,
    @InjectModel(UserRole.name)
    private readonly userRoleModel: Model<UserRole>,
  ) {}

  /** The agency's owner role, or null if it has none (nothing to protect). */
  async ownerRoleId(agencyId: string): Promise<Types.ObjectId | null> {
    const role = await this.roleModel
      .findOne({
        agencyId: new Types.ObjectId(agencyId),
        slug: AGENCY_OWNER_SLUG,
      })
      .select('_id')
      .lean();
    return role?._id ?? null;
  }

  async isOwner(agencyId: string, userId: string): Promise<boolean> {
    const roleId = await this.ownerRoleId(agencyId);
    if (!roleId) return false;
    const held = await this.userRoleModel.exists({
      userId: new Types.ObjectId(userId),
      roleId,
    });
    return held !== null;
  }

  /**
   * Active owners of the agency, optionally ignoring one user — the one whose
   * removal or demotion is being considered.
   */
  async countActiveOwners(
    agencyId: string,
    excludeUserId?: string,
  ): Promise<number> {
    const roleId = await this.ownerRoleId(agencyId);
    if (!roleId) return 0;

    const holders = await this.userRoleModel
      .find({ agencyId: new Types.ObjectId(agencyId), roleId })
      .select('userId')
      .lean();

    const excluded = excludeUserId ? new Types.ObjectId(excludeUserId) : null;
    const candidates = holders
      .map((row) => row.userId)
      .filter((id) => !excluded || !id.equals(excluded));
    if (candidates.length === 0) return 0;

    // Counted through `users` rather than `userRoles` because an invited owner
    // has a row here but cannot log in.
    return this.userRoleModel.db
      .collection('users')
      .countDocuments({ _id: { $in: candidates }, isActive: true });
  }

  /**
   * Rule (a) + (d): only a platform admin may take the owner role off someone
   * else. An owner may still give up their own — subject to
   * {@link assertOwnerRemains}.
   *
   * Adding the owner role is always allowed; that is how a second owner comes
   * to exist in the first place.
   */
  async assertMayChangeOwnerRole(
    actor: ActingUser,
    agencyId: string,
    targetUserId: string,
    nextRoleIds: string[],
  ): Promise<void> {
    if (actor.isPlatformAdmin) return;

    const ownerRoleId = await this.ownerRoleId(agencyId);
    if (!ownerRoleId) return;

    const targetIsOwner = await this.isOwner(agencyId, targetUserId);
    if (!targetIsOwner) return;

    const keepsOwnerRole = nextRoleIds.some(
      (id) => id === ownerRoleId.toString(),
    );
    if (keepsOwnerRole) return;

    if (actor.userId !== targetUserId) {
      throw new ForbiddenException(
        'Only an agency owner can give up their own owner role. Ask a platform administrator to remove someone else’s.',
      );
    }

    await this.assertOwnerRemains(agencyId, targetUserId);
  }

  /**
   * Rule (b) + (d): an owner cannot be deactivated, deleted, or have a pending
   * invite revoked by anyone but a platform admin.
   */
  async assertMayDeactivate(
    actor: ActingUser,
    agencyId: string,
    targetUserId: string,
  ): Promise<void> {
    const targetIsOwner = await this.isOwner(agencyId, targetUserId);
    if (!targetIsOwner) return;

    if (!actor.isPlatformAdmin && actor.userId !== targetUserId) {
      throw new ForbiddenException(
        'Agency owners can only be removed by a platform administrator.',
      );
    }

    await this.assertOwnerRemains(agencyId, targetUserId);
  }

  /**
   * Rule (c): never leave the agency with nobody who can administer it.
   *
   * Unlike the two rules above this is **not** waived for a platform admin.
   * Stranding a tenant with no owner is recovered by hand, and a super admin
   * doing it by mis-click is exactly as expensive as an owner doing it. A
   * deliberate override belongs behind an explicit flag, not behind a role.
   */
  async assertOwnerRemains(
    agencyId: string,
    removingUserId: string,
  ): Promise<void> {
    const remaining = await this.countActiveOwners(agencyId, removingUserId);
    if (remaining === 0) {
      throw new ConflictException(
        'This is the agency’s only owner. Assign the owner role to someone else first.',
      );
    }
  }

  /**
   * Rule (c) applied to the role itself: deleting the owner role would remove
   * everyone's ownership at once.
   */
  async assertRoleIsDeletable(agencyId: string, roleId: string): Promise<void> {
    const ownerRoleId = await this.ownerRoleId(agencyId);
    if (ownerRoleId && ownerRoleId.toString() === roleId) {
      throw new ConflictException(
        'The agency owner role cannot be deleted — the agency would have nobody able to administer it.',
      );
    }
  }
}
