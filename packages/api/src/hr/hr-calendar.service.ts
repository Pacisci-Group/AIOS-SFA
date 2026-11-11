import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  AgencyPermission,
  DataScope,
  eventAppliesTo,
  holidaysBetween,
  leaveEventConflicts,
  LIVE_TIME_OFF_REQUEST_STATUSES,
  mergeHolidays,
  yearlyOccurrences,
  type AccessContext,
  type CustomHoliday,
  type HolidayKey,
  type HolidayRow,
  type HrCalendarEntry,
  type HrCalendarEventEntry,
  type HrCalendarFilters,
  type HrCalendarHolidayPolicy,
  type HrCalendarLeaveEntry,
  type HrCalendarResponse,
  type TimeOffDayMode,
  type TimeOffRequestStatus,
} from '@sfa/shared';
import { type FilterQuery, Model, Types } from 'mongoose';
import { Branch } from '../branches/schemas/branch.schema';
import { HomeBranchService } from '../common/hr/home-branch.service';
import {
  AgencyEventsReader,
  audienceOf,
  effectOf,
  type AgencyEventLean,
} from '../common/working-days/agency-events.reader';
import { TimeOffRequest } from '../time-off-requests/schemas/time-off-request.schema';
import { reviewsBranch } from '../time-off-requests/time-off-access';
import { User } from '../users/schemas/user.schema';
import { AgencyEventsService } from './agency-events.service';
import type { HrCalendarQueryDto } from './dto/hr-calendar.dto';
import { seesTeamPending, teamLeaveFilter } from './hr-calendar-access';
import { EmployeeProfile } from './schemas/employee-profile.schema';
import { HolidayPolicy } from './schemas/holiday-policy.schema';
import { TimeOffPolicy } from './schemas/time-off-policy.schema';

/** Someone in the agency, with the branch they belong to for HR. */
interface Person {
  id: string;
  name: string;
  /** Their own branch, or the agency's default for someone with none. */
  homeBranchId: string | null;
}

type RequestLean = {
  _id: Types.ObjectId;
  reference?: string | null;
  employeeId?: Types.ObjectId | null;
  branchId: string;
  policyId?: Types.ObjectId | null;
  status?: TimeOffRequestStatus | null;
  firstDay: string;
  lastDay: string;
  dayMode?: TimeOffDayMode | null;
  days?: { date: string; hours: number; scheduledHours: number }[];
  totalHours?: number;
};

const KIND_ORDER: Record<HrCalendarEntry['kind'], number> = {
  holiday: 0,
  event: 1,
  leave: 2,
  birthday: 3,
  anniversary: 4,
};

/**
 * The HR calendar (PAC-169): one read that turns a range of days into typed
 * entries — holidays, the agency's events, time off, birthdays and work
 * anniversaries — already cut down to what the caller may see.
 *
 * ## Who sees what
 *
 * Every caller holds `hr:read`. On top of that:
 *
 * | Layer | Rule |
 * |---|---|
 * | **Time off** | The caller's own live requests, always. Other people's only with `agency:hr:team_calendar`, within their data scope (`hr-calendar-access.ts`): Approved for any holder, pending too for one who is also a reviewer. |
 * | **Holidays** | The Holiday policies of the *people in view*: the caller alone, or everyone in their scope for a holder. One entry per name and run of days. |
 * | **Events** | The ones whose audience includes the caller; all of them for `agency:hr:admin`, who manages them. |
 * | **Birthdays** | Everyone active who has not opted out (`showBirthday`). The **occurrence date only** — never the year, never an age. |
 * | **Anniversaries** | Everyone active with a hire date, from the first year on. |
 *
 * Birthdays and anniversaries are agency-wide for every employee on purpose
 * (decided 2026-11-06): they are what `showBirthday` was added for. That is
 * the one place this read is wider than the People profile, which shows a
 * date of birth to the person and HR admins only — and it is the month and
 * day, with the person able to switch it off.
 *
 * ## A leave entry is "who is out", not "why"
 *
 * `detail` — the policy, the hours, the request to open — is filled only
 * for the employee and for a reviewer whose scope covers the request, the
 * same people `GET /time-off/requests/:id` serves. A team-calendar holder
 * who is not a reviewer learns that Sam is out on those days and nothing
 * else: a Sick policy name is health information.
 *
 * ## Stamped branch vs home branch
 *
 * Leave is scoped on the branch **stamped on the request** when it was made,
 * the rule the team list uses. People — for the filters, the holiday layer
 * and an event's branch audience — are placed by their **home branch today**.
 * The two differ only for someone who has moved branch since asking.
 */
@Injectable()
export class HrCalendarService {
  constructor(
    @InjectModel(TimeOffRequest.name)
    private readonly requests: Model<TimeOffRequest>,
    @InjectModel(TimeOffPolicy.name)
    private readonly timeOffPolicies: Model<TimeOffPolicy>,
    @InjectModel(HolidayPolicy.name)
    private readonly holidayPolicies: Model<HolidayPolicy>,
    @InjectModel(EmployeeProfile.name)
    private readonly profiles: Model<EmployeeProfile>,
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(Branch.name) private readonly branches: Model<Branch>,
    private readonly events: AgencyEventsReader,
    private readonly eventViews: AgencyEventsService,
    private readonly homeBranches: HomeBranchService,
  ) {}

  async read(
    access: AccessContext,
    agencyId: string,
    query: HrCalendarQueryDto,
  ): Promise<HrCalendarResponse> {
    const { from, to } = query;
    const managesEvents = access.permissions.includes(AgencyPermission.HrAdmin);
    const teamFilter = teamLeaveFilter(access);
    const seesPending = seesTeamPending(access);

    const [people, events] = await Promise.all([
      this.people(agencyId),
      this.events.inRange(agencyId, from, to),
    ]);
    const me = people.get(access.userId) ?? null;
    const inFilter = (person: Person) =>
      (query.employeeIds.length === 0 ||
        query.employeeIds.includes(person.id)) &&
      (query.branchIds.length === 0 ||
        (person.homeBranchId !== null &&
          query.branchIds.includes(person.homeBranchId)));

    const [
      leave,
      { entries: holidays, policies: holidayPolicies },
      dates,
      eventEntries,
    ] = await Promise.all([
      this.leave(
        access,
        agencyId,
        query,
        people,
        events,
        teamFilter,
        seesPending,
      ),
      this.holidays(
        agencyId,
        access.userId,
        this.inView(access, people, teamFilter !== null).filter(inFilter),
        people,
        from,
        to,
      ),
      this.dates(agencyId, [...people.values()].filter(inFilter), from, to),
      this.eventEntries(agencyId, events, me, access.userId, managesEvents),
    ]);

    const entries: HrCalendarEntry[] = [
      ...holidays,
      ...eventEntries,
      ...leave,
      ...dates,
    ].sort(
      (a, b) =>
        a.firstDay.localeCompare(b.firstDay) ||
        KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
        a.id.localeCompare(b.id),
    );
    return {
      from,
      to,
      viewer: { seesTeam: teamFilter !== null, seesPending, managesEvents },
      entries,
      holidayPolicies,
    };
  }

  /**
   * What the page's branch and employee filters offer: the people whose
   * leave the caller may see, and the branches they are in. Empty for
   * someone who sees only their own — there is nothing to narrow.
   */
  async filters(
    access: AccessContext,
    agencyId: string,
  ): Promise<HrCalendarFilters> {
    if (teamLeaveFilter(access) === null) return { branches: [], people: [] };
    const people = this.inView(access, await this.people(agencyId), true);
    const branchIds = [
      ...new Set(
        people.flatMap((person) =>
          person.homeBranchId ? [person.homeBranchId] : [],
        ),
      ),
    ];
    const rows = branchIds.length
      ? await this.branches
          .find({
            _id: { $in: branchIds.map((id) => new Types.ObjectId(id)) },
            agencyId: new Types.ObjectId(agencyId),
          })
          .select('name')
          .sort({ name: 1 })
          .lean<{ _id: Types.ObjectId; name: string }[]>()
      : [];
    return {
      branches: rows.map((row) => ({ id: row._id.toString(), name: row.name })),
      people: people.map((person) => ({
        id: person.id,
        name: person.name,
        branchId: person.homeBranchId,
      })),
    };
  }

  // ── People ─────────────────────────────────────────────────────────────

  /** Everyone in the agency who has not been removed, by id, name order. */
  private async people(agencyId: string): Promise<Map<string, Person>> {
    // `User.agencyId` is an ObjectId, unlike the HR collections' string.
    const users = await this.users
      .find({
        agencyId: new Types.ObjectId(agencyId),
        deactivatedAt: null,
        isPlatformAdmin: { $ne: true },
      })
      .select('email firstName lastName branchId')
      .sort({ firstName: 1, lastName: 1, email: 1 })
      .lean<
        {
          _id: Types.ObjectId;
          email: string;
          firstName?: string;
          lastName?: string;
          branchId?: Types.ObjectId;
        }[]
      >();
    const fallback = users.some((user) => !user.branchId)
      ? await this.homeBranches.defaultBranchId(agencyId)
      : null;
    return new Map(
      users.map((user) => {
        const id = user._id.toString();
        return [
          id,
          {
            id,
            name:
              [user.firstName, user.lastName]
                .filter(Boolean)
                .join(' ')
                .trim() || user.email,
            homeBranchId: user.branchId ? user.branchId.toString() : fallback,
          },
        ];
      }),
    );
  }

  /**
   * The people whose leave the caller's scope reaches, themself included:
   * everyone for an agency scope, their branch for a branch one, only
   * themself without the team calendar.
   */
  private inView(
    access: AccessContext,
    people: Map<string, Person>,
    seesTeam: boolean,
  ): Person[] {
    const me = people.get(access.userId);
    if (!seesTeam) return me ? [me] : [];
    return [...people.values()].filter(
      (person) =>
        person.id === access.userId ||
        access.dataScope === DataScope.Agency ||
        (access.branchId != null && person.homeBranchId === access.branchId),
    );
  }

  // ── Time off ───────────────────────────────────────────────────────────

  private async leave(
    access: AccessContext,
    agencyId: string,
    query: HrCalendarQueryDto,
    people: Map<string, Person>,
    events: readonly AgencyEventLean[],
    teamFilter: FilterQuery<{ branchId: string }> | null,
    seesPending: boolean,
  ): Promise<HrCalendarLeaveEntry[]> {
    const me = new Types.ObjectId(access.userId);
    // Legacy imported rows have no `status`, so the status clause is also
    // what keeps them out; drafts are nobody's but their author's form.
    const whose: FilterQuery<TimeOffRequest>[] = [
      { employeeId: me, status: { $in: LIVE_TIME_OFF_REQUEST_STATUSES } },
    ];
    if (teamFilter) {
      whose.push({
        ...teamFilter,
        employeeId: { $ne: me },
        status: seesPending
          ? { $in: LIVE_TIME_OFF_REQUEST_STATUSES }
          : 'approved',
      });
    }
    const narrowed: FilterQuery<TimeOffRequest>[] = [];
    if (query.employeeIds.length) {
      narrowed.push({
        employeeId: {
          $in: query.employeeIds.map((id) => new Types.ObjectId(id)),
        },
      });
    }
    if (query.branchIds.length) {
      narrowed.push({ branchId: { $in: query.branchIds } });
    }
    const rows = await this.requests
      .find({
        agencyId,
        deletedAt: null,
        firstDay: { $lte: query.to },
        lastDay: { $gte: query.from },
        $and: [{ $or: whose }, ...narrowed],
      })
      .select(
        'reference employeeId branchId policyId status firstDay lastDay dayMode days totalHours',
      )
      .sort({ firstDay: 1, _id: 1 })
      .lean<RequestLean[]>();

    const opened = rows.filter(
      (row) =>
        row.employeeId?.toString() === access.userId ||
        reviewsBranch(access, row.branchId),
    );
    const policyNames = await this.policyNames(
      agencyId,
      opened.flatMap((row) => (row.policyId ? [row.policyId] : [])),
    );

    return rows.flatMap((row): HrCalendarLeaveEntry[] => {
      if (!row.employeeId) return [];
      const employeeId = row.employeeId.toString();
      const person = people.get(employeeId);
      const mine = employeeId === access.userId;
      const openable = mine || reviewsBranch(access, row.branchId);
      return [
        {
          id: `leave:${row._id.toString()}`,
          kind: 'leave',
          firstDay: row.firstDay,
          lastDay: row.lastDay,
          person: { id: employeeId, name: person?.name ?? 'Someone' },
          mine,
          status: row.status === 'approved' ? 'approved' : 'pending',
          partial:
            row.dayMode === 'partial' ||
            (row.days ?? []).some(
              (day) => day.hours > 0 && day.hours < day.scheduledHours,
            ),
          detail: openable
            ? {
                requestId: row._id.toString(),
                reference: row.reference ?? null,
                policyName: row.policyId
                  ? (policyNames.get(row.policyId.toString()) ?? null)
                  : null,
                totalHours: row.totalHours ?? 0,
                conflicts: leaveEventConflicts(
                  row.days ?? [],
                  events
                    .filter((event) =>
                      eventAppliesTo(audienceOf(event), {
                        userId: employeeId,
                        homeBranchId: person?.homeBranchId ?? null,
                      }),
                    )
                    .map((event) => ({
                      id: event._id.toString(),
                      name: event.name,
                      effect: effectOf(event),
                      firstDay: event.firstDay,
                      lastDay: event.lastDay,
                    })),
                ),
              }
            : null,
        },
      ];
    });
  }

  private async policyNames(
    agencyId: string,
    policyIds: readonly Types.ObjectId[],
  ): Promise<Map<string, string>> {
    if (policyIds.length === 0) return new Map();
    const rows = await this.timeOffPolicies
      .find({ _id: { $in: [...policyIds] }, agencyId })
      .select('name')
      .lean<{ _id: Types.ObjectId; name: string }[]>();
    return new Map(rows.map((row) => [row._id.toString(), row.name]));
  }

  // ── Holidays ───────────────────────────────────────────────────────────

  /**
   * The closures of every active Holiday policy that holds someone in view.
   * Computed by rule (`holidaysBetween`), not read: a policy stores which
   * holidays, never dates.
   */
  private async holidays(
    agencyId: string,
    viewerId: string,
    inView: readonly Person[],
    people: Map<string, Person>,
    from: string,
    to: string,
  ): Promise<{
    entries: HrCalendarEntry[];
    policies: HrCalendarHolidayPolicy[];
  }> {
    if (inView.length === 0) return { entries: [], policies: [] };
    const policies = await this.holidayPolicies
      .find({
        agencyId,
        archivedAt: null,
        memberIds: {
          $in: inView.map((person) => new Types.ObjectId(person.id)),
        },
      })
      .select('name holidays customHolidays memberIds')
      .lean<
        {
          _id: Types.ObjectId;
          name: string;
          holidays?: HolidayKey[];
          customHolidays?: CustomHoliday[];
          memberIds?: Types.ObjectId[];
        }[]
      >();
    const rows: HolidayRow[] = policies.flatMap((policy) => {
      const mine = (policy.memberIds ?? []).some(
        (id) => id.toString() === viewerId,
      );
      return holidaysBetween(
        {
          holidays: policy.holidays ?? [],
          customHolidays: policy.customHolidays ?? [],
        },
        from,
        to,
      ).map((row) => ({
        date: row.date,
        name: row.name,
        observedFor: row.observedFor,
        policy: { id: policy._id.toString(), name: policy.name },
        mine,
      }));
    });
    const entries = mergeHolidays(rows);
    // The people of each policy an entry names — by name, not by scope:
    // who shares your holidays is not leave, and the birthday layer already
    // puts every colleague's name on this page.
    const named = new Set(
      entries.flatMap((entry) =>
        entry.kind === 'holiday'
          ? entry.policies.map((policy) => policy.id)
          : [],
      ),
    );
    const withPeople: HrCalendarHolidayPolicy[] = policies
      .filter((policy) => named.has(policy._id.toString()))
      .map((policy) => ({
        id: policy._id.toString(),
        name: policy.name,
        members: (policy.memberIds ?? [])
          .flatMap((id) => {
            const person = people.get(id.toString());
            return person ? [{ id: person.id, name: person.name }] : [];
          })
          .sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { entries, policies: withPeople };
  }

  // ── Events ─────────────────────────────────────────────────────────────

  private async eventEntries(
    agencyId: string,
    events: readonly AgencyEventLean[],
    me: Person | null,
    viewerId: string,
    managesEvents: boolean,
  ): Promise<HrCalendarEventEntry[]> {
    const viewer = { userId: viewerId, homeBranchId: me?.homeBranchId ?? null };
    const mine = new Set(
      events
        .filter((event) => eventAppliesTo(audienceOf(event), viewer))
        .map((event) => event._id.toString()),
    );
    const shown = events.filter(
      (event) => managesEvents || mine.has(event._id.toString()),
    );
    const views = await this.eventViews.views(agencyId, shown);
    return views.map((view) => ({
      id: `event:${view.id}`,
      kind: 'event',
      firstDay: view.firstDay,
      lastDay: view.lastDay,
      eventId: view.id,
      name: view.name,
      description: view.description,
      startTime: view.startTime,
      endTime: view.endTime,
      effect: view.effect,
      // The label, never the id lists: those are the edit form's
      // (`GET /hr/events/:eventId`, `agency:hr:admin`).
      audienceLabel: view.audienceLabel,
      appliesToMe: mine.has(view.id),
    }));
  }

  // ── Birthdays and anniversaries ────────────────────────────────────────

  private async dates(
    agencyId: string,
    people: readonly Person[],
    from: string,
    to: string,
  ): Promise<HrCalendarEntry[]> {
    if (people.length === 0) return [];
    const byId = new Map(people.map((person) => [person.id, person]));
    const profiles = await this.profiles
      .find({
        agencyId,
        status: 'active',
        userId: { $in: people.map((person) => new Types.ObjectId(person.id)) },
      })
      .select('userId hireDate dateOfBirth showBirthday')
      .lean<
        {
          userId: Types.ObjectId;
          hireDate?: string | null;
          dateOfBirth?: string | null;
          showBirthday?: boolean;
        }[]
      >();

    const entries: HrCalendarEntry[] = [];
    for (const profile of profiles) {
      const person = byId.get(profile.userId.toString());
      if (!person) continue;
      const ref = { id: person.id, name: person.name };
      // `.lean()` applies no default: a row without the flag is opted in.
      if (profile.dateOfBirth && (profile.showBirthday ?? true)) {
        for (const { date } of yearlyOccurrences(
          profile.dateOfBirth,
          from,
          to,
        )) {
          // The day only. The year of birth, and so the age, never leaves here.
          entries.push({
            id: `birthday:${person.id}:${date}`,
            kind: 'birthday',
            firstDay: date,
            lastDay: date,
            person: ref,
          });
        }
      }
      if (profile.hireDate) {
        for (const { date, years } of yearlyOccurrences(
          profile.hireDate,
          from,
          to,
        )) {
          if (years < 1) continue;
          entries.push({
            id: `anniversary:${person.id}:${date}`,
            kind: 'anniversary',
            firstDay: date,
            lastDay: date,
            person: ref,
            years,
          });
        }
      }
    }
    return entries;
  }
}
