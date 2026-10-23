import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  diffRules,
  overridePaths,
  scheduleFromWorkweek,
  weeklyMinutes,
  type ActivateEmployeeInput,
  type DeepPartial,
  type EffectiveLeaveRules,
  type EffectiveScheduleView,
  type EmployeeProfileEventKind,
  type EmployeeProfileStatus,
  type LeaveAllocations,
  type LeavePolicyRules,
  type SetEmployeeAssignmentInput,
  type TerminateEmployeeInput,
  type UpdateEmployeeFactsInput,
  type UpdateMyHrProfileInput,
  type WorkSchedule,
} from '@sfa/shared';
import { Model, Types } from 'mongoose';
import {
  EmployeeProfile,
  type EmployeeProfileDocument,
} from '../../hr/schemas/employee-profile.schema';
import {
  EmployeeProfileEvent,
  type EmployeeProfileEventDocument,
} from '../../hr/schemas/employee-profile-event.schema';
import {
  LeavePolicy,
  type LeavePolicyDocument,
} from '../../hr/schemas/leave-policy.schema';
import {
  WorkScheduleTemplate,
  type WorkScheduleTemplateDocument,
} from '../../hr/schemas/work-schedule-template.schema';
import { User } from '../../users/schemas/user.schema';
import { WorkingDaysService } from '../working-days/working-days.service';
import {
  diffProfileSnapshots,
  type ProfileDisplaySnapshot,
} from './employee-profile.changes';
import {
  assertDateOfBirth,
  assertDayNotBefore,
  assertDayNotInFuture,
  assertEffectiveFrom,
  assertIsoDay,
  assertMonthDay,
  effectiveAllocations,
  monthDayOf,
  validateAllocations,
  validateSchedule,
} from './employee-profile.rules';
import { mergeRules } from './leave-policy.merge';
import { LeavePolicyService } from './leave-policy.service';
import { validateLeavePolicyRules } from './leave-policy.validate';

export interface AssignmentLean {
  effectiveFrom: string;
  leavePolicyId: Types.ObjectId;
  overrides: DeepPartial<LeavePolicyRules>;
  scheduleTemplateId: Types.ObjectId | null;
  scheduleOverride: WorkSchedule | null;
  allocations: LeaveAllocations;
  actorId: Types.ObjectId | null;
  reason: string | null;
  recordedAt: Date;
}

/** A lean read of a profile. `.lean()` applies no defaults; readers null-guard. */
export interface ProfileLean {
  _id: Types.ObjectId;
  agencyId: string;
  userId: Types.ObjectId;
  status: EmployeeProfileStatus;
  hireDate: string | null;
  workAnniversary: string | null;
  terminationDate: string | null;
  dateOfBirth: string | null;
  showBirthday?: boolean;
  leavePolicyId: Types.ObjectId | null;
  overrides?: DeepPartial<LeavePolicyRules>;
  scheduleTemplateId: Types.ObjectId | null;
  scheduleOverride?: WorkSchedule | null;
  allocations?: LeaveAllocations;
  assignments?: AssignmentLean[];
  createdAt?: Date;
  updatedAt?: Date;
}

/** What `ensureProfile` needs to create an **active** profile at invite time. */
export interface ActiveProfileInit {
  leavePolicyId: string;
  /** `YYYY-MM-DD`, not after `today`. */
  hireDate: string;
  today: string;
  actorId: string | null;
}

type PolicyLean = {
  _id: Types.ObjectId;
  name: string;
  status: 'active' | 'archived';
  version: number;
  rules: LeavePolicyRules;
};

type TemplateLean = {
  _id: Types.ObjectId;
  name: string;
  status: 'active' | 'archived';
  schedule: WorkSchedule;
};

/** The five rule-shaped fields, validated and normalised, ready to store. */
interface PreparedAssignment {
  leavePolicyId: Types.ObjectId;
  overrides: DeepPartial<LeavePolicyRules>;
  scheduleTemplateId: Types.ObjectId | null;
  scheduleOverride: WorkSchedule | null;
  allocations: LeaveAllocations;
  policy: PolicyLean;
}

const REMOVAL_REASON = 'Removed from the agency';

/**
 * The last entry in force on `day` — the latest `effectiveFrom <= day`. The
 * first entry for a day before any of them (history is only as old as the
 * record), `null` for a profile with no history (pending).
 *
 * Entries are appended with a non-decreasing `effectiveFrom`
 * (`assertEffectiveFrom`), so "the last one that qualifies" is the later of
 * two same-day corrections.
 */
export function assignmentAsOf<T extends { effectiveFrom: string }>(
  assignments: readonly T[],
  day: string,
): T | null {
  let found: T | null = null;
  for (const entry of assignments) {
    if (entry.effectiveFrom <= day) found = entry;
  }
  return found ?? assignments[0] ?? null;
}

/**
 * Employee profiles (PAC-162) — the per-person record every HR engine keys
 * on. In `common/` so PAC-165 / PAC-167 worker jobs may import it; the HTTP
 * shapes, joins and lists live in `hr/employee-profiles.service.ts`.
 *
 * - {@link ensureProfile} / {@link ensureProfilesForAgency} — the two ways a
 *   profile comes to exist: at user creation, and as a catch-up for every
 *   user without one (migration, module enable, SmartSuite import, seed).
 * - {@link effectiveRulesFor} — template + the person's overrides **as of a
 *   day**, through the assignment history; what the engines call instead of
 *   `LeavePolicyService.effectiveRules` directly.
 * - {@link activate} / {@link setAssignment} / {@link updateFacts} /
 *   {@link terminate} — the admin writes, every one of which appends history
 *   where rules changed and records a before/after event.
 */
@Injectable()
export class EmployeeProfilesService {
  private readonly logger = new Logger(EmployeeProfilesService.name);

  constructor(
    @InjectModel(EmployeeProfile.name)
    private readonly profiles: Model<EmployeeProfileDocument>,
    @InjectModel(EmployeeProfileEvent.name)
    private readonly events: Model<EmployeeProfileEventDocument>,
    @InjectModel(WorkScheduleTemplate.name)
    private readonly templates: Model<WorkScheduleTemplateDocument>,
    @InjectModel(LeavePolicy.name)
    private readonly policies: Model<LeavePolicyDocument>,
    @InjectModel(User.name) private readonly users: Model<User>,
    private readonly workingDays: WorkingDaysService,
    private readonly leavePolicies: LeavePolicyService,
  ) {}

  // ── Reads ────────────────────────────────────────────────────────────────

  profileFor(
    agencyId: string,
    userId: string | Types.ObjectId,
  ): Promise<ProfileLean | null> {
    return this.profiles
      .findOne({ agencyId, userId: new Types.ObjectId(String(userId)) })
      .lean<ProfileLean | null>();
  }

  async requireProfile(
    agencyId: string,
    userId: string | Types.ObjectId,
  ): Promise<ProfileLean> {
    const profile = await this.profileFor(agencyId, userId);
    if (!profile) throw new NotFoundException('Employee profile not found');
    return profile;
  }

  /**
   * Template + overrides as of `asOfDay` (`YYYY-MM-DD`, an agency day), or
   * the current assignment when omitted. 404 with no profile; 409 while the
   * profile is pending — no policy, no rules, and PAC-165 turns that into
   * "not onboarded yet". A terminated profile *does* resolve: its history
   * must stay readable, and the termination date is PAC-165's rule.
   */
  async effectiveRulesFor(
    agencyId: string,
    userId: string | Types.ObjectId,
    asOfDay?: string,
  ): Promise<EffectiveLeaveRules> {
    const profile = await this.requireProfile(agencyId, userId);
    const assignment = this.assignmentFor(profile, asOfDay);
    if (!assignment) {
      throw new ConflictException(
        'This employee has not been onboarded to HR yet.',
      );
    }
    return this.leavePolicies.effectiveRules(agencyId, {
      leavePolicyId: assignment.leavePolicyId,
      overrides: assignment.overrides,
    });
  }

  /** Override → template → the agency workweek at 09:00–17:00. */
  async effectiveScheduleFor(
    agencyId: string,
    assignment: {
      scheduleTemplateId: Types.ObjectId | null;
      scheduleOverride?: WorkSchedule | null;
    } | null,
  ): Promise<EffectiveScheduleView> {
    const override = assignment?.scheduleOverride ?? null;
    const template = assignment?.scheduleTemplateId
      ? await this.templates
          .findOne({ _id: assignment.scheduleTemplateId, agencyId })
          .select('name schedule status')
          .lean<TemplateLean | null>()
      : null;
    let effective: WorkSchedule;
    let source: EffectiveScheduleView['source'];
    if (override) {
      effective = override;
      source = 'override';
    } else if (template) {
      effective = template.schedule;
      source = 'template';
    } else {
      const settings = await this.workingDays.settings(agencyId);
      effective = scheduleFromWorkweek(settings.workweek);
      source = 'workweek';
    }
    return {
      templateId: template?._id.toHexString() ?? null,
      templateName: template?.name ?? null,
      override,
      effective,
      source,
      weeklyMinutes: weeklyMinutes(effective),
    };
  }

  /** The assignment in force on `asOfDay`, or the current one. */
  assignmentFor(
    profile: ProfileLean,
    asOfDay?: string,
  ): AssignmentLean | null {
    const history = profile.assignments ?? [];
    if (asOfDay !== undefined) return assignmentAsOf(history, asOfDay);
    return history.length ? history[history.length - 1] : null;
  }

  /** Non-terminated profiles on the policy — what blocks an archive. */
  employeesOnPolicy(
    agencyId: string,
    policyId: Types.ObjectId | string,
  ): Promise<number> {
    return this.profiles.countDocuments({
      agencyId,
      leavePolicyId: new Types.ObjectId(String(policyId)),
      status: { $ne: 'terminated' },
    });
  }

  employeesOnScheduleTemplate(
    agencyId: string,
    templateId: Types.ObjectId | string,
  ): Promise<number> {
    return this.profiles.countDocuments({
      agencyId,
      scheduleTemplateId: new Types.ObjectId(String(templateId)),
      status: { $ne: 'terminated' },
    });
  }

  async countsByStatus(
    agencyId: string,
  ): Promise<Record<EmployeeProfileStatus, number>> {
    const rows = await this.profiles.aggregate<{
      _id: EmployeeProfileStatus;
      n: number;
    }>([
      { $match: { agencyId } },
      { $group: { _id: '$status', n: { $sum: 1 } } },
    ]);
    const counts: Record<EmployeeProfileStatus, number> = {
      pending: 0,
      active: 0,
      terminated: 0,
    };
    for (const row of rows) counts[row._id] = row.n;
    return counts;
  }

  /**
   * Month and day of every opted-in, non-terminated employee's birthday —
   * PAC-169's calendar layer. Never the year.
   */
  async birthdaysFor(
    agencyId: string,
  ): Promise<{ userId: string; monthDay: string }[]> {
    const rows = await this.profiles
      .find({
        agencyId,
        status: { $ne: 'terminated' },
        dateOfBirth: { $type: 'string' },
        showBirthday: true,
      })
      .select('userId dateOfBirth')
      .lean<{ userId: Types.ObjectId; dateOfBirth: string }[]>();
    return rows.map((row) => ({
      userId: row.userId.toHexString(),
      monthDay: monthDayOf(row.dateOfBirth),
    }));
  }

  // ── Creation ─────────────────────────────────────────────────────────────

  /**
   * Find-or-create. With `init`, the profile is **active** on the chosen
   * policy with the template's defaults (an invite with a policy); without,
   * it is **pending** and waits on the Onboardings list.
   */
  async ensureProfile(
    agencyId: string,
    userId: string | Types.ObjectId,
    init?: ActiveProfileInit,
  ): Promise<{ profile: ProfileLean; created: boolean }> {
    const existing = await this.profileFor(agencyId, userId);
    if (existing) return { profile: existing, created: false };

    const userObjectId = new Types.ObjectId(String(userId));
    let fields: Partial<EmployeeProfile>;
    let kind: EmployeeProfileEventKind;
    let actorId: Types.ObjectId | null = null;
    if (init) {
      assertIsoDay('Hire date', init.hireDate);
      assertDayNotInFuture('Hire date', init.hireDate, init.today);
      const policy = await this.activePolicy(agencyId, init.leavePolicyId);
      actorId = toObjectId(init.actorId);
      fields = {
        status: 'active',
        hireDate: init.hireDate,
        workAnniversary: monthDayOf(init.hireDate),
        leavePolicyId: policy._id,
        overrides: {},
        scheduleTemplateId: null,
        scheduleOverride: null,
        allocations: {},
        assignments: [
          {
            effectiveFrom: init.hireDate,
            leavePolicyId: policy._id,
            overrides: {},
            scheduleTemplateId: null,
            scheduleOverride: null,
            allocations: {},
            actorId,
            reason: 'Invited with a leave policy',
            recordedAt: new Date(),
          },
        ],
      };
      kind = 'activated';
    } else {
      fields = { status: 'pending' };
      kind = 'created';
    }

    try {
      const doc = await this.profiles.create({
        agencyId,
        userId: userObjectId,
        ...fields,
      });
      const profile = doc.toObject() as unknown as ProfileLean;
      await this.recordEvent(profile, kind, actorId, null, profile, null);
      return { profile, created: true };
    } catch (err) {
      // Two requests racing on the unique index: the other one won.
      if (isDuplicateKey(err)) {
        const profile = await this.requireProfile(agencyId, userId);
        return { profile, created: false };
      }
      throw err;
    }
  }

  /**
   * A pending profile for every non-deactivated, non-platform user of the
   * agency without one. Idempotent; the unique index is the backstop.
   * Nothing is notified — this is a catch-up, not an invite.
   */
  async ensureProfilesForAgency(
    agencyId: string | Types.ObjectId,
  ): Promise<number> {
    const agencyKey = String(agencyId);
    const [users, existing] = await Promise.all([
      this.users
        .find({
          agencyId: new Types.ObjectId(agencyKey),
          isPlatformAdmin: { $ne: true },
          deactivatedAt: null,
        })
        .select('_id')
        .lean<{ _id: Types.ObjectId }[]>(),
      this.profiles
        .find({ agencyId: agencyKey })
        .select('userId')
        .lean<{ userId: Types.ObjectId }[]>(),
    ]);
    const have = new Set(existing.map((row) => row.userId.toHexString()));
    const missing = users.filter((user) => !have.has(user._id.toHexString()));
    if (missing.length === 0) return 0;

    const docs = await this.profiles.insertMany(
      missing.map((user) => ({
        agencyId: agencyKey,
        userId: user._id,
        status: 'pending' as const,
      })),
      { ordered: false },
    );
    const now = new Date();
    await this.events.insertMany(
      docs.map((doc) => ({
        agencyId: agencyKey,
        profileId: doc._id,
        userId: doc.userId,
        at: now,
        actorId: null,
        kind: 'created' as const,
        changes: diffProfileSnapshots(null, this.snapshotFromFields(doc)),
        reason: null,
      })),
    );
    return docs.length;
  }

  // ── Admin writes ─────────────────────────────────────────────────────────

  /**
   * `pending → active`, or `terminated → active` (a rehire: the termination
   * date is cleared, history kept). Everything about the assignment is
   * validated against the chosen policy; the first history entry takes
   * effect from the hire date unless told otherwise.
   */
  async activate(
    agencyId: string,
    userId: string,
    input: ActivateEmployeeInput,
    actorId: string | null,
    today: string,
  ): Promise<ProfileLean> {
    const current = await this.requireProfile(agencyId, userId);
    if (current.status === 'active') {
      throw new ConflictException('This employee is already active.');
    }
    const rehire = current.status === 'terminated';

    assertIsoDay('Hire date', input.hireDate);
    assertDayNotInFuture('Hire date', input.hireDate, today);
    const workAnniversary = input.workAnniversary ?? monthDayOf(input.hireDate);
    assertMonthDay('Work anniversary', workAnniversary);

    const prepared = await this.prepareAssignment(agencyId, input);
    const effectiveFrom = input.effectiveFrom ?? (rehire ? today : input.hireDate);
    assertEffectiveFrom(effectiveFrom, {
      today,
      hireDate: input.hireDate,
      previous: rehire ? this.lastEffectiveFrom(current) : null,
    });

    const actor = toObjectId(actorId);
    const before = await this.snapshotOf(current);
    const entry: AssignmentLean = {
      effectiveFrom,
      leavePolicyId: prepared.leavePolicyId,
      overrides: prepared.overrides,
      scheduleTemplateId: prepared.scheduleTemplateId,
      scheduleOverride: prepared.scheduleOverride,
      allocations: prepared.allocations,
      actorId: actor,
      reason: input.reason?.trim() || null,
      recordedAt: new Date(),
    };
    await this.profiles.updateOne(
      { _id: current._id },
      {
        $set: {
          status: 'active',
          hireDate: input.hireDate,
          workAnniversary,
          terminationDate: null,
          leavePolicyId: prepared.leavePolicyId,
          overrides: prepared.overrides,
          scheduleTemplateId: prepared.scheduleTemplateId,
          scheduleOverride: prepared.scheduleOverride,
          allocations: prepared.allocations,
        },
        $push: { assignments: entry },
      },
    );
    const after = await this.requireProfile(agencyId, userId);
    await this.recordEvent(
      after,
      rehire ? 'rehired' : 'activated',
      actor,
      before,
      after,
      entry.reason,
    );
    return after;
  }

  /** A new history entry on an active profile; the current fields follow it. */
  async setAssignment(
    agencyId: string,
    userId: string,
    input: SetEmployeeAssignmentInput,
    actorId: string | null,
    today: string,
  ): Promise<ProfileLean> {
    const current = await this.requireProfile(agencyId, userId);
    if (current.status !== 'active') {
      throw new ConflictException(
        current.status === 'pending'
          ? 'Activate this employee before changing their rules.'
          : 'This employee is terminated; rehire them to change their rules.',
      );
    }
    const reason = input.reason.trim();
    if (!reason) throw new BadRequestException('Give a reason for the change.');

    const prepared = await this.prepareAssignment(agencyId, input);
    const effectiveFrom = input.effectiveFrom ?? today;
    assertEffectiveFrom(effectiveFrom, {
      today,
      hireDate: current.hireDate,
      previous: this.lastEffectiveFrom(current),
    });

    const actor = toObjectId(actorId);
    const before = await this.snapshotOf(current);
    const entry: AssignmentLean = {
      effectiveFrom,
      leavePolicyId: prepared.leavePolicyId,
      overrides: prepared.overrides,
      scheduleTemplateId: prepared.scheduleTemplateId,
      scheduleOverride: prepared.scheduleOverride,
      allocations: prepared.allocations,
      actorId: actor,
      reason,
      recordedAt: new Date(),
    };
    await this.profiles.updateOne(
      { _id: current._id, status: 'active' },
      {
        $set: {
          leavePolicyId: prepared.leavePolicyId,
          overrides: prepared.overrides,
          scheduleTemplateId: prepared.scheduleTemplateId,
          scheduleOverride: prepared.scheduleOverride,
          allocations: prepared.allocations,
        },
        $push: { assignments: entry },
      },
    );
    const after = await this.requireProfile(agencyId, userId);
    await this.recordEvent(after, 'assignment_changed', actor, before, after, reason);
    return after;
  }

  /** Facts only — never rules. A hire-date move may not orphan the first history entry. */
  async updateFacts(
    agencyId: string,
    userId: string,
    input: UpdateEmployeeFactsInput,
    actorId: string | null,
    today: string,
  ): Promise<ProfileLean> {
    const current = await this.requireProfile(agencyId, userId);
    const set: Record<string, unknown> = {};

    if (input.hireDate !== undefined) {
      assertIsoDay('Hire date', input.hireDate);
      assertDayNotInFuture('Hire date', input.hireDate, today);
      const first = current.assignments?.[0]?.effectiveFrom ?? null;
      if (first && first < input.hireDate) {
        throw new BadRequestException(
          `Hire date cannot be after the first rules entry (${first})`,
        );
      }
      if (current.terminationDate) {
        assertDayNotBefore(
          'Termination date',
          current.terminationDate,
          input.hireDate,
          'the hire date',
        );
      }
      set.hireDate = input.hireDate;
      if (input.workAnniversary === undefined && !current.workAnniversary) {
        set.workAnniversary = monthDayOf(input.hireDate);
      }
    }
    if (input.workAnniversary !== undefined) {
      if (input.workAnniversary !== null) {
        assertMonthDay('Work anniversary', input.workAnniversary);
      }
      set.workAnniversary = input.workAnniversary;
    }
    this.applyBirthday(set, input, today);

    if (Object.keys(set).length === 0) {
      throw new BadRequestException('Nothing to update.');
    }
    const actor = toObjectId(actorId);
    const before = await this.snapshotOf(current);
    await this.profiles.updateOne({ _id: current._id }, { $set: set });
    const after = await this.requireProfile(agencyId, userId);
    await this.recordEvent(after, 'facts_updated', actor, before, after, null);
    return after;
  }

  /** The employee's own two fields. Creates the profile if an older invite predates this ticket. */
  async setBirthday(
    agencyId: string,
    userId: string | Types.ObjectId,
    input: UpdateMyHrProfileInput,
    actorId: string | null,
    today: string,
  ): Promise<ProfileLean> {
    const { profile: current } = await this.ensureProfile(agencyId, userId);
    const set: Record<string, unknown> = {};
    this.applyBirthday(set, input, today);
    if (Object.keys(set).length === 0) return current;

    const actor = toObjectId(actorId);
    const before = await this.snapshotOf(current);
    await this.profiles.updateOne({ _id: current._id }, { $set: set });
    const after = await this.requireProfile(agencyId, userId);
    await this.recordEvent(after, 'birthday_updated', actor, before, after, null);
    return after;
  }

  /**
   * Records the date and flips the status now — the list is honest about who
   * is leaving — while the date itself (which may be in the future) is what
   * PAC-165 bounds a request's dates against.
   */
  async terminate(
    agencyId: string,
    userId: string | Types.ObjectId,
    input: TerminateEmployeeInput,
    actorId: string | null,
  ): Promise<ProfileLean> {
    const current = await this.requireProfile(agencyId, userId);
    if (current.status === 'terminated') {
      throw new ConflictException('This employee is already terminated.');
    }
    assertIsoDay('Termination date', input.terminationDate);
    assertDayNotBefore(
      'Termination date',
      input.terminationDate,
      current.hireDate,
      'the hire date',
    );
    const reason = input.reason.trim();
    if (!reason) throw new BadRequestException('Give a reason.');

    const actor = toObjectId(actorId);
    const before = await this.snapshotOf(current);
    await this.profiles.updateOne(
      { _id: current._id, status: { $ne: 'terminated' } },
      { $set: { status: 'terminated', terminationDate: input.terminationDate } },
    );
    const after = await this.requireProfile(agencyId, userId);
    await this.recordEvent(after, 'terminated', actor, before, after, reason);
    return after;
  }

  /**
   * The removal hook (`UsersService.deactivateUser`): a person leaving the
   * agency leaves HR on the same day. Best-effort — the account is removed
   * either way, and an admin can terminate by hand.
   */
  async terminateForRemoval(
    agencyId: string,
    userId: string | Types.ObjectId,
    actorId: string | null,
    today: string,
  ): Promise<void> {
    try {
      const current = await this.profileFor(agencyId, userId);
      if (!current || current.status === 'terminated') return;
      // A removal on a day before the hire date (invited for next month,
      // removed today) still needs a date: the hire date is the floor.
      const day =
        current.hireDate && current.hireDate > today ? current.hireDate : today;
      await this.terminate(
        agencyId,
        userId,
        { terminationDate: day, reason: REMOVAL_REASON },
        actorId,
      );
    } catch (err) {
      this.logger.warn(
        `Could not terminate the HR profile of ${String(userId)} on removal: ${String(err)}`,
      );
    }
  }

  /**
   * A revoked invite was never a person (`UsersService.revokeInvite` deletes
   * the user row); the profile and its events go with it. The one hard
   * delete here, for the same reason the user row is.
   */
  async deleteForRevokedInvite(
    agencyId: string,
    userId: string | Types.ObjectId,
  ): Promise<void> {
    const profile = await this.profileFor(agencyId, userId);
    if (!profile) return;
    await this.events.deleteMany({ profileId: profile._id });
    await this.profiles.deleteOne({ _id: profile._id });
  }

  // ── Display snapshots (shared with the HTTP service) ─────────────────────

  /** Policy and template names for a profile, resolved once. */
  async namesFor(
    agencyId: string,
    policyIds: (Types.ObjectId | null | undefined)[],
    templateIds: (Types.ObjectId | null | undefined)[],
  ): Promise<{
    policies: Map<string, PolicyLean>;
    templates: Map<string, TemplateLean>;
  }> {
    const policyKeys = [...new Set(policyIds.filter(Boolean).map(String))];
    const templateKeys = [...new Set(templateIds.filter(Boolean).map(String))];
    const [policies, templates] = await Promise.all([
      policyKeys.length
        ? this.policies
            .find({
              agencyId,
              _id: { $in: policyKeys.map((id) => new Types.ObjectId(id)) },
            })
            .select('name status version rules')
            .lean<PolicyLean[]>()
        : Promise.resolve([] as PolicyLean[]),
      templateKeys.length
        ? this.templates
            .find({
              agencyId,
              _id: { $in: templateKeys.map((id) => new Types.ObjectId(id)) },
            })
            .select('name status schedule')
            .lean<TemplateLean[]>()
        : Promise.resolve([] as TemplateLean[]),
    ]);
    return {
      policies: new Map(policies.map((row) => [row._id.toHexString(), row])),
      templates: new Map(templates.map((row) => [row._id.toHexString(), row])),
    };
  }

  async snapshotOf(profile: ProfileLean): Promise<ProfileDisplaySnapshot> {
    const names = await this.namesFor(
      profile.agencyId,
      [profile.leavePolicyId],
      [profile.scheduleTemplateId],
    );
    return this.snapshotFromFields(profile, names);
  }

  private snapshotFromFields(
    profile: {
      status: EmployeeProfileStatus;
      hireDate?: string | null;
      workAnniversary?: string | null;
      terminationDate?: string | null;
      dateOfBirth?: string | null;
      showBirthday?: boolean;
      leavePolicyId?: Types.ObjectId | null;
      overrides?: DeepPartial<LeavePolicyRules>;
      scheduleTemplateId?: Types.ObjectId | null;
      scheduleOverride?: WorkSchedule | null;
      allocations?: LeaveAllocations;
    },
    names?: {
      policies: Map<string, PolicyLean>;
      templates: Map<string, TemplateLean>;
    },
  ): ProfileDisplaySnapshot {
    const policy = profile.leavePolicyId
      ? names?.policies.get(profile.leavePolicyId.toHexString())
      : undefined;
    const template = profile.scheduleTemplateId
      ? names?.templates.get(profile.scheduleTemplateId.toHexString())
      : undefined;
    return {
      status: profile.status,
      hireDate: profile.hireDate ?? null,
      workAnniversary: profile.workAnniversary ?? null,
      terminationDate: profile.terminationDate ?? null,
      dateOfBirth: profile.dateOfBirth ?? null,
      showBirthday: profile.showBirthday ?? true,
      leavePolicyName: policy?.name ?? null,
      overriddenPaths: overridePaths(profile.overrides),
      scheduleTemplateName: template?.name ?? null,
      scheduleOverride: profile.scheduleOverride ?? null,
      allocations: profile.allocations ?? {},
    };
  }

  // ── Internals ────────────────────────────────────────────────────────────

  /**
   * Validate and normalise the five rule-shaped fields against the chosen
   * policy: overrides are merged, checked as a whole, and **stripped of every
   * path that equals the template**, so "custom" is never a lie.
   */
  private async prepareAssignment(
    agencyId: string,
    input: {
      leavePolicyId: string;
      overrides?: DeepPartial<LeavePolicyRules>;
      scheduleTemplateId?: string | null;
      scheduleOverride?: WorkSchedule | null;
      allocations?: LeaveAllocations;
    },
  ): Promise<PreparedAssignment> {
    const policy = await this.activePolicy(agencyId, input.leavePolicyId);
    const merged = mergeRules(policy.rules, input.overrides);
    const problems = validateLeavePolicyRules(merged.rules);
    if (problems.length > 0) {
      throw new BadRequestException(problems.join(' '));
    }
    const overrides = diffRules(policy.rules, merged.rules);

    const scheduleOverride = input.scheduleOverride ?? null;
    if (scheduleOverride) {
      const issues = validateSchedule(scheduleOverride);
      if (issues.length > 0) throw new BadRequestException(issues.join(' '));
    }

    let scheduleTemplateId: Types.ObjectId | null = null;
    if (input.scheduleTemplateId) {
      const template = await this.templates
        .exists({
          _id: new Types.ObjectId(input.scheduleTemplateId),
          agencyId,
          status: 'active',
        });
      if (!template) {
        throw new BadRequestException(
          'Schedule template is invalid for this agency',
        );
      }
      scheduleTemplateId = new Types.ObjectId(input.scheduleTemplateId);
    }

    const allocations = input.allocations ?? {};
    const allocationProblems = validateAllocations(allocations, merged.rules);
    if (allocationProblems.length > 0) {
      throw new BadRequestException(allocationProblems.join(' '));
    }

    return {
      leavePolicyId: policy._id,
      overrides,
      scheduleTemplateId,
      scheduleOverride,
      allocations,
      policy,
    };
  }

  private async activePolicy(
    agencyId: string,
    id: string | Types.ObjectId,
  ): Promise<PolicyLean> {
    const key = String(id);
    const policy = Types.ObjectId.isValid(key)
      ? await this.policies
          .findOne({ _id: new Types.ObjectId(key), agencyId, status: 'active' })
          .select('name status version rules')
          .lean<PolicyLean | null>()
      : null;
    if (!policy) {
      throw new BadRequestException('Leave policy is invalid for this agency');
    }
    return policy;
  }

  private lastEffectiveFrom(profile: ProfileLean): string | null {
    const history = profile.assignments ?? [];
    return history.length ? history[history.length - 1].effectiveFrom : null;
  }

  private applyBirthday(
    set: Record<string, unknown>,
    input: UpdateMyHrProfileInput,
    today: string,
  ): void {
    if (input.dateOfBirth !== undefined) {
      if (input.dateOfBirth !== null) {
        assertDateOfBirth(input.dateOfBirth, today);
      }
      set.dateOfBirth = input.dateOfBirth;
    }
    if (input.showBirthday !== undefined) {
      set.showBirthday = input.showBirthday;
    }
  }

  private async recordEvent(
    profile: ProfileLean,
    kind: EmployeeProfileEventKind,
    actorId: Types.ObjectId | null,
    before: ProfileDisplaySnapshot | null,
    after: ProfileLean,
    reason: string | null,
  ): Promise<void> {
    const afterSnapshot = await this.snapshotOf(after);
    await this.events.create({
      agencyId: profile.agencyId,
      profileId: profile._id,
      userId: profile.userId,
      at: new Date(),
      actorId,
      kind,
      changes: diffProfileSnapshots(before, afterSnapshot),
      reason,
    });
  }
}

/** `effectiveAllocations`, re-exported for the HTTP side's views. */
export { effectiveAllocations };

function toObjectId(id: string | null | undefined): Types.ObjectId | null {
  return id && Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : null;
}

function isDuplicateKey(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: number }).code === 11000
  );
}
