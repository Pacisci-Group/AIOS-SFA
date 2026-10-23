import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  overridePaths,
  searchTokens,
  type AccessContext,
  type CalendarActorView,
  type EffectiveLeaveRules,
  type EmployeeAssignmentView,
  type EmployeeListItem,
  type EmployeeListResponse,
  type EmployeeProfileEventView,
  type EmployeeProfileView,
  type EmployeeUserView,
  type MyHrProfileView,
} from '@sfa/shared';
import { Model, PipelineStage, Types } from 'mongoose';
import { Branch } from '../branches/schemas/branch.schema';
import {
  effectiveAllocations,
  EmployeeProfilesService as ProfilesCore,
  type AssignmentLean,
  type ProfileLean,
} from '../common/hr/employee-profiles.service';
import { LeavePolicyService } from '../common/hr/leave-policy.service';
import { tokenRegex } from '../common/mongo/search-filter';
import { agencyTodayIso } from '../performance/performance.range';
import { RoleAssignmentsService } from '../permissions/role-assignments.service';
import { User } from '../users/schemas/user.schema';
import type {
  ActivateEmployeeDto,
  ListEmployeesDto,
  SetEmployeeAssignmentDto,
  TerminateEmployeeDto,
  UpdateEmployeeFactsDto,
  UpdateMyHrProfileDto,
} from './dto/employee-profile.dto';
import { EmployeeProfile } from './schemas/employee-profile.schema';
import { EmployeeProfileEvent } from './schemas/employee-profile-event.schema';

type UserLean = {
  _id: Types.ObjectId;
  email: string;
  firstName?: string;
  lastName?: string;
  branchId?: Types.ObjectId | null;
  isActive: boolean;
  deactivatedAt?: Date | null;
};

type ListRow = ProfileLean & { user: UserLean };

type EventLean = {
  _id: Types.ObjectId;
  at: Date;
  actorId: Types.ObjectId | null;
  kind: EmployeeProfileEventView['kind'];
  changes: EmployeeProfileEventView['changes'];
  reason: string | null;
};

const EVENTS_SHOWN = 50;

/**
 * The HTTP side of employee profiles (PAC-162): the lists, the admin's view
 * of one person, and the employee's view of themself. Every write goes
 * through the common `EmployeeProfilesService`; this resolves the names,
 * branches, roles and actors a screen shows and nothing else.
 */
@Injectable()
export class EmployeeProfilesService {
  constructor(
    @InjectModel(EmployeeProfile.name)
    private readonly profiles: Model<EmployeeProfile>,
    @InjectModel(EmployeeProfileEvent.name)
    private readonly events: Model<EmployeeProfileEvent>,
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(Branch.name) private readonly branches: Model<Branch>,
    private readonly core: ProfilesCore,
    private readonly leavePolicies: LeavePolicyService,
    private readonly roleAssignments: RoleAssignmentsService,
  ) {}

  /**
   * One aggregation: profiles joined to their user, filtered on both sides,
   * sorted by name. A `$lookup` on `_id` is what lets the list sort and
   * search by a name that lives on another collection without copying it.
   */
  async list(
    agencyId: string,
    query: ListEmployeesDto,
  ): Promise<EmployeeListResponse> {
    const match: Record<string, unknown> = { agencyId };
    if (query.status?.length)
      match.status = { $in: [...new Set(query.status)] };
    if (query.leavePolicyId) {
      match.leavePolicyId = new Types.ObjectId(query.leavePolicyId);
    }
    const userMatch: Record<string, unknown> = {};
    if (query.branchId) {
      userMatch['user.branchId'] = new Types.ObjectId(query.branchId);
    }
    const tokens = searchTokens(query.q);
    if (tokens.length) {
      userMatch.$and = tokens.map((token) => ({
        $or: ['user.firstName', 'user.lastName', 'user.email'].map((field) => ({
          [field]: tokenRegex(token),
        })),
      }));
    }

    const pipeline: PipelineStage[] = [
      { $match: match },
      {
        $lookup: {
          from: 'users',
          localField: 'userId',
          foreignField: '_id',
          as: 'user',
        },
      },
      { $unwind: '$user' },
      ...(Object.keys(userMatch).length ? [{ $match: userMatch }] : []),
      {
        $facet: {
          total: [{ $count: 'n' }],
          items: [
            {
              $sort: {
                'user.lastName': 1,
                'user.firstName': 1,
                'user.email': 1,
              },
            },
            { $skip: (query.page - 1) * query.pageSize },
            { $limit: query.pageSize },
            {
              $project: {
                assignments: 0,
                'user.passwordHash': 0,
                'user.inviteToken': 0,
                'user.passwordResetToken': 0,
              },
            },
          ],
        },
      },
    ];
    const [result] = await this.profiles
      .aggregate<{ total: { n: number }[]; items: ListRow[] }>(pipeline)
      .collation({ locale: 'en', strength: 2 });
    const total = result?.total[0]?.n ?? 0;
    const rows = result?.items ?? [];

    const [names, branchNames, rolesByUser, counts, activePolicyCount] =
      await Promise.all([
        this.core.namesFor(
          agencyId,
          rows.map((row) => row.leavePolicyId),
          rows.map((row) => row.scheduleTemplateId),
        ),
        this.branchNames(rows.map((row) => row.user.branchId)),
        this.roleAssignments.rolesForUsers(rows.map((row) => row.userId)),
        this.core.countsByStatus(agencyId),
        this.leavePolicies.activeCount(agencyId),
      ]);

    const items: EmployeeListItem[] = rows.map((row) => {
      const policy = row.leavePolicyId
        ? names.policies.get(row.leavePolicyId.toHexString())
        : undefined;
      const template = row.scheduleTemplateId
        ? names.templates.get(row.scheduleTemplateId.toHexString())
        : undefined;
      return {
        id: row._id.toHexString(),
        userId: row.userId.toHexString(),
        status: row.status,
        user: this.userView(
          row.user,
          branchNames,
          rolesByUser.get(row.userId.toHexString())?.map((r) => r.name) ?? [],
        ),
        hireDate: row.hireDate ?? null,
        terminationDate: row.terminationDate ?? null,
        leavePolicy: policy
          ? { id: policy._id.toHexString(), name: policy.name }
          : null,
        customRuleCount: overridePaths(row.overrides).length,
        scheduleTemplateName: template?.name ?? null,
        createdAt: (row.createdAt ?? new Date(0)).toISOString(),
      };
    });

    return {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      items,
      counts,
      activePolicyCount,
    };
  }

  async view(agencyId: string, userId: string): Promise<EmployeeProfileView> {
    const profile = await this.core.requireProfile(agencyId, userId);
    return this.toView(agencyId, profile);
  }

  async activate(
    access: AccessContext,
    agencyId: string,
    userId: string,
    dto: ActivateEmployeeDto,
  ): Promise<EmployeeProfileView> {
    const profile = await this.core.activate(
      agencyId,
      userId,
      dto,
      access.userId,
      agencyTodayIso(access.timeZone),
    );
    return this.toView(agencyId, profile);
  }

  async setAssignment(
    access: AccessContext,
    agencyId: string,
    userId: string,
    dto: SetEmployeeAssignmentDto,
  ): Promise<EmployeeProfileView> {
    const profile = await this.core.setAssignment(
      agencyId,
      userId,
      dto,
      access.userId,
      agencyTodayIso(access.timeZone),
    );
    return this.toView(agencyId, profile);
  }

  async updateFacts(
    access: AccessContext,
    agencyId: string,
    userId: string,
    dto: UpdateEmployeeFactsDto,
  ): Promise<EmployeeProfileView> {
    const profile = await this.core.updateFacts(
      agencyId,
      userId,
      dto,
      access.userId,
      agencyTodayIso(access.timeZone),
    );
    return this.toView(agencyId, profile);
  }

  async terminate(
    access: AccessContext,
    agencyId: string,
    userId: string,
    dto: TerminateEmployeeDto,
  ): Promise<EmployeeProfileView> {
    const profile = await this.core.terminate(
      agencyId,
      userId,
      dto,
      access.userId,
    );
    return this.toView(agencyId, profile);
  }

  /** The caller's own record. 404 when they have none — the web says "not set up". */
  async myProfile(
    access: AccessContext,
    agencyId: string,
  ): Promise<MyHrProfileView> {
    const profile = await this.core.profileFor(agencyId, access.userId);
    if (!profile) throw new NotFoundException('Employee profile not found');
    return this.toMyView(agencyId, profile);
  }

  async updateMyProfile(
    access: AccessContext,
    agencyId: string,
    dto: UpdateMyHrProfileDto,
  ): Promise<MyHrProfileView> {
    const profile = await this.core.setBirthday(
      agencyId,
      access.userId,
      dto,
      access.userId,
      agencyTodayIso(access.timeZone),
    );
    return this.toMyView(agencyId, profile);
  }

  // ── Views ────────────────────────────────────────────────────────────────

  private async toView(
    agencyId: string,
    profile: ProfileLean,
  ): Promise<EmployeeProfileView> {
    const history = profile.assignments ?? [];
    const current = history.length ? history[history.length - 1] : null;
    const [user, names, effective, schedule, events] = await Promise.all([
      this.users
        .findById(profile.userId)
        .select('email firstName lastName branchId isActive deactivatedAt')
        .lean<UserLean | null>(),
      this.core.namesFor(
        agencyId,
        [profile.leavePolicyId, ...history.map((a) => a.leavePolicyId)],
        [
          profile.scheduleTemplateId,
          ...history.map((a) => a.scheduleTemplateId),
        ],
      ),
      this.effectiveOrNull(agencyId, current),
      this.core.effectiveScheduleFor(agencyId, current),
      this.events
        .find({ profileId: profile._id })
        .sort({ at: -1, _id: -1 })
        .limit(EVENTS_SHOWN)
        .lean<EventLean[]>(),
    ]);
    if (!user) throw new NotFoundException('Employee profile not found');

    const actorIds = new Set<string>();
    for (const entry of history)
      if (entry.actorId) actorIds.add(entry.actorId.toHexString());
    for (const event of events)
      if (event.actorId) actorIds.add(event.actorId.toHexString());
    const [actors, branchNames, roles] = await Promise.all([
      this.actors([...actorIds]),
      this.branchNames([user.branchId]),
      this.roleAssignments.rolesForUsers([profile.userId]),
    ]);

    const policy = profile.leavePolicyId
      ? names.policies.get(profile.leavePolicyId.toHexString())
      : undefined;

    const assignments: EmployeeAssignmentView[] = [...history]
      .reverse()
      .map((entry) => this.assignmentView(entry, names, actors));

    return {
      id: profile._id.toHexString(),
      userId: profile.userId.toHexString(),
      status: profile.status,
      user: this.userView(
        user,
        branchNames,
        roles.get(profile.userId.toHexString())?.map((r) => r.name) ?? [],
      ),
      hireDate: profile.hireDate ?? null,
      workAnniversary: profile.workAnniversary ?? null,
      terminationDate: profile.terminationDate ?? null,
      dateOfBirth: profile.dateOfBirth ?? null,
      showBirthday: profile.showBirthday ?? true,
      leavePolicy: policy
        ? {
            id: policy._id.toHexString(),
            name: policy.name,
            version: policy.version,
          }
        : null,
      overrides: profile.overrides ?? {},
      effective,
      schedule,
      allocations: profile.allocations ?? {},
      effectiveAllocations: effective
        ? effectiveAllocations(effective.rules, profile.allocations ?? {})
        : {},
      assignments,
      events: events.map((event) => ({
        id: event._id.toHexString(),
        at: event.at.toISOString(),
        kind: event.kind,
        actor: event.actorId
          ? (actors.get(event.actorId.toHexString()) ?? null)
          : null,
        reason: event.reason ?? null,
        changes: event.changes ?? [],
      })),
      createdAt: (profile.createdAt ?? new Date(0)).toISOString(),
      updatedAt: (
        profile.updatedAt ??
        profile.createdAt ??
        new Date(0)
      ).toISOString(),
    };
  }

  private async toMyView(
    agencyId: string,
    profile: ProfileLean,
  ): Promise<MyHrProfileView> {
    const history = profile.assignments ?? [];
    const current = history.length ? history[history.length - 1] : null;
    const [names, effective, schedule] = await Promise.all([
      this.core.namesFor(agencyId, [profile.leavePolicyId], []),
      this.effectiveOrNull(agencyId, current),
      this.core.effectiveScheduleFor(agencyId, current),
    ]);
    const policy = profile.leavePolicyId
      ? names.policies.get(profile.leavePolicyId.toHexString())
      : undefined;
    return {
      status: profile.status,
      hireDate: profile.hireDate ?? null,
      workAnniversary: profile.workAnniversary ?? null,
      terminationDate: profile.terminationDate ?? null,
      dateOfBirth: profile.dateOfBirth ?? null,
      showBirthday: profile.showBirthday ?? true,
      leavePolicyName: policy?.name ?? null,
      effective,
      schedule,
      effectiveAllocations: effective
        ? effectiveAllocations(effective.rules, profile.allocations ?? {})
        : {},
    };
  }

  /** The merged rules for the current assignment; null while pending, and null for a vanished policy. */
  private async effectiveOrNull(
    agencyId: string,
    current: AssignmentLean | null,
  ): Promise<EffectiveLeaveRules | null> {
    if (!current) return null;
    try {
      return await this.leavePolicies.effectiveRules(agencyId, {
        leavePolicyId: current.leavePolicyId,
        overrides: current.overrides,
      });
    } catch (err) {
      if (err instanceof NotFoundException) return null;
      throw err;
    }
  }

  private assignmentView(
    entry: AssignmentLean,
    names: Awaited<ReturnType<ProfilesCore['namesFor']>>,
    actors: Map<string, CalendarActorView>,
  ): EmployeeAssignmentView {
    const policy = names.policies.get(entry.leavePolicyId.toHexString());
    const template = entry.scheduleTemplateId
      ? names.templates.get(entry.scheduleTemplateId.toHexString())
      : undefined;
    return {
      effectiveFrom: entry.effectiveFrom,
      leavePolicyId: entry.leavePolicyId.toHexString(),
      leavePolicyName: policy?.name ?? null,
      overrides: entry.overrides ?? {},
      overriddenPaths: overridePaths(entry.overrides),
      scheduleTemplateId: entry.scheduleTemplateId?.toHexString() ?? null,
      scheduleTemplateName: template?.name ?? null,
      scheduleOverride: entry.scheduleOverride ?? null,
      allocations: entry.allocations ?? {},
      actor: entry.actorId
        ? (actors.get(entry.actorId.toHexString()) ?? null)
        : null,
      reason: entry.reason ?? null,
      recordedAt: entry.recordedAt.toISOString(),
    };
  }

  private userView(
    user: UserLean,
    branchNames: Map<string, string>,
    roleNames: string[],
  ): EmployeeUserView {
    const branchId = user.branchId?.toHexString() ?? null;
    return {
      name: [user.firstName, user.lastName].filter(Boolean).join(' ') || null,
      email: user.email,
      branchId,
      branchName: branchId ? (branchNames.get(branchId) ?? null) : null,
      roleNames,
      accountStatus: user.deactivatedAt
        ? 'deactivated'
        : user.isActive
          ? 'active'
          : 'invited',
    };
  }

  private async branchNames(
    ids: (Types.ObjectId | null | undefined)[],
  ): Promise<Map<string, string>> {
    const keys = [...new Set(ids.filter(Boolean).map(String))];
    if (!keys.length) return new Map();
    const rows = await this.branches
      .find({ _id: { $in: keys.map((id) => new Types.ObjectId(id)) } })
      .select('name')
      .lean<{ _id: Types.ObjectId; name: string }[]>();
    return new Map(rows.map((row) => [row._id.toHexString(), row.name]));
  }

  private async actors(ids: string[]): Promise<Map<string, CalendarActorView>> {
    if (ids.length === 0) return new Map();
    const rows = await this.users
      .find({ _id: { $in: ids.map((id) => new Types.ObjectId(id)) } })
      .select('firstName lastName email')
      .lean<UserLean[]>();
    return new Map(
      rows.map((user) => [
        user._id.toHexString(),
        {
          id: user._id.toHexString(),
          name:
            [user.firstName, user.lastName].filter(Boolean).join(' ') ||
            user.email,
        },
      ]),
    );
  }
}
