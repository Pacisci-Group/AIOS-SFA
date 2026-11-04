import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { EmployeeProfileStatus } from '@sfa/shared';
import { Model, Types } from 'mongoose';
import {
  EmployeeProfile,
  type EmployeeProfileDocument,
} from '../../hr/schemas/employee-profile.schema';
import { User } from '../../users/schemas/user.schema';
import {
  assertDateOfBirth,
  assertHireBeforeTermination,
  assertHireDate,
} from './employee-profile.rules';

/** A lean read of a profile. `.lean()` applies no defaults; readers null-guard. */
export interface ProfileLean {
  _id: Types.ObjectId;
  agencyId: string;
  userId: Types.ObjectId;
  status: EmployeeProfileStatus;
  hireDate: string | null;
  terminationDate: string | null;
  dateOfBirth: string | null;
  showBirthday?: boolean;
  onboarding?: {
    completedAt?: Date | null;
    completedBy?: Types.ObjectId | null;
  };
  createdAt?: Date;
  updatedAt?: Date;
}

/** The HR facts an admin may write. `null` clears; absent leaves alone. */
export interface ProfileFacts {
  hireDate?: string | null;
  dateOfBirth?: string | null;
  showBirthday?: boolean;
}

const ONBOARDING_RESET = { completedAt: null, completedBy: null };

/**
 * Employee profiles (PAC-162) — the per-person HR record, in `common/` so
 * `HireDatesService` (the accrual job's seam) and later worker jobs may read
 * it. The HTTP shapes live with the users and HR controllers.
 *
 * ## The five seams a profile comes to exist through
 *
 * - {@link ensureProfile} — `UsersService.createPendingUser` (the invite
 *   dialog and Onboard Agency's owner invite).
 * - {@link ensureProfilesForAgency} — the SmartSuite migration's Users step,
 *   the demo seed, and (copied in) the `employee_profiles` migration file.
 * - {@link deleteProfile} — a revoked invite, whose user row is hard-deleted.
 * - {@link terminate} — a removed employee.
 * - {@link reopen} — a reactivated one, back to pending.
 *
 * Nothing else creates or deletes one; `AuthService.acceptInvite` touches
 * nothing because the profile already exists.
 */
@Injectable()
export class EmployeeProfilesService {
  constructor(
    @InjectModel(EmployeeProfile.name)
    private readonly profiles: Model<EmployeeProfileDocument>,
    @InjectModel(User.name) private readonly users: Model<User>,
  ) {}

  // ── Reads ────────────────────────────────────────────────────────────

  profileFor(
    agencyId: string,
    userId: string | Types.ObjectId,
  ): Promise<ProfileLean | null> {
    return this.profiles
      .findOne({ agencyId, userId: new Types.ObjectId(String(userId)) })
      .lean<ProfileLean | null>();
  }

  /** Profiles keyed by user id; a person without one is absent. */
  async profilesFor(
    agencyId: string,
    userIds: readonly Types.ObjectId[],
  ): Promise<Map<string, ProfileLean>> {
    if (!userIds.length) return new Map();
    const rows = await this.profiles
      .find({ agencyId, userId: { $in: [...userIds] } })
      .lean<ProfileLean[]>();
    return new Map(rows.map((row) => [row.userId.toString(), row]));
  }

  /** The people whose onboarding is complete — the list's status facet. */
  async activeUserIds(agencyId: string): Promise<Types.ObjectId[]> {
    const rows = await this.profiles
      .find({ agencyId, status: 'active' })
      .select('userId')
      .lean<{ userId: Types.ObjectId }[]>();
    return rows.map((row) => row.userId);
  }

  /**
   * `YYYY-MM-DD` per user id, `null` while unset — what the accrual job's
   * anniversary reset and the request rules' waiting period read. Every id
   * asked for is present.
   */
  async hireDates(
    agencyId: string,
    userIds: readonly Types.ObjectId[],
  ): Promise<Map<string, string | null>> {
    const profiles = await this.profilesFor(agencyId, userIds);
    return new Map(
      userIds.map((id) => [
        id.toString(),
        profiles.get(id.toString())?.hireDate ?? null,
      ]),
    );
  }

  // ── Existence ────────────────────────────────────────────────────────

  /** A pending profile for a brand-new user; a no-op when one exists. */
  async ensureProfile(
    agencyId: string,
    userId: string | Types.ObjectId,
  ): Promise<void> {
    await this.profiles.updateOne(
      { agencyId, userId: new Types.ObjectId(String(userId)) },
      {
        $setOnInsert: {
          status: 'pending',
          hireDate: null,
          terminationDate: null,
          dateOfBirth: null,
          showBirthday: true,
          onboarding: ONBOARDING_RESET,
        },
      },
      { upsert: true },
    );
  }

  /**
   * A profile for every user of the agency without one: `pending` for the
   * active and the invited, `terminated` (dated `today`) for the removed —
   * so a later reactivation finds a row. Platform admins are not an
   * agency's people. Returns how many were created.
   */
  async ensureProfilesForAgency(
    agencyId: string,
    today: string,
  ): Promise<number> {
    const users = await this.users
      .find({
        agencyId: new Types.ObjectId(agencyId),
        isPlatformAdmin: { $ne: true },
      })
      .select('_id deactivatedAt')
      .lean<{ _id: Types.ObjectId; deactivatedAt?: Date | null }[]>();
    if (!users.length) return 0;
    const existing = await this.profilesFor(
      agencyId,
      users.map((user) => user._id),
    );
    const missing = users.filter((user) => !existing.has(user._id.toString()));
    if (!missing.length) return 0;
    await this.profiles.insertMany(
      missing.map((user) => ({
        agencyId,
        userId: user._id,
        status: user.deactivatedAt ? 'terminated' : 'pending',
        hireDate: null,
        terminationDate: user.deactivatedAt ? today : null,
        dateOfBirth: null,
        showBirthday: true,
        onboarding: ONBOARDING_RESET,
      })),
    );
    return missing.length;
  }

  /** With a revoked invite's user row. The only delete. */
  async deleteProfile(
    agencyId: string,
    userId: string | Types.ObjectId,
  ): Promise<void> {
    await this.profiles.deleteOne({
      agencyId,
      userId: new Types.ObjectId(String(userId)),
    });
  }

  // ── Status ───────────────────────────────────────────────────────────

  /** The person was removed from the agency on `today` (agency calendar). */
  async terminate(
    agencyId: string,
    userId: string | Types.ObjectId,
    today: string,
  ): Promise<void> {
    await this.ensureProfile(agencyId, userId);
    await this.profiles.updateOne(
      { agencyId, userId: new Types.ObjectId(String(userId)) },
      { $set: { status: 'terminated', terminationDate: today } },
    );
  }

  /**
   * The person was reactivated: back to pending. Re-joining is an
   * onboarding — HR confirms the hire date again, and Complete clears the
   * termination date, which stays visible until then.
   */
  async reopen(
    agencyId: string,
    userId: string | Types.ObjectId,
  ): Promise<void> {
    await this.ensureProfile(agencyId, userId);
    await this.profiles.updateOne(
      { agencyId, userId: new Types.ObjectId(String(userId)) },
      { $set: { status: 'pending', onboarding: ONBOARDING_RESET } },
    );
  }

  // ── HR writes ────────────────────────────────────────────────────────

  /**
   * Edit the facts. `today` is the agency's calendar day the bounds are
   * judged on. Clearing the hire date is allowed only while pending: an
   * active employee has one by definition.
   */
  async updateFacts(
    agencyId: string,
    userId: string | Types.ObjectId,
    facts: ProfileFacts,
    today: string,
  ): Promise<ProfileLean> {
    const profile = await this.requireProfile(agencyId, userId);
    const $set: Record<string, unknown> = {};

    if (facts.hireDate !== undefined) {
      if (facts.hireDate === null) {
        if (profile.status === 'active') {
          throw new BadRequestException(
            'An active employee has a hire date. Set a different one instead.',
          );
        }
      } else {
        assertHireDate(facts.hireDate, today);
        assertHireBeforeTermination(facts.hireDate, profile.terminationDate);
      }
      $set.hireDate = facts.hireDate;
    }
    if (facts.dateOfBirth !== undefined) {
      if (facts.dateOfBirth !== null) {
        assertDateOfBirth(facts.dateOfBirth, today);
      }
      $set.dateOfBirth = facts.dateOfBirth;
    }
    if (facts.showBirthday !== undefined)
      $set.showBirthday = facts.showBirthday;

    if (Object.keys($set).length) {
      await this.profiles.updateOne({ _id: profile._id }, { $set });
    }
    return this.requireProfile(agencyId, userId);
  }

  /**
   * Pending → active. The hire date is required (and bounded as above);
   * the other facts are optional and written the same way. 409 when
   * already active, 409 for a removed person (reactivate first).
   */
  async completeOnboarding(
    agencyId: string,
    userId: string | Types.ObjectId,
    facts: ProfileFacts & { hireDate: string },
    actorId: string | null,
    today: string,
  ): Promise<ProfileLean> {
    const profile = await this.requireProfile(agencyId, userId);
    if (profile.status === 'active') {
      throw new ConflictException('Onboarding is already complete.');
    }
    if (profile.status === 'terminated') {
      throw new ConflictException(
        'That person has been removed from the agency. Reactivate them first.',
      );
    }
    assertHireDate(facts.hireDate, today);
    if (facts.dateOfBirth) assertDateOfBirth(facts.dateOfBirth, today);

    const $set: Record<string, unknown> = {
      status: 'active',
      hireDate: facts.hireDate,
      terminationDate: null,
      onboarding: {
        completedAt: new Date(),
        completedBy:
          actorId && Types.ObjectId.isValid(actorId)
            ? new Types.ObjectId(actorId)
            : null,
      },
    };
    if (facts.dateOfBirth !== undefined) $set.dateOfBirth = facts.dateOfBirth;
    if (facts.showBirthday !== undefined)
      $set.showBirthday = facts.showBirthday;

    await this.profiles.updateOne({ _id: profile._id }, { $set });
    return this.requireProfile(agencyId, userId);
  }

  /**
   * The profile for an HR write. A user row that predates the seams (a test
   * fixture, a database the migration has not reached) gets its pending row
   * here rather than a 404 — the write is the HR admin saying the person
   * exists.
   */
  private async requireProfile(
    agencyId: string,
    userId: string | Types.ObjectId,
  ): Promise<ProfileLean> {
    await this.ensureProfile(agencyId, userId);
    const profile = await this.profileFor(agencyId, userId);
    if (!profile) throw new NotFoundException('Employee profile not found');
    return profile;
  }
}
