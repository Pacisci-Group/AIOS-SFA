import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  CREATABLE_POLICY_TYPES,
  type CreatablePolicyType,
  type HolidayKey,
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
  type CustomHolidayRow,
  HolidayPolicy,
  type HolidayPolicyDocument,
} from './schemas/holiday-policy.schema';
import type { PolicyRecord } from './schemas/policy-record.schema';
import {
  WorkWeekPolicy,
  type WorkWeekDayRow,
  type WorkWeekPolicyDocument,
} from './schemas/work-week-policy.schema';

/** A lean row of either collection; only its own type's rules are set. */
type StoredRow = {
  _id: Types.ObjectId;
  name: string;
  memberIds?: Types.ObjectId[];
  createdAt?: Date;
  updatedAt?: Date;
  holidays?: HolidayKey[];
  customHolidays?: CustomHolidayRow[];
  days?: WorkWeekDayRow[];
};

/** A row tagged with the collection it came from. */
type PolicyLean = StoredRow & { type: CreatablePolicyType };

/** The operations every policy collection shares (`PolicyRecord`'s fields). */
type PolicyModel = Model<PolicyRecord>;

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
 * ## One collection per type
 *
 * `holidayPolicies` and `workWeekPolicies` (PAC-174 adds leave). The page
 * still shows them as one list, so {@link list} reads every collection and
 * merges; a policy id is looked up in each ({@link find}) — ObjectIds do not
 * collide, so the first hit is the policy.
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
    @InjectModel(HolidayPolicy.name)
    private readonly holidayPolicies: Model<HolidayPolicyDocument>,
    @InjectModel(WorkWeekPolicy.name)
    private readonly workWeekPolicies: Model<WorkWeekPolicyDocument>,
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(Branch.name) private readonly branches: Model<Branch>,
  ) {}

  /** The collection of each creatable type, for the operations they share. */
  private store(type: CreatablePolicyType): PolicyModel {
    const model =
      type === 'holiday' ? this.holidayPolicies : this.workWeekPolicies;
    return model as unknown as PolicyModel;
  }

  /** Every active policy of the agency, tagged with its type, newest first. */
  private async activeRows(
    agencyId: string,
    select?: string,
  ): Promise<PolicyLean[]> {
    const perType = await Promise.all(
      CREATABLE_POLICY_TYPES.map(async (type) => {
        const query = this.store(type).find({ agencyId, ...ACTIVE });
        if (select) query.select(select);
        const rows = await query.lean<StoredRow[]>();
        return rows.map((row) => ({ ...row, type }));
      }),
    );
    return perType
      .flat()
      .sort(
        (a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0),
      );
  }

  async list(
    agencyId: string,
    type?: TimeOffPolicyType,
  ): Promise<TimeOffPoliciesResponse> {
    const [rows, people] = await Promise.all([
      this.activeRows(agencyId),
      this.enrollable(agencyId),
    ]);
    // `time_off` has no collection until PAC-174; it counts zero.
    const counts: Record<TimeOffPolicyType, number> = {
      holiday: 0,
      work_week: 0,
      time_off: 0,
    };
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
    const created =
      dto.type === 'holiday'
        ? await this.holidayPolicies.create({
            agencyId,
            name: dto.name,
            holidays: dto.holiday.holidays,
            customHolidays: dto.holiday.customHolidays,
            memberIds,
          })
        : await this.workWeekPolicies.create({
            agencyId,
            name: dto.name,
            days: dto.workWeek.days,
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
    if (dto.holiday) {
      $set.holidays = dto.holiday.holidays;
      $set.customHolidays = dto.holiday.customHolidays;
    }
    if (dto.workWeek) $set.days = dto.workWeek.days;
    let memberIds: Types.ObjectId[] | null = null;
    if (dto.memberIds) {
      assertMembers(dto.memberIds, await this.enrollable(agencyId));
      memberIds = dto.memberIds.map((id) => new Types.ObjectId(id));
      $set.memberIds = memberIds;
    }

    await this.store(row.type).updateOne(
      { _id: row._id, agencyId, ...ACTIVE },
      { $set },
    );
    if (memberIds) {
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
    await this.store(row.type).updateOne(
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
      this.activeRows(agencyId, 'name memberIds createdAt'),
    ]);
    const current = new Map<string, PolicyPersonView['policies']>();
    for (const row of rows) {
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
    const _id = new Types.ObjectId(policyId);
    const hits = await Promise.all(
      CREATABLE_POLICY_TYPES.map(async (type) => {
        const row = await this.store(type)
          .findOne({ _id, agencyId, ...ACTIVE })
          .lean<StoredRow | null>();
        return row ? { ...row, type } : null;
      }),
    );
    const row = hits.find((hit) => hit !== null);
    if (!row) throw new NotFoundException('That policy does not exist.');
    return row;
  }

  private async assertNameFree(
    agencyId: string,
    type: CreatablePolicyType,
    name: string,
    exceptId?: Types.ObjectId,
  ): Promise<void> {
    const taken = await this.store(type).exists({
      agencyId,
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
    type: CreatablePolicyType,
    keepId: Types.ObjectId,
    memberIds: Types.ObjectId[],
  ): Promise<void> {
    if (!memberIds.length) return;
    await this.store(type).updateMany(
      {
        agencyId,
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
        days: (row.days ?? []).map(({ weekday, start, end }) => ({
          weekday,
          start,
          end,
        })),
      },
    };
  }
  return {
    ...base,
    type: 'holiday',
    holiday: {
      holidays: [...(row.holidays ?? [])],
      customHolidays: (row.customHolidays ?? []).map(
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
