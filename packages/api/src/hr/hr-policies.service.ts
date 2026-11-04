import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  CREATABLE_POLICY_TYPES,
  defaultStartingBalance,
  LOCKED_TIME_OFF_FIELDS,
  normalizeTimeOffPolicyRules,
  timeOffPolicyRulesError,
  type CreatablePolicyType,
  type HolidayKey,
  type HrPoliciesResponse,
  type HrPolicySummary,
  type HrPolicyType,
  type HrPolicyView,
  type PolicyMemberView,
  type PolicyPeopleResponse,
  type PolicyPersonView,
  type TimeOffPolicyRules,
} from '@sfa/shared';
import { Model, Types } from 'mongoose';
import { Branch } from '../branches/schemas/branch.schema';
import { businessDateInstant } from '../common/dates/business-dates';
import {
  LeaveLedgerService,
  type NewLedgerRow,
} from '../common/time-off/leave-ledger.service';
import {
  timeOffRulesOf,
  type TimeOffFieldsLean,
} from '../common/time-off/time-off-policy.lean';
import { agencyTodayIso } from '../performance/performance.range';
import { TimeOffRequest } from '../time-off-requests/schemas/time-off-request.schema';
import { User } from '../users/schemas/user.schema';
import type { CreateHrPolicyDto, UpdateHrPolicyDto } from './dto/hr-policy.dto';
import {
  type CustomHolidayRow,
  HolidayPolicy,
  type HolidayPolicyDocument,
} from './schemas/holiday-policy.schema';
import type { MemberListPolicyRecord } from './schemas/policy-record.schema';
import {
  TimeOffPolicy,
  type TimeOffPolicyDocument,
} from './schemas/time-off-policy.schema';
import {
  WorkWeekPolicy,
  type WorkWeekDayRow,
  type WorkWeekPolicyDocument,
} from './schemas/work-week-policy.schema';

/** A lean row of any collection; only its own type's rules are set. */
type StoredRow = {
  _id: Types.ObjectId;
  name: string;
  memberIds?: Types.ObjectId[];
  createdAt?: Date;
  updatedAt?: Date;
  holidays?: HolidayKey[];
  customHolidays?: CustomHolidayRow[];
  days?: WorkWeekDayRow[];
} & TimeOffFieldsLean;

/** A row tagged with the collection it came from. */
type PolicyLean = StoredRow & { type: CreatablePolicyType };

/** The operations every collection shares: list, find, members, archive. */
type PolicyModel = Model<MemberListPolicyRecord>;

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

/** PAC-165's "waiting for a decision" status; migrated rows carry it too. */
const SUBMITTED = 'Submitted';

/**
 * HR policies (PAC-161 v3, PAC-174): list, read, create, edit and archive,
 * and the people they can enrol. Every method is agency-wide — a policy
 * belongs to no branch — and every caller holds `agency:hr:admin`.
 *
 * ## One collection per type
 *
 * `holidayPolicies`, `workWeekPolicies`, `timeOffPolicies`. The page shows
 * them as one list, so {@link list} reads every collection and merges; a
 * policy id is looked up in each ({@link find}) — ObjectIds do not collide,
 * so the first hit is the policy.
 *
 * ## Enrolment moves people
 *
 * A person is in at most one active Holiday policy, one Work week policy,
 * and one time off policy *per kind* (PTO, Sick, …; Custom excepted). Saving
 * a policy's members takes those people out of every other active policy of
 * the same kind in the same write path ({@link releaseFromOthers}); the
 * wizard warns before it happens. Not a transaction: the writes are all
 * idempotent, and a crash between them leaves a person briefly in two
 * policies, which the next save of either one settles.
 *
 * ## Time off: the balance is the ledger
 *
 * A time off policy stores no balance. Activation and enrolment post one
 * `allocation` row per person (the starting balance — a 0-hour row is still
 * the "joined" event); removal posts a `removed_from_policy` row; re-adding
 * posts nothing, so the old balance resumes. The accrual job (worker) posts
 * the rest. Paid/unpaid and Unlimited are locked after creation.
 */
@Injectable()
export class HrPoliciesService {
  constructor(
    @InjectModel(HolidayPolicy.name)
    private readonly holidayPolicies: Model<HolidayPolicyDocument>,
    @InjectModel(WorkWeekPolicy.name)
    private readonly workWeekPolicies: Model<WorkWeekPolicyDocument>,
    @InjectModel(TimeOffPolicy.name)
    private readonly timeOffPolicies: Model<TimeOffPolicyDocument>,
    @InjectModel(TimeOffRequest.name)
    private readonly timeOffRequests: Model<TimeOffRequest>,
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(Branch.name) private readonly branches: Model<Branch>,
    private readonly ledger: LeaveLedgerService,
  ) {}

  /** The collection of each type, for the operations they share. */
  private store(type: CreatablePolicyType): PolicyModel {
    const model =
      type === 'holiday'
        ? this.holidayPolicies
        : type === 'work_week'
          ? this.workWeekPolicies
          : this.timeOffPolicies;
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
    type?: HrPolicyType,
  ): Promise<HrPoliciesResponse> {
    const [rows, people] = await Promise.all([
      this.activeRows(agencyId),
      this.enrollable(agencyId),
    ]);
    const counts: Record<HrPolicyType, number> = {
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

  async get(agencyId: string, policyId: string): Promise<HrPolicyView> {
    const [row, people] = await Promise.all([
      this.find(agencyId, policyId),
      this.enrollable(agencyId),
    ]);
    return this.toView(row, people);
  }

  async create(
    agencyId: string,
    dto: CreateHrPolicyDto,
    timeZone: string,
  ): Promise<HrPolicyView> {
    const people = await this.enrollable(agencyId);
    assertMembers(dto.memberIds, people);
    await this.assertNameFree(agencyId, dto.type, dto.name);

    const memberIds = dto.memberIds.map((id) => new Types.ObjectId(id));
    if (dto.type === 'time_off') {
      const balances = dto.startingBalanceHours ?? {};
      assertBalancesForMembers(balances, dto.memberIds);
      const created = await this.timeOffPolicies.create({
        agencyId,
        name: dto.name,
        memberIds,
        ...dto.timeOff,
      });
      const effectiveAt = todayInstant(timeZone);
      await this.releaseFromOthers(
        agencyId,
        'time_off',
        created._id,
        memberIds,
        {
          timeOffType: dto.timeOff.timeOffType,
          effectiveAt,
        },
      );
      await this.ledger.post(
        allocationRows(
          agencyId,
          created._id,
          memberIds,
          dto.timeOff,
          balances,
          effectiveAt,
          'activation',
        ),
      );
      return this.get(agencyId, created._id.toString());
    }

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
    dto: UpdateHrPolicyDto,
    timeZone: string,
  ): Promise<HrPolicyView> {
    const row = await this.find(agencyId, policyId);
    if (dto.holiday && row.type !== 'holiday') {
      throw new BadRequestException('Only a Holiday policy has holidays.');
    }
    if (dto.workWeek && row.type !== 'work_week') {
      throw new BadRequestException('Only a Work week policy has a schedule.');
    }
    if (dto.timeOff && row.type !== 'time_off') {
      throw new BadRequestException(
        'Only a Time off policy has accrual rules.',
      );
    }
    if (dto.startingBalanceHours && row.type !== 'time_off') {
      throw new BadRequestException('Only a Time off policy has balances.');
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

    let rules = row.type === 'time_off' ? timeOffRulesOf(row) : null;
    if (dto.timeOff && rules) {
      const merged = { ...rules, ...dto.timeOff };
      merged.autoApprove = { ...rules.autoApprove, ...dto.timeOff.autoApprove };
      const error = timeOffPolicyRulesError(merged);
      if (error) throw new BadRequestException(error);
      const next = normalizeTimeOffPolicyRules(merged);
      for (const field of LOCKED_TIME_OFF_FIELDS) {
        if (next[field] !== rules[field]) {
          throw new BadRequestException(
            'Paid / unpaid and Unlimited are locked once a policy is active. Delete it and create a new one.',
          );
        }
      }
      Object.assign($set, next);
      rules = next;
    }

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
      if (row.type === 'time_off' && rules) {
        await this.recordEnrolmentChange(
          agencyId,
          row,
          rules,
          memberIds,
          dto.startingBalanceHours ?? {},
          timeZone,
        );
      } else {
        await this.releaseFromOthers(agencyId, row.type, row._id, memberIds);
      }
    }
    return this.get(agencyId, policyId);
  }

  /**
   * Enrol one person (PAC-162: the profile's "Add to policy" and Complete
   * onboarding). The same rules as a member-list save — a time off policy
   * posts the starting balance (or resumes an old one, refusing a balance
   * for a returning person) and moves them out of their other policy of the
   * kind; Holiday / Work week move them too. Already a member: a no-op,
   * unless a balance was sent, which is then a 400.
   */
  async enrol(
    agencyId: string,
    policyId: string,
    userId: string,
    startingBalanceHours: number | undefined,
    timeZone: string,
  ): Promise<HrPolicyView> {
    const row = await this.find(agencyId, policyId);
    if (startingBalanceHours !== undefined && row.type !== 'time_off') {
      throw new BadRequestException('Only a Time off policy has balances.');
    }
    assertMembers([userId], await this.enrollable(agencyId));
    const userObjectId = new Types.ObjectId(userId);
    const before = row.memberIds ?? [];
    if (before.some((id) => id.equals(userObjectId))) {
      if (startingBalanceHours !== undefined) {
        throw new BadRequestException(
          'That person is already in this policy; their balance cannot be set.',
        );
      }
      return this.get(agencyId, policyId);
    }
    const memberIds = [...before, userObjectId];
    await this.store(row.type).updateOne(
      { _id: row._id, agencyId, ...ACTIVE },
      { $addToSet: { memberIds: userObjectId } },
    );
    if (row.type === 'time_off') {
      await this.recordEnrolmentChange(
        agencyId,
        row,
        timeOffRulesOf(row),
        memberIds,
        startingBalanceHours === undefined
          ? {}
          : { [userId]: startingBalanceHours },
        timeZone,
      );
    } else {
      await this.releaseFromOthers(agencyId, row.type, row._id, [userObjectId]);
    }
    return this.get(agencyId, policyId);
  }

  /**
   * Take one person out (PAC-162: the profile's "Remove from policy"). A
   * time off policy posts the `removed_from_policy` row and keeps the
   * ledger — the balance resumes if they are ever re-added. 404 when they
   * are not a member.
   */
  async unenrol(
    agencyId: string,
    policyId: string,
    userId: string,
    timeZone: string,
  ): Promise<void> {
    const row = await this.find(agencyId, policyId);
    const userObjectId = new Types.ObjectId(userId);
    if (!(row.memberIds ?? []).some((id) => id.equals(userObjectId))) {
      throw new NotFoundException('That person is not in this policy.');
    }
    await this.store(row.type).updateOne(
      { _id: row._id, agencyId, ...ACTIVE },
      { $pull: { memberIds: userObjectId } },
    );
    if (row.type === 'time_off') {
      await this.ledger.post([
        removalRow(agencyId, row._id, userObjectId, todayInstant(timeZone)),
      ]);
    }
  }

  /**
   * Soft: the row stays, its people are free to join another policy. A time
   * off policy keeps its ledger and history, and cannot go while a request
   * against it is waiting for a decision.
   */
  async archive(
    agencyId: string,
    policyId: string,
    actorId: string,
  ): Promise<void> {
    const row = await this.find(agencyId, policyId);
    if (row.type === 'time_off') {
      const waiting = await this.timeOffRequests.countDocuments({
        agencyId,
        policyId: row._id,
        status: SUBMITTED,
      });
      if (waiting > 0) {
        throw new ConflictException(
          `${waiting} request${waiting === 1 ? ' is' : 's are'} waiting for a decision. Decide ${waiting === 1 ? 'it' : 'them'} first.`,
        );
      }
    }
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

  /** Everyone who can be enrolled, with their current policy of each kind. */
  async people(agencyId: string): Promise<PolicyPeopleResponse> {
    const [people, rows] = await Promise.all([
      this.enrollable(agencyId),
      this.activeRows(agencyId, 'name memberIds createdAt timeOffType'),
    ]);
    const current = new Map<string, PolicyPersonView['policies']>();
    const timeOff = new Map<string, PolicyPersonView['timeOffPolicies']>();
    for (const row of rows) {
      const ref = { id: row._id.toString(), name: row.name };
      for (const memberId of row.memberIds ?? []) {
        const key = memberId.toString();
        if (row.type === 'time_off') {
          // Custom never moves anyone, so it is nobody's "current" policy.
          if (!row.timeOffType || row.timeOffType === 'custom') continue;
          const entry = timeOff.get(key) ?? {};
          entry[row.timeOffType] = ref;
          timeOff.set(key, entry);
        } else {
          const entry = current.get(key) ?? {};
          entry[row.type] = ref;
          current.set(key, entry);
        }
      }
    }
    return {
      people: [...people.values()].map((person) => ({
        ...person,
        policies: current.get(person.id) ?? {},
        timeOffPolicies: timeOff.get(person.id) ?? {},
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

  private async toView(
    row: PolicyLean,
    people: ReadonlyMap<string, PolicyMemberView>,
  ): Promise<HrPolicyView> {
    const members = liveMembers(row, people);
    if (row.type !== 'time_off') {
      return { ...toSummary(row, people), members };
    }
    const unlimited = row.accrualType === 'unlimited';
    const balances = unlimited
      ? new Map<string, number>()
      : await this.ledger.balances(
          row._id,
          members.map((member) => new Types.ObjectId(member.id)),
        );
    return {
      ...toSummary(row, people),
      members: members.map((member) => ({
        ...member,
        balanceHours: unlimited ? null : (balances.get(member.id) ?? 0),
      })),
    };
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

  /**
   * Take `memberIds` out of every other active policy of the same kind. For
   * time off the kind is the `timeOffType`, Custom moves nobody, and each
   * person leaving another policy gets a `removed_from_policy` row there.
   */
  private async releaseFromOthers(
    agencyId: string,
    type: CreatablePolicyType,
    keepId: Types.ObjectId,
    memberIds: Types.ObjectId[],
    timeOff?: {
      timeOffType: TimeOffPolicyRules['timeOffType'];
      effectiveAt: Date;
    },
  ): Promise<void> {
    if (!memberIds.length) return;
    if (type !== 'time_off') {
      await this.store(type).updateMany(
        {
          agencyId,
          ...ACTIVE,
          _id: { $ne: keepId },
          memberIds: { $in: memberIds },
        },
        { $pull: { memberIds: { $in: memberIds } } },
      );
      return;
    }
    if (!timeOff || timeOff.timeOffType === 'custom') return;
    const filter = {
      agencyId,
      ...ACTIVE,
      _id: { $ne: keepId },
      timeOffType: timeOff.timeOffType,
      memberIds: { $in: memberIds },
    };
    const others = await this.timeOffPolicies
      .find(filter)
      .select('memberIds')
      .lean<{ _id: Types.ObjectId; memberIds?: Types.ObjectId[] }[]>();
    if (!others.length) return;
    await this.timeOffPolicies.updateMany(filter, {
      $pull: { memberIds: { $in: memberIds } },
    });
    const moving = new Set(memberIds.map((id) => id.toString()));
    await this.ledger.post(
      others.flatMap((other) =>
        (other.memberIds ?? [])
          .filter((id) => moving.has(id.toString()))
          .map((userId) =>
            removalRow(agencyId, other._id, userId, timeOff.effectiveAt),
          ),
      ),
    );
  }

  /**
   * A time off policy's member list changed: who joined gets a starting
   * balance (unless they were here before — then it resumes), who left gets
   * a removal row, and whoever joined leaves their other policy of the kind.
   */
  private async recordEnrolmentChange(
    agencyId: string,
    row: PolicyLean,
    rules: TimeOffPolicyRules,
    memberIds: Types.ObjectId[],
    startingBalanceHours: Record<string, number>,
    timeZone: string,
  ): Promise<void> {
    const before = new Set((row.memberIds ?? []).map((id) => id.toString()));
    const after = new Set(memberIds.map((id) => id.toString()));
    const added = memberIds.filter((id) => !before.has(id.toString()));
    const removed = (row.memberIds ?? []).filter(
      (id) => !after.has(id.toString()),
    );
    const effectiveAt = todayInstant(timeZone);

    assertBalancesForMembers(
      startingBalanceHours,
      added.map((id) => id.toString()),
      'Starting balances are for people being added.',
    );
    const resuming = await this.ledger.enrolledBefore(row._id, added);
    const returning = Object.keys(startingBalanceHours).filter((id) =>
      resuming.has(id),
    );
    if (returning.length) {
      throw new BadRequestException(
        `${returning.length === 1 ? 'One person was' : `${returning.length} people were`} in this policy before; their balance resumes and cannot be set.`,
      );
    }

    await this.releaseFromOthers(agencyId, 'time_off', row._id, added, {
      timeOffType: rules.timeOffType,
      effectiveAt,
    });
    await this.ledger.post([
      ...allocationRows(
        agencyId,
        row._id,
        added.filter((id) => !resuming.has(id.toString())),
        rules,
        startingBalanceHours,
        effectiveAt,
        'enrollment',
      ),
      ...removed.map((userId) =>
        removalRow(agencyId, row._id, userId, effectiveAt),
      ),
    ]);
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

/** A starting balance must belong to someone on the list it came with. */
function assertBalancesForMembers(
  balances: Record<string, number>,
  memberIds: readonly string[],
  message = 'Starting balances must belong to people being enrolled.',
): void {
  const members = new Set(memberIds);
  if (Object.keys(balances).some((id) => !members.has(id))) {
    throw new BadRequestException(message);
  }
}

/** Today's first instant on the agency's calendar — when a row "happened". */
function todayInstant(timeZone: string): Date {
  return businessDateInstant(agencyTodayIso(timeZone), timeZone);
}

/**
 * One `allocation` row per person joining: the balance the admin set, or
 * the policy's default; none at all on Unlimited. A 0-hour row is still the
 * "joined" event.
 */
function allocationRows(
  agencyId: string,
  policyId: Types.ObjectId,
  userIds: readonly Types.ObjectId[],
  rules: Pick<
    TimeOffPolicyRules,
    'accrualType' | 'accrualFrequency' | 'hoursPerYear'
  >,
  startingBalanceHours: Record<string, number>,
  effectiveAt: Date,
  sourceKind: 'activation' | 'enrollment',
): NewLedgerRow[] {
  const fallback = defaultStartingBalance(rules);
  if (fallback === null) return [];
  return userIds.map((userId) => ({
    agencyId,
    policyId,
    userId,
    kind: 'allocation',
    hours: startingBalanceHours[userId.toString()] ?? fallback,
    effectiveAt,
    source: { kind: sourceKind, id: policyId },
  }));
}

function removalRow(
  agencyId: string,
  policyId: Types.ObjectId,
  userId: Types.ObjectId,
  effectiveAt: Date,
): NewLedgerRow {
  return {
    agencyId,
    policyId,
    userId,
    kind: 'removed_from_policy',
    hours: 0,
    effectiveAt,
    source: { kind: 'enrollment', id: policyId },
  };
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
): HrPolicySummary {
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
  if (row.type === 'time_off') {
    return { ...base, type: 'time_off', timeOff: timeOffRulesOf(row) };
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
