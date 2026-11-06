import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  eventAppliesTo,
  LIVE_TIME_OFF_REQUEST_STATUSES,
  roundHours,
  type AccessContext,
  type AgencyEventAudience,
  type AgencyEventAudienceOptions,
  type AgencyEventImpact,
  type AgencyEventImpactRow,
  type AgencyEventInput,
  type AgencyEventView,
  type TimeOffRequestStatus,
} from '@sfa/shared';
import { Model, Types } from 'mongoose';
import { Branch } from '../branches/schemas/branch.schema';
import { HomeBranchService } from '../common/hr/home-branch.service';
import {
  audienceOf,
  effectOf,
  type AgencyEventLean,
} from '../common/working-days/agency-events.reader';
import { TimeOffRequest } from '../time-off-requests/schemas/time-off-request.schema';
import {
  holdsReview,
  reviewsBranch,
} from '../time-off-requests/time-off-access';
import { User } from '../users/schemas/user.schema';
import { seesTeamLeave } from './hr-calendar-access';
import {
  AgencyEvent,
  type AgencyEventDocument,
} from './schemas/agency-event.schema';

type UserLean = {
  _id: Types.ObjectId;
  email: string;
  firstName?: string;
  lastName?: string;
  branchId?: Types.ObjectId;
};

type RequestLean = {
  _id: Types.ObjectId;
  reference?: string | null;
  employeeId?: Types.ObjectId | null;
  branchId: string;
  status?: TimeOffRequestStatus | null;
  firstDay: string;
  lastDay: string;
  days?: { date: string; hours: number }[];
};

function personName(
  user: Pick<UserLean, 'firstName' | 'lastName' | 'email'>,
): string {
  return (
    [user.firstName, user.lastName].filter(Boolean).join(' ').trim() ||
    user.email
  );
}

/**
 * Agency events (PAC-169): the dates an agency puts on its own calendar and
 * what they do to time off. Every method is agency-wide and every caller
 * holds `agency:hr:admin` — an event belongs to the agency, like a policy.
 *
 * ## Nothing else is written
 *
 * Saving a `blackout` or `day_off` event changes **no time off request**.
 * Requests already sent keep the hours they froze; the effect reaches the
 * next request through the working-day service and `evaluate()`. What an
 * admin gets instead is {@link impact}: the live requests the event runs
 * into, to cancel or adjust by hand (decided 2026-11-06).
 *
 * ## Impact is scoped
 *
 * `agency:hr:admin` is agency-wide, but whose leave a person may see is not:
 * a Branch Manager saving an agency-wide event must not be handed a list of
 * another branch's people on leave. A request the caller could not see on
 * the calendar is counted in `hiddenCount`, never listed.
 */
@Injectable()
export class AgencyEventsService {
  constructor(
    @InjectModel(AgencyEvent.name)
    private readonly events: Model<AgencyEventDocument>,
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(Branch.name) private readonly branches: Model<Branch>,
    @InjectModel(TimeOffRequest.name)
    private readonly requests: Model<TimeOffRequest>,
    private readonly homeBranches: HomeBranchService,
  ) {}

  // ── Reads ──────────────────────────────────────────────────────────────

  /** What the event form picks an audience from: every branch, every person not removed. */
  async audienceOptions(agencyId: string): Promise<AgencyEventAudienceOptions> {
    // `User.agencyId` / `Branch.agencyId` are ObjectIds, unlike the event's string.
    const agency = new Types.ObjectId(agencyId);
    const [branches, users] = await Promise.all([
      this.branches
        .find({ agencyId: agency })
        .select('name')
        .sort({ name: 1 })
        .lean<{ _id: Types.ObjectId; name: string }[]>(),
      this.users
        .find({
          agencyId: agency,
          deactivatedAt: null,
          isPlatformAdmin: { $ne: true },
        })
        .select('email firstName lastName branchId')
        .sort({ firstName: 1, lastName: 1, email: 1 })
        .lean<UserLean[]>(),
    ]);
    return {
      branches: branches.map((row) => ({
        id: row._id.toString(),
        name: row.name,
      })),
      people: users.map((user) => ({
        id: user._id.toString(),
        name: personName(user),
        branchId: user.branchId?.toString() ?? null,
      })),
    };
  }

  async get(agencyId: string, eventId: string): Promise<AgencyEventView> {
    const event = await this.find(agencyId, eventId);
    return (await this.views(agencyId, [event]))[0];
  }

  // ── Writes ─────────────────────────────────────────────────────────────

  async create(
    access: AccessContext,
    agencyId: string,
    input: AgencyEventInput,
  ): Promise<{ event: AgencyEventView; impact: AgencyEventImpact }> {
    await this.assertAudience(agencyId, input.audience);
    const created = await this.events.create({
      agencyId,
      ...this.stored(input),
    });
    const event = await this.get(agencyId, created._id.toString());
    return { event, impact: await this.impact(access, agencyId, input) };
  }

  async update(
    access: AccessContext,
    agencyId: string,
    eventId: string,
    input: AgencyEventInput,
  ): Promise<{ event: AgencyEventView; impact: AgencyEventImpact }> {
    await this.assertAudience(agencyId, input.audience);
    const updated = await this.events.findOneAndUpdate(
      { _id: new Types.ObjectId(eventId), agencyId, deletedAt: null },
      { $set: this.stored(input) },
      { new: true },
    );
    if (!updated) throw new NotFoundException('That event does not exist.');
    const event = await this.get(agencyId, eventId);
    return {
      event,
      impact: await this.impact(access, agencyId, input),
    };
  }

  /** Soft delete (PAC-155). A second call finds nothing: 404. */
  async remove(
    access: AccessContext,
    agencyId: string,
    eventId: string,
  ): Promise<void> {
    const removed = await this.events.findOneAndUpdate(
      { _id: new Types.ObjectId(eventId), agencyId, deletedAt: null },
      {
        $set: {
          deletedAt: new Date(),
          deletedBy: new Types.ObjectId(access.userId),
        },
      },
    );
    if (!removed) throw new NotFoundException('That event does not exist.');
  }

  // ── Impact ─────────────────────────────────────────────────────────────

  /**
   * The live requests (Submitted, Changes Requested, Approved) of people in
   * the event's audience that take hours on a day it blocks or closes.
   * Writes nothing. An event with no effect runs into nothing.
   */
  async impact(
    access: AccessContext,
    agencyId: string,
    input: AgencyEventInput,
  ): Promise<AgencyEventImpact> {
    if (input.effect === 'none') return { requests: [], hiddenCount: 0 };

    const rows = await this.requests
      .find({
        agencyId,
        status: { $in: LIVE_TIME_OFF_REQUEST_STATUSES },
        deletedAt: null,
        firstDay: { $lte: input.lastDay },
        lastDay: { $gte: input.firstDay },
        ...(input.audience.kind === 'people'
          ? {
              employeeId: {
                $in: input.audience.userIds.map((id) => new Types.ObjectId(id)),
              },
            }
          : {}),
      })
      .select('reference employeeId branchId status firstDay lastDay days')
      .sort({ firstDay: 1, _id: 1 })
      .lean<RequestLean[]>();

    const employeeIds = [
      ...new Set(
        rows.flatMap((row) =>
          row.employeeId ? [row.employeeId.toString()] : [],
        ),
      ),
    ];
    // An event for some branches reaches people by their home branch *today*,
    // not the branch a request was stamped with when it was made.
    const homeBranch =
      input.audience.kind === 'branches'
        ? await this.homeBranches.homeBranchIds(agencyId, employeeIds)
        : new Map<string, string | null>();

    const affected: { row: RequestLean; dates: string[]; hours: number }[] = [];
    for (const row of rows) {
      if (!row.employeeId) continue;
      const userId = row.employeeId.toString();
      if (
        !eventAppliesTo(input.audience, {
          userId,
          homeBranchId: homeBranch.get(userId) ?? null,
        })
      ) {
        continue;
      }
      const charged = (row.days ?? []).filter(
        (day) =>
          day.hours > 0 &&
          day.date >= input.firstDay &&
          day.date <= input.lastDay,
      );
      if (charged.length === 0) continue;
      affected.push({
        row,
        dates: charged.map((day) => day.date),
        hours: roundHours(charged.reduce((sum, day) => sum + day.hours, 0)),
      });
    }

    const visible = affected.filter(({ row }) => this.sees(access, row));
    const names = await this.names(
      agencyId,
      visible.map(({ row }) => (row.employeeId as Types.ObjectId).toString()),
    );
    const requests: AgencyEventImpactRow[] = visible.map(
      ({ row, dates, hours }) => {
        const employeeId = (row.employeeId as Types.ObjectId).toString();
        const mine = employeeId === access.userId;
        return {
          // Only the people `GET /time-off/requests/:id` would serve.
          requestId:
            mine || reviewsBranch(access, row.branchId)
              ? row._id.toString()
              : null,
          reference: row.reference ?? null,
          person: { id: employeeId, name: names.get(employeeId) ?? 'Someone' },
          status: row.status === 'approved' ? 'approved' : 'pending',
          firstDay: row.firstDay,
          lastDay: row.lastDay,
          dates,
          hours,
        };
      },
    );
    return { requests, hiddenCount: affected.length - visible.length };
  }

  /** The caller's own request, or one the calendar would show them. */
  private sees(access: AccessContext, row: RequestLean): boolean {
    if (row.employeeId?.toString() === access.userId) return true;
    if (!seesTeamLeave(access, row.branchId)) return false;
    return row.status === 'approved' || holdsReview(access);
  }

  // ── Views ──────────────────────────────────────────────────────────────

  /**
   * Events as the API returns them, each with a label for its audience:
   * "Everyone", one branch's or person's name, or a count. Two lookups for
   * any number of events.
   */
  async views(
    agencyId: string,
    events: readonly AgencyEventLean[],
  ): Promise<AgencyEventView[]> {
    const audiences = events.map((event) => audienceOf(event));
    // A label names a branch or a person only when it is the only one.
    const branchIds = audiences.flatMap((a) =>
      a.branchIds.length === 1 ? a.branchIds : [],
    );
    const userIds = audiences.flatMap((a) =>
      a.userIds.length === 1 ? a.userIds : [],
    );
    const [branchNames, userNames] = await Promise.all([
      this.branchNames(agencyId, branchIds),
      this.names(agencyId, userIds),
    ]);
    return events.map((event, index) => {
      const audience = audiences[index];
      return {
        id: event._id.toString(),
        name: event.name,
        description: event.description ?? null,
        firstDay: event.firstDay,
        lastDay: event.lastDay,
        startTime: event.startTime ?? null,
        endTime: event.endTime ?? null,
        effect: effectOf(event),
        audience,
        audienceLabel: audienceLabel(audience, branchNames, userNames),
      };
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private async find(
    agencyId: string,
    eventId: string,
  ): Promise<AgencyEventLean> {
    const event = await this.events
      .findOne({ _id: new Types.ObjectId(eventId), agencyId, deletedAt: null })
      .lean<AgencyEventLean | null>();
    if (!event) throw new NotFoundException('That event does not exist.');
    return event;
  }

  private stored(input: AgencyEventInput) {
    return {
      name: input.name,
      description: input.description,
      firstDay: input.firstDay,
      lastDay: input.lastDay,
      startTime: input.startTime,
      endTime: input.endTime,
      effect: input.effect,
      audience: {
        kind: input.audience.kind,
        branchIds: input.audience.branchIds,
        userIds: input.audience.userIds.map((id) => new Types.ObjectId(id)),
      },
    };
  }

  /** Every branch and person named must be this agency's. */
  private async assertAudience(
    agencyId: string,
    audience: AgencyEventAudience,
  ): Promise<void> {
    const agency = new Types.ObjectId(agencyId);
    if (audience.kind === 'branches') {
      const found = await this.branches.countDocuments({
        _id: { $in: audience.branchIds.map((id) => new Types.ObjectId(id)) },
        agencyId: agency,
      });
      if (found !== audience.branchIds.length) {
        throw new BadRequestException('One of those branches does not exist.');
      }
    }
    if (audience.kind === 'people') {
      const found = await this.users.countDocuments({
        _id: { $in: audience.userIds.map((id) => new Types.ObjectId(id)) },
        agencyId: agency,
        deactivatedAt: null,
        isPlatformAdmin: { $ne: true },
      });
      if (found !== audience.userIds.length) {
        throw new BadRequestException('One of those people does not exist.');
      }
    }
  }

  private async names(
    agencyId: string,
    userIds: readonly string[],
  ): Promise<Map<string, string>> {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return new Map();
    const users = await this.users
      .find({
        _id: { $in: ids.map((id) => new Types.ObjectId(id)) },
        agencyId: new Types.ObjectId(agencyId),
      })
      .select('email firstName lastName')
      .lean<UserLean[]>();
    return new Map(
      users.map((user) => [user._id.toString(), personName(user)]),
    );
  }

  private async branchNames(
    agencyId: string,
    branchIds: readonly string[],
  ): Promise<Map<string, string>> {
    const ids = [...new Set(branchIds)];
    if (ids.length === 0) return new Map();
    const rows = await this.branches
      .find({
        _id: { $in: ids.map((id) => new Types.ObjectId(id)) },
        agencyId: new Types.ObjectId(agencyId),
      })
      .select('name')
      .lean<{ _id: Types.ObjectId; name: string }[]>();
    return new Map(rows.map((row) => [row._id.toString(), row.name]));
  }
}

function audienceLabel(
  audience: AgencyEventAudience,
  branchNames: Map<string, string>,
  userNames: Map<string, string>,
): string {
  if (audience.kind === 'agency') return 'Everyone';
  if (audience.kind === 'branches') {
    return audience.branchIds.length === 1
      ? (branchNames.get(audience.branchIds[0]) ?? '1 branch')
      : `${audience.branchIds.length} branches`;
  }
  return audience.userIds.length === 1
    ? (userNames.get(audience.userIds[0]) ?? '1 person')
    : `${audience.userIds.length} people`;
}
