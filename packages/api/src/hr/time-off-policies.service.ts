import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  CREATABLE_POLICY_TYPES,
  TIME_OFF_POLICY_TYPES,
  type CreatablePolicyType,
  type PolicyMemberView,
  type PolicyPeopleResponse,
  type PolicyPersonView,
  type TimeOffPoliciesResponse,
  type TimeOffPolicySummary,
  type TimeOffPolicyType,
  type TimeOffPolicyView,
} from '@sfa/shared';
import { Model, Types } from 'mongoose';
import { Branch } from '../branches/schemas/branch.schema';
import { User } from '../users/schemas/user.schema';
import type {
  CreateTimeOffPolicyDto,
  UpdateTimeOffPolicyDto,
} from './dto/time-off-policy.dto';
import {
  TimeOffPolicy,
  type TimeOffPolicyDocument,
} from './schemas/time-off-policy.schema';

type PolicyLean = {
  _id: Types.ObjectId;
  type: TimeOffPolicyType;
  name: string;
  holiday?: TimeOffPolicy['holiday'];
  workWeek?: TimeOffPolicy['workWeek'];
  memberIds?: Types.ObjectId[];
  createdAt?: Date;
  updatedAt?: Date;
};

type UserLean = {
  _id: Types.ObjectId;
  email: string;
  firstName?: string;
  lastName?: string;
  branchId?: Types.ObjectId;
  isActive: boolean;
};

/** Spelled out on every read: archived policies stay as rows (PAC-155). */
const ACTIVE = { archivedAt: null } as const;

/**
 * Time off policies (PAC-161 v3): list, read, create, edit and archive, and
 * the people they can enrol. Every method is agency-wide — a policy belongs
 * to no branch — and every caller holds `agency:hr:admin`.
 *
 * ## Enrolment moves people
 *
 * A person is in at most one active policy of each creatable type. Saving a
 * policy's members takes those people out of every other active policy of
 * the same type in the same write path ({@link releaseFromOthers}); the
 * wizard warns before it happens. Not a transaction: the two writes are both
 * idempotent, and a crash between them leaves a person briefly in two
 * policies, which the next save of either one settles.
 */
@Injectable()
export class TimeOffPoliciesService {
  constructor(
    @InjectModel(TimeOffPolicy.name)
    private readonly policies: Model<TimeOffPolicyDocument>,
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(Branch.name) private readonly branches: Model<Branch>,
  ) {}

  async list(
    agencyId: string,
    type?: TimeOffPolicyType,
  ): Promise<TimeOffPoliciesResponse> {
    const [rows, people] = await Promise.all([
      this.policies
        .find({ agencyId, ...ACTIVE })
        .sort({ createdAt: -1 })
        .lean<PolicyLean[]>(),
      this.enrollable(agencyId),
    ]);
    const counts = Object.fromEntries(
      TIME_OFF_POLICY_TYPES.map((key) => [key, 0]),
    ) as Record<TimeOffPolicyType, number>;
    for (const row of rows) counts[row.type] += 1;
    return {
      policies: rows
        .filter((row) => !type || row.type === type)
        .map((row) => toSummary(row, people)),
      counts,
    };
  }

  async get(agencyId: string, policyId: string): Promise<TimeOffPolicyView> {
    const [row, people] = await Promise.all([
      this.find(agencyId, policyId),
      this.enrollable(agencyId),
    ]);
    return toView(row, people);
  }

  async create(
    agencyId: string,
    dto: CreateTimeOffPolicyDto,
  ): Promise<TimeOffPolicyView> {
    const people = await this.enrollable(agencyId);
    assertMembers(dto.memberIds, people);
    await this.assertNameFree(agencyId, dto.type, dto.name);

    const memberIds = dto.memberIds.map((id) => new Types.ObjectId(id));
    const created = await this.policies.create({
      agencyId,
      type: dto.type,
      name: dto.name,
      ...(dto.type === 'holiday'
        ? { holiday: dto.holiday }
        : { workWeek: dto.workWeek }),
      memberIds,
    });
    await this.releaseFromOthers(agencyId, dto.type, created._id, memberIds);
    return this.get(agencyId, created._id.toString());
  }

  async update(
    agencyId: string,
    policyId: string,
    dto: UpdateTimeOffPolicyDto,
  ): Promise<TimeOffPolicyView> {
    const row = await this.find(agencyId, policyId);
    if (dto.holiday && row.type !== 'holiday') {
      throw new BadRequestException('Only a Holiday policy has holidays.');
    }
    if (dto.workWeek && row.type !== 'work_week') {
      throw new BadRequestException('Only a Work week policy has a schedule.');
    }
    if (dto.name !== undefined && dto.name !== row.name) {
      await this.assertNameFree(agencyId, row.type, dto.name, row._id);
    }

    const $set: Record<string, unknown> = {};
    if (dto.name !== undefined) $set.name = dto.name;
    if (dto.holiday) $set.holiday = dto.holiday;
    if (dto.workWeek) $set.workWeek = dto.workWeek;
    let memberIds: Types.ObjectId[] | null = null;
    if (dto.memberIds) {
      assertMembers(dto.memberIds, await this.enrollable(agencyId));
      memberIds = dto.memberIds.map((id) => new Types.ObjectId(id));
      $set.memberIds = memberIds;
    }

    await this.policies.updateOne(
      { _id: row._id, agencyId, ...ACTIVE },
      { $set },
    );
    if (memberIds && isCreatable(row.type)) {
      await this.releaseFromOthers(agencyId, row.type, row._id, memberIds);
    }
    return this.get(agencyId, policyId);
  }

  /** Soft: the row stays, its people are free to join another policy. */
  async archive(
    agencyId: string,
    policyId: string,
    actorId: string,
  ): Promise<void> {
    const row = await this.find(agencyId, policyId);
    await this.policies.updateOne(
      { _id: row._id, agencyId, ...ACTIVE },
      {
        $set: {
          archivedAt: new Date(),
          archivedBy: new Types.ObjectId(actorId),
        },
      },
    );
  }

  /** Everyone who can be enrolled, with their current policy of each type. */
  async people(agencyId: string): Promise<PolicyPeopleResponse> {
    const [people, rows] = await Promise.all([
      this.enrollable(agencyId),
      this.policies
        .find({ agencyId, ...ACTIVE, type: { $in: CREATABLE_POLICY_TYPES } })
        .select('type name memberIds')
        .lean<PolicyLean[]>(),
    ]);
    const current = new Map<string, PolicyPersonView['policies']>();
    for (const row of rows) {
      if (!isCreatable(row.type)) continue;
      for (const memberId of row.memberIds ?? []) {
        const key = memberId.toString();
        const entry = current.get(key) ?? {};
        entry[row.type] = { id: row._id.toString(), name: row.name };
        current.set(key, entry);
      }
    }
    return {
      people: [...people.values()].map((person) => ({
        ...person,
        policies: current.get(person.id) ?? {},
      })),
    };
  }

  // ── internals ─────────────────────────────────────────────────────────

  private async find(agencyId: string, policyId: string): Promise<PolicyLean> {
    const row = await this.policies
      .findOne({ _id: new Types.ObjectId(policyId), agencyId, ...ACTIVE })
      .lean<PolicyLean | null>();
    if (!row) throw new NotFoundException('That policy does not exist.');
    return row;
  }

  private async assertNameFree(
    agencyId: string,
    type: TimeOffPolicyType,
    name: string,
    exceptId?: Types.ObjectId,
  ): Promise<void> {
    const taken = await this.policies.exists({
      agencyId,
      type,
      ...ACTIVE,
      name: { $regex: `^${escapeRegex(name.trim())}$`, $options: 'i' },
      ...(exceptId ? { _id: { $ne: exceptId } } : {}),
    });
    if (taken) {
      throw new ConflictException(
        `There is already a policy called "${name.trim()}".`,
      );
    }
  }

  private async releaseFromOthers(
    agencyId: string,
    type: TimeOffPolicyType,
    keepId: Types.ObjectId,
    memberIds: Types.ObjectId[],
  ): Promise<void> {
    if (!memberIds.length) return;
    await this.policies.updateMany(
      {
        agencyId,
        type,
        ...ACTIVE,
        _id: { $ne: keepId },
        memberIds: { $in: memberIds },
      },
      { $pull: { memberIds: { $in: memberIds } } },
    );
  }

  /**
   * The agency's enrollable people, keyed by id: everyone not removed —
   * active accounts and pending invites — and never a platform admin.
   */
  private async enrollable(
    agencyId: string,
  ): Promise<Map<string, PolicyMemberView>> {
    // `User.agencyId` is an ObjectId, unlike the policy's string.
    const users = await this.users
      .find({
        agencyId: new Types.ObjectId(agencyId),
        deactivatedAt: null,
        isPlatformAdmin: { $ne: true },
      })
      .select('email firstName lastName branchId isActive')
      .sort({ firstName: 1, lastName: 1, email: 1 })
      .lean<UserLean[]>();
    const branchIds = [
      ...new Set(
        users.flatMap((user) =>
          user.branchId ? [user.branchId.toString()] : [],
        ),
      ),
    ];
    const branchRows = branchIds.length
      ? await this.branches
          .find({ _id: { $in: branchIds.map((id) => new Types.ObjectId(id)) } })
          .select('name')
          .lean<{ _id: Types.ObjectId; name: string }[]>()
      : [];
    const branchName = new Map(
      branchRows.map((row) => [row._id.toString(), row.name]),
    );
    return new Map(
      users.map((user) => {
        const id = user._id.toString();
        const name =
          [user.firstName, user.lastName].filter(Boolean).join(' ').trim() ||
          user.email;
        return [
          id,
          {
            id,
            name,
            email: user.email,
            branchName: user.branchId
              ? (branchName.get(user.branchId.toString()) ?? null)
              : null,
            status: user.isActive ? 'active' : 'invited',
          } satisfies PolicyMemberView,
        ];
      }),
    );
  }
}

function isCreatable(type: TimeOffPolicyType): type is CreatablePolicyType {
  return (CREATABLE_POLICY_TYPES as readonly string[]).includes(type);
}

function assertMembers(
  ids: readonly string[],
  people: ReadonlyMap<string, PolicyMemberView>,
): void {
  const unknown = ids.filter((id) => !people.has(id));
  if (unknown.length) {
    throw new BadRequestException(
      unknown.length === 1
        ? 'One of the people is not in this agency, or has been removed.'
        : `${unknown.length} of the people are not in this agency, or have been removed.`,
    );
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function liveMembers(
  row: PolicyLean,
  people: ReadonlyMap<string, PolicyMemberView>,
): PolicyMemberView[] {
  return (row.memberIds ?? []).flatMap((id) => {
    const person = people.get(id.toString());
    return person ? [person] : [];
  });
}

function toSummary(
  row: PolicyLean,
  people: ReadonlyMap<string, PolicyMemberView>,
): TimeOffPolicySummary {
  const base = {
    id: row._id.toString(),
    name: row.name,
    memberCount: liveMembers(row, people).length,
    createdAt: (row.createdAt ?? new Date(0)).toISOString(),
    updatedAt: (row.updatedAt ?? row.createdAt ?? new Date(0)).toISOString(),
  };
  if (row.type === 'work_week') {
    return {
      ...base,
      type: 'work_week',
      workWeek: {
        days: (row.workWeek?.days ?? []).map(({ weekday, start, end }) => ({
          weekday,
          start,
          end,
        })),
      },
    };
  }
  // `time_off` cannot be created yet (PAC-174); only `holiday` reaches here.
  return {
    ...base,
    type: 'holiday',
    holiday: {
      holidays: [...(row.holiday?.holidays ?? [])],
      customHolidays: (row.holiday?.customHolidays ?? []).map(
        ({ id, name, start, end, repeatsYearly }) => ({
          id,
          name,
          start,
          end,
          repeatsYearly: repeatsYearly ?? false,
        }),
      ),
    },
  };
}

function toView(
  row: PolicyLean,
  people: ReadonlyMap<string, PolicyMemberView>,
): TimeOffPolicyView {
  return { ...toSummary(row, people), members: liveMembers(row, people) };
}
