import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  balanceLines,
  calendarDaysInclusive,
  canTransition,
  evaluateAutoApproval,
  formatTimeOffRequestRef,
  hoursByDate,
  LIVE_TIME_OFF_REQUEST_STATUSES,
  overlappingDates,
  periodStartFor,
  projectLeave,
  RECORD_WARNING_CODES,
  requestActions,
  requestDays,
  requestGroup,
  TIME_OFF_REQUEST_MAX_AHEAD_DAYS,
  TIME_OFF_REQUEST_MAX_SPAN_DAYS,
  totalRequestHours,
  usageAllowedFrom,
  type AccessContext,
  type NotificationType,
  type TimeOffBalanceLines,
  type TimeOffCheck,
  type TimeOffCheckCode,
  type TimeOffPolicyRef,
  type TimeOffPolicyRules,
  type TimeOffPreview,
  type TimeOffProjectionView,
  type TimeOffRequestAction,
  type TimeOffRequestDay,
  type TimeOffRequestGroup,
  type TimeOffRequestList,
  type TimeOffRequestRow,
  type TimeOffRequestStatus,
  type TimeOffRequestView,
  type TimeOffSummary,
  type TimeOffTimelineAction,
} from '@sfa/shared';
import { ClientSession, FilterQuery, Model, Types } from 'mongoose';
import { Branch } from '../branches/schemas/branch.schema';
import { businessDateInstant } from '../common/dates/business-dates';
import { escapeRegex } from '../common/mongo/escape-regex';
import { SequenceService } from '../common/mongo/sequence.service';
import { TransactionRunner } from '../common/mongo/transaction.runner';
import { LeaveLedgerService } from '../common/time-off/leave-ledger.service';
import {
  TimeOffBalanceService,
  type TimeOffPosition,
} from '../common/time-off/time-off-balance.service';
import {
  timeOffRulesOf,
  type TimeOffFieldsLean,
} from '../common/time-off/time-off-policy.lean';
import {
  calendarDate,
  scheduledDaysBetween,
} from '../common/working-days/working-days';
import { WorkingDaysService } from '../common/working-days/working-days.service';
import {
  TimeOffPolicy,
  type TimeOffPolicyDocument,
} from '../hr/schemas/time-off-policy.schema';
import { notificationRequested } from '../inngest/events';
import { InngestService } from '../inngest/inngest.service';
import {
  addDays,
  agencyTodayIso,
  parseIsoDate,
  toIsoDate,
} from '../performance/performance.range';
import { User, type UserDocument } from '../users/schemas/user.schema';
import type {
  ListMyTimeOffRequestsDto,
  ListTeamTimeOffRequestsDto,
  TimeOffRequestDto,
} from './dto/time-off.dto';
import {
  TimeOffRequest,
  type TimeOffRequestDocument,
  type TimeOffTimelineEntry,
} from './schemas/time-off-request.schema';
import { reviewsBranch, reviewScopeFilter } from './time-off-access';
import { TimeOffReviewersService } from './time-off-reviewers.service';

type RequestLean = TimeOffRequest & { _id: Types.ObjectId };

type PolicyLean = TimeOffFieldsLean & {
  _id: Types.ObjectId;
  name: string;
  memberIds?: Types.ObjectId[];
  archivedAt?: Date | null;
};

type UserLean = {
  _id: Types.ObjectId;
  email: string;
  firstName?: string;
  lastName?: string;
  branchId?: Types.ObjectId;
  isActive: boolean;
  deactivatedAt?: Date | null;
};

/** The four inputs of a request, as the form sends them. */
type RequestInput = Pick<
  TimeOffRequestDto,
  'policyId' | 'firstDay' | 'lastDay' | 'dayMode' | 'hours'
> & { note?: string | null };

/** What a request amounts to and whether it may be sent. */
interface Evaluation {
  policy: PolicyLean;
  rules: TimeOffPolicyRules;
  days: TimeOffRequestDay[];
  totalHours: number;
  balance: TimeOffBalanceLines | null;
  projection: TimeOffProjectionView | null;
  /** What the auto-approval rule reads; null on an Unlimited policy. */
  lowestBalance: number | null;
  blockers: TimeOffCheck[];
  warnings: TimeOffCheck[];
}

const USER_FIELDS = 'email firstName lastName branchId isActive deactivatedAt';

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** `2026-11-12` → `Nov 12, 2026`, read as written. */
function formatDay(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  return `${MONTHS[month - 1]} ${day}, ${year}`;
}

function personName(
  user: Pick<UserLean, 'firstName' | 'lastName' | 'email'>,
): string {
  return (
    [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email
  );
}

function addDaysIso(iso: string, days: number): string {
  return toIsoDate(addDays(parseIsoDate(iso), days));
}

/** A refusal a client can switch on: the `code`, never the wording. */
function refusal(
  status: 400 | 403 | 409,
  code: TimeOffCheckCode,
  message: string,
  extra: Record<string, unknown> = {},
): HttpException {
  const body = { statusCode: status, code, message, ...extra };
  if (status === 403)
    return new ForbiddenException({ ...body, error: 'Forbidden' });
  if (status === 409)
    return new ConflictException({ ...body, error: 'Conflict' });
  return new BadRequestException({ ...body, error: 'Bad Request' });
}

/**
 * Time off requests (PAC-165): the lifecycle Draft → Submitted → Changes
 * Requested / Approved / Declined / Cancelled, and the ledger rows it posts.
 *
 * ## One evaluation, three uses
 *
 * {@link evaluate} turns "this person, this policy, these dates" into the
 * per-date hours, the balance lines and the list of things wrong with it.
 * The preview returns that list to the form; sending refuses on it; a
 * recorded entry downgrades three of the checks to warnings. The rules are
 * therefore written once, and the form cannot promise what sending refuses.
 *
 * ## Who
 *
 * - The **employee** makes, edits, sends, withdraws and (until the day
 *   before it starts) cancels their own request.
 * - A **reviewer** holds `hr:write` and a data scope covering the request's
 *   branch (`time-off-access.ts`). They decide a Submitted request and may
 *   cancel Approved leave.
 * - **Nobody decides their own request** — checked on every decision, since
 *   a Branch Manager is both an employee and a reviewer.
 * - Someone holding only `hr:read` sees their own requests and nothing
 *   else, whatever their data scope.
 *
 * ## First decision wins
 *
 * Every transition is a conditional update on the status it expects. Two
 * reviewers deciding at once: one update matches, the other finds nothing
 * and answers `409` with the record as it now stands.
 *
 * ## Ledger
 *
 * Approving (by a reviewer, by the policy's rules, or by recording) posts
 * `used` rows; cancelling approved leave posts mirror `reversal` rows. The
 * status claim and the ledger rows commit together (`TransactionRunner`), so
 * a request is never Approved with no hours posted, or the reverse.
 * Notifications go out **after** the commit: the transaction callback can
 * re-run, and an emitted event cannot be rolled back.
 *
 * `TransactionRunner`'s no-replica-set fallback only deletes documents a
 * unit of work created; it cannot undo a status change. That path exists
 * for a developer's stale Mongo container and is never how this runs.
 */
@Injectable()
export class TimeOffRequestsService {
  private readonly logger = new Logger(TimeOffRequestsService.name);

  constructor(
    @InjectModel(TimeOffRequest.name)
    private readonly requests: Model<TimeOffRequestDocument>,
    @InjectModel(TimeOffPolicy.name)
    private readonly policies: Model<TimeOffPolicyDocument>,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(Branch.name) private readonly branches: Model<Branch>,
    private readonly ledger: LeaveLedgerService,
    private readonly balance: TimeOffBalanceService,
    private readonly workingDays: WorkingDaysService,
    private readonly sequences: SequenceService,
    private readonly transactions: TransactionRunner,
    private readonly inngest: InngestService,
    private readonly reviewers: TimeOffReviewersService,
  ) {}

  // ── Reads ──────────────────────────────────────────────────────────────

  /** The employee's cards: a balance per policy they are in. */
  async summary(
    access: AccessContext,
    agencyId: string,
  ): Promise<TimeOffSummary> {
    const me = await this.requireUser(agencyId, access.userId);
    const rows = await this.policies
      .find({ agencyId, archivedAt: null, memberIds: me._id })
      .sort({ createdAt: 1 })
      .lean<PolicyLean[]>();

    const policies: TimeOffSummary['policies'] = [];
    for (const row of rows) {
      const rules = timeOffRulesOf(row);
      const position = await this.balance.position({
        agencyId,
        policyId: row._id,
        rules,
        userId: me._id,
        timeZone: access.timeZone,
      });
      policies.push({
        ...policyRef(row),
        currentBalance: position?.currentBalance ?? null,
        otherRequestedHours: position?.otherRequestedHours ?? null,
        availableHours: position?.availableHours ?? null,
      });
    }
    const reviewers = await this.reviewers.reviewersFor(
      agencyId,
      await this.homeBranchId(agencyId, me),
      [access.userId],
    );
    return { policies, reviewerCount: reviewers.length };
  }

  /** The caller's own requests — pinned to them, whatever their data scope. */
  async listMine(
    access: AccessContext,
    agencyId: string,
    query: ListMyTimeOffRequestsDto,
  ): Promise<TimeOffRequestList> {
    const today = agencyTodayIso(access.timeZone);
    const filter: FilterQuery<TimeOffRequestDocument> = {
      agencyId,
      employeeId: new Types.ObjectId(access.userId),
      deletedAt: null,
      ...groupFilter(query.group, today),
    };
    return this.page(filter, { firstDay: -1, createdAt: -1 }, query, today);
  }

  /**
   * The requests of everyone the caller reviews. Never a draft (nobody sees
   * another person's), never the caller's own (those are under My time off
   * and are not theirs to decide). No group means To review.
   */
  async listTeam(
    access: AccessContext,
    agencyId: string,
    query: ListTeamTimeOffRequestsDto,
  ): Promise<TimeOffRequestList> {
    const today = agencyTodayIso(access.timeZone);
    const scope = reviewScopeFilter(access);
    const empty = {
      items: [],
      total: 0,
      page: query.page,
      pageSize: query.pageSize,
    };
    if (!scope) return empty;

    const self = new Types.ObjectId(access.userId);
    const groups = query.group ?? ['pending'];
    const filter: FilterQuery<TimeOffRequestDocument> = {
      agencyId,
      deletedAt: null,
      employeeId: { $ne: self },
      ...scope,
      ...groupFilter(groups, today),
    };
    if (query.policyId) filter.policyId = new Types.ObjectId(query.policyId);

    let allowed: Types.ObjectId[] | null = null;
    if (query.q) allowed = await this.usersNamed(agencyId, query.q);
    if (query.employeeId) {
      const wanted = new Types.ObjectId(query.employeeId);
      allowed = allowed ? allowed.filter((id) => id.equals(wanted)) : [wanted];
    }
    if (allowed) {
      const ids = allowed.filter((id) => !id.equals(self));
      if (ids.length === 0) return empty;
      filter.employeeId = { $in: ids };
    }

    // Work waiting is read oldest first; history newest first.
    const waiting = groups.every((group) => group === 'pending');
    return this.page(
      filter,
      waiting ? { submittedAt: 1, _id: 1 } : { firstDay: -1, _id: -1 },
      query,
      today,
    );
  }

  async get(
    access: AccessContext,
    agencyId: string,
    requestId: string,
  ): Promise<TimeOffRequestView> {
    const doc = await this.visible(access, agencyId, requestId);
    return this.toView(access, agencyId, doc);
  }

  // ── Preview ────────────────────────────────────────────────────────────

  /** What a self request would amount to. Writes nothing. */
  async preview(
    access: AccessContext,
    agencyId: string,
    input: RequestInput & { requestId?: string },
  ): Promise<TimeOffPreview> {
    const me = await this.requireUser(agencyId, access.userId);
    const evaluation = await this.evaluate({
      agencyId,
      employee: me,
      input,
      mode: 'self',
      timeZone: access.timeZone,
      excludeRequestId: input.requestId
        ? new Types.ObjectId(input.requestId)
        : null,
    });
    return toPreview(evaluation);
  }

  // ── The employee's writes ──────────────────────────────────────────────

  /** Save a Draft, or send a new request straight away. */
  async create(
    access: AccessContext,
    agencyId: string,
    input: RequestInput & { send: boolean },
  ): Promise<TimeOffRequestView> {
    const me = await this.requireUser(agencyId, access.userId);
    if (input.send) {
      const sent = await this.send(access, agencyId, me, input, null);
      return this.toView(access, agencyId, sent);
    }

    // A draft is not checked: it holds no hours against anything and
    // notifies nobody. The hours stored are provisional — sending recomputes.
    const evaluation = await this.evaluate({
      agencyId,
      employee: me,
      input,
      mode: 'self',
      timeZone: access.timeZone,
    });
    const now = new Date();
    const created = await this.requests.create({
      agencyId,
      branchId: await this.homeBranchId(agencyId, me),
      reference: await this.nextReference(agencyId, access.timeZone, now),
      source: 'self',
      employeeId: me._id,
      initiatorId: me._id,
      status: 'draft',
      ...requestFields(input, evaluation),
      timeline: [entry(now, me._id, 'created', null, 'draft')],
    });
    return this.toView(access, agencyId, created.toObject());
  }

  /** Edit a Draft, or a request sent back for changes. Sends nothing. */
  async update(
    access: AccessContext,
    agencyId: string,
    requestId: string,
    input: RequestInput,
  ): Promise<TimeOffRequestView> {
    const { doc, me } = await this.ownEditable(access, agencyId, requestId);
    const evaluation = await this.evaluate({
      agencyId,
      employee: me,
      input,
      mode: 'self',
      timeZone: access.timeZone,
      excludeRequestId: doc._id,
    });
    const updated = await this.requests
      .findOneAndUpdate(
        { _id: doc._id, agencyId, status: doc.status, deletedAt: null },
        { $set: requestFields(input, evaluation) },
        { new: true },
      )
      .lean<RequestLean | null>();
    if (!updated) throw await this.alreadyDecided(access, agencyId, doc._id);
    return this.toView(access, agencyId, updated);
  }

  /**
   * Send a Draft, or resend one sent back for changes. With a body the
   * edited form is saved and sent in one step; without, the request goes as
   * it is stored. Either way the hours are recomputed and frozen now.
   */
  async submit(
    access: AccessContext,
    agencyId: string,
    requestId: string,
    input: RequestInput | null,
  ): Promise<TimeOffRequestView> {
    const { doc, me } = await this.ownEditable(access, agencyId, requestId);
    const sent = await this.send(
      access,
      agencyId,
      me,
      input ?? storedInput(doc),
      doc,
    );
    return this.toView(access, agencyId, sent);
  }

  /**
   * Throw a draft away. The row stays, stamped deleted, and leaves every
   * read (decided 2026-11-05) — nothing is ever removed.
   */
  async discard(
    access: AccessContext,
    agencyId: string,
    requestId: string,
  ): Promise<void> {
    const doc = await this.visible(access, agencyId, requestId);
    if (!this.isEmployee(access, doc))
      throw new NotFoundException('That request does not exist.');
    const result = await this.requests.updateOne(
      { _id: doc._id, agencyId, status: 'draft', deletedAt: null },
      {
        $set: {
          deletedAt: new Date(),
          deletedBy: new Types.ObjectId(access.userId),
        },
      },
    );
    if (result.modifiedCount === 0) {
      throw refusal(
        409,
        'already_decided',
        'Only a draft can be discarded. Cancel the request instead.',
      );
    }
  }

  // ── Cancel ─────────────────────────────────────────────────────────────

  /**
   * The employee withdraws an undecided request at any time and cancels
   * Approved leave until the day before it starts; a reviewer cancels
   * someone else's Approved leave at any time, with a note. Cancelling
   * Approved leave posts the mirror `reversal` rows.
   */
  async cancel(
    access: AccessContext,
    agencyId: string,
    requestId: string,
    note: string | null,
  ): Promise<TimeOffRequestView> {
    const doc = await this.visible(access, agencyId, requestId);
    const today = agencyTodayIso(access.timeZone);
    const isEmployee = this.isEmployee(access, doc);
    this.assertActionable(doc);

    const actions = requestActions(doc, this.viewer(access, doc), today);
    if (!actions.includes('cancel')) {
      throw refusal(
        409,
        'already_decided',
        isEmployee && doc.status === 'approved'
          ? 'Approved leave can be cancelled until the day before it starts. Ask a reviewer to cancel it.'
          : 'This request can no longer be cancelled.',
        { request: await this.toView(access, agencyId, doc) },
      );
    }
    if (!isEmployee && !note) {
      throw new BadRequestException('Write a note for the employee.');
    }
    const wasApproved = doc.status === 'approved';
    if (wasApproved && !isEmployee)
      await this.assertPeriodOpen(agencyId, doc, access.timeZone);

    const now = new Date();
    const from = doc.status as TimeOffRequestStatus;
    const update = {
      $set: { status: 'cancelled' as const },
      $push: {
        timeline: entry(
          now,
          new Types.ObjectId(access.userId),
          'cancelled',
          from,
          'cancelled',
          note,
        ),
      },
    };
    const claim = (session: ClientSession | null) =>
      this.requests
        .findOneAndUpdate(
          { _id: doc._id, agencyId, status: from, deletedAt: null },
          update,
          { new: true, session: session ?? undefined },
        )
        .lean<RequestLean | null>();

    const cancelled = wasApproved
      ? await this.transactions.run(async (session) => {
          const claimed = await claim(session);
          if (claimed)
            await this.ledger.postReversal(ledgerTarget(claimed), session);
          return claimed;
        })
      : await claim(null);
    if (!cancelled) throw await this.alreadyDecided(access, agencyId, doc._id);

    // Decided 2026-11-05: withdrawing an undecided request tells nobody.
    if (wasApproved) {
      const recipients = isEmployee
        ? await this.reviewers.reviewersFor(agencyId, cancelled.branchId, [
            access.userId,
          ])
        : [String(cancelled.employeeId)];
      await this.notify(
        'time_off.approval_cancelled',
        cancelled,
        recipients,
        access.userId,
        {
          cancelledBy: isEmployee ? 'employee' : 'reviewer',
          note,
        },
      );
    }
    return this.toView(access, agencyId, cancelled);
  }

  // ── Decisions ──────────────────────────────────────────────────────────

  approve(
    access: AccessContext,
    agencyId: string,
    requestId: string,
    note: string | null,
  ) {
    return this.decide(access, agencyId, requestId, 'approve', note);
  }

  requestChanges(
    access: AccessContext,
    agencyId: string,
    requestId: string,
    note: string,
  ) {
    return this.decide(access, agencyId, requestId, 'request_changes', note);
  }

  decline(
    access: AccessContext,
    agencyId: string,
    requestId: string,
    note: string,
  ) {
    return this.decide(access, agencyId, requestId, 'decline', note);
  }

  private async decide(
    access: AccessContext,
    agencyId: string,
    requestId: string,
    action: Extract<
      TimeOffRequestAction,
      'approve' | 'request_changes' | 'decline'
    >,
    note: string | null,
  ): Promise<TimeOffRequestView> {
    const doc = await this.visible(access, agencyId, requestId);
    if (this.isEmployee(access, doc)) {
      throw refusal(403, 'own_request', 'You cannot decide your own request.');
    }
    this.assertActionable(doc);
    const to = canTransition(doc.status as TimeOffRequestStatus, action);
    if (!to) throw await this.alreadyDecided(access, agencyId, doc._id);
    if (action === 'approve') await this.assertApprovable(agencyId, doc);

    const now = new Date();
    const actor = new Types.ObjectId(access.userId);
    const timelineAction: TimeOffTimelineAction =
      action === 'approve'
        ? 'approved'
        : action === 'decline'
          ? 'declined'
          : 'changes_requested';
    const update = {
      $set: {
        status: to,
        // Sent back for changes is not a decision: the request is still open.
        ...(action === 'request_changes'
          ? {}
          : { decidedAt: now, decidedBy: actor }),
      },
      $push: {
        timeline: entry(now, actor, timelineAction, 'submitted', to, note),
      },
    };
    const claim = (session: ClientSession | null) =>
      this.requests
        .findOneAndUpdate(
          { _id: doc._id, agencyId, status: 'submitted', deletedAt: null },
          update,
          { new: true, session: session ?? undefined },
        )
        .lean<RequestLean | null>();

    const decided =
      action === 'approve'
        ? await this.transactions.run(async (session) => {
            const claimed = await claim(session);
            if (claimed) {
              await this.ledger.postUsed(
                ledgerTarget(claimed),
                claimed.days,
                access.timeZone,
                session,
              );
            }
            return claimed;
          })
        : await claim(null);
    if (!decided) throw await this.alreadyDecided(access, agencyId, doc._id);

    const type: NotificationType =
      action === 'approve'
        ? 'time_off.approved'
        : action === 'decline'
          ? 'time_off.declined'
          : 'time_off.changes_requested';
    await this.notify(
      type,
      decided,
      [String(decided.employeeId)],
      access.userId,
      { note },
    );
    return this.toView(access, agencyId, decided);
  }

  // ── Sending ────────────────────────────────────────────────────────────

  /**
   * Send a request for review: check it, freeze its hours, and — when the
   * policy's auto-approval rules pass — approve it in the same breath.
   * `existing` is the Draft or Changes Requested row being (re)sent, or
   * `null` for a request sent without ever being saved.
   */
  private async send(
    access: AccessContext,
    agencyId: string,
    me: UserLean,
    input: RequestInput,
    existing: RequestLean | null,
  ): Promise<RequestLean> {
    const evaluation = await this.evaluate({
      agencyId,
      employee: me,
      input,
      mode: 'self',
      timeZone: access.timeZone,
      excludeRequestId: existing?._id ?? null,
    });
    if (evaluation.blockers.length > 0) {
      const [first] = evaluation.blockers;
      throw refusal(400, first.code, first.message, {
        blockers: evaluation.blockers,
      });
    }

    const now = new Date();
    const from = existing?.status ?? null;
    const resubmitted = from === 'changes_requested';
    const verdict = evaluateAutoApproval(evaluation.rules, {
      firstDay: input.firstDay,
      lastDay: input.lastDay,
      submittedAt: now,
      firstDayStartsAt: businessDateInstant(input.firstDay, access.timeZone),
      balanceAfterHours: evaluation.lowestBalance,
      recordedByManager: false,
    });
    const status: TimeOffRequestStatus = verdict.approve
      ? 'approved'
      : 'submitted';
    const entries: TimeOffTimelineEntry[] = [
      entry(
        now,
        me._id,
        resubmitted ? 'resubmitted' : 'submitted',
        from,
        'submitted',
        input.note ?? null,
      ),
    ];
    if (verdict.approve) {
      entries.push(entry(now, null, 'auto_approved', 'submitted', 'approved'));
    }
    const fields = {
      ...requestFields(input, evaluation),
      status,
      submittedAt: now,
      autoApproved: verdict.approve,
      decidedAt: verdict.approve ? now : null,
      decidedBy: null,
    };
    const branchId =
      existing?.branchId ?? (await this.homeBranchId(agencyId, me));

    const sent = await this.transactions.run(async (session, created) => {
      let row: RequestLean | null;
      if (existing) {
        row = await this.requests
          .findOneAndUpdate(
            { _id: existing._id, agencyId, status: from, deletedAt: null },
            { $set: fields, $push: { timeline: { $each: entries } } },
            { new: true, session: session ?? undefined },
          )
          .lean<RequestLean | null>();
      } else {
        const [doc] = await this.requests.create(
          [
            {
              agencyId,
              branchId,
              reference: await this.nextReference(
                agencyId,
                access.timeZone,
                now,
                session,
              ),
              source: 'self',
              employeeId: me._id,
              initiatorId: me._id,
              ...fields,
              timeline: entries,
            },
          ],
          { session: session ?? undefined },
        );
        created.track(this.requests, doc._id);
        row = doc.toObject();
      }
      if (row && verdict.approve) {
        await this.ledger.postUsed(
          ledgerTarget(row),
          row.days,
          access.timeZone,
          session,
        );
      }
      return row;
    });
    if (!sent) throw await this.alreadyDecided(access, agencyId, existing!._id);

    const reviewers = await this.reviewers.reviewersFor(
      agencyId,
      sent.branchId,
      [access.userId],
    );
    if (verdict.approve) {
      await this.notify('time_off.approved', sent, [access.userId], null, {
        automatic: true,
      });
      await this.notify('time_off.auto_approved_notice', sent, reviewers, null);
    } else {
      await this.notify('time_off.submitted', sent, reviewers, access.userId, {
        resubmitted,
        note: input.note ?? null,
      });
    }
    return sent;
  }

  // ── Evaluation ─────────────────────────────────────────────────────────

  /**
   * What these dates amount to for this person on this policy, and what is
   * wrong with them. A `self` request is blocked by every check; a
   * `record`ed entry (time off recorded for someone else) may be in the
   * past and only warns about the waiting period, the usage cap and a
   * negative balance — but may not touch a period that has already reset.
   */
  protected async evaluate(args: {
    agencyId: string;
    employee: UserLean;
    input: RequestInput;
    mode: 'self' | 'record';
    timeZone: string;
    excludeRequestId?: Types.ObjectId | null;
  }): Promise<Evaluation> {
    const { agencyId, employee, input, mode, timeZone } = args;
    const today = agencyTodayIso(timeZone);
    const who = mode === 'self' ? 'You are' : `${personName(employee)} is`;

    if (!Types.ObjectId.isValid(input.policyId)) {
      throw new NotFoundException('That time off policy does not exist.');
    }
    const policy = await this.policies
      .findOne({ _id: new Types.ObjectId(input.policyId), agencyId })
      .lean<PolicyLean | null>();
    if (!policy)
      throw new NotFoundException('That time off policy does not exist.');
    const rules = timeOffRulesOf(policy);

    const checks: TimeOffCheck[] = [];
    const add = (code: TimeOffCheckCode, message: string) =>
      checks.push({ code, message });

    if (policy.archivedAt) {
      add('policy_unavailable', 'That time off policy is no longer in use.');
    } else if (
      !(policy.memberIds ?? []).some((id) => id.equals(employee._id))
    ) {
      add('not_enrolled', `${who} not in this time off policy.`);
    }
    if (mode === 'self' && input.firstDay < today) {
      add(
        'past_date',
        'Time off cannot start in the past. Ask someone who can record it for you.',
      );
    }

    const span = calendarDaysInclusive(input.firstDay, input.lastDay);
    const tooLong = span > TIME_OFF_REQUEST_MAX_SPAN_DAYS;
    const tooFar =
      input.lastDay > addDaysIso(today, TIME_OFF_REQUEST_MAX_AHEAD_DAYS);
    if (tooLong) {
      add(
        'span_too_long',
        `A request can cover at most ${TIME_OFF_REQUEST_MAX_SPAN_DAYS} days.`,
      );
    } else if (tooFar) {
      add('span_too_long', 'Time off can be requested up to two years ahead.');
    }
    // The bounds are what keep `days[]` and the projection finite; past them
    // there is nothing sensible to compute.
    if (tooLong || tooFar) {
      return {
        policy,
        rules,
        days: [],
        totalHours: 0,
        balance: null,
        projection: null,
        lowestBalance: null,
        blockers: checks,
        warnings: [],
      };
    }

    const calendar = await this.workingDays.forPerson(
      agencyId,
      employee._id.toString(),
      { from: input.firstDay, to: input.lastDay },
    );
    const days = requestDays(
      scheduledDaysBetween(
        calendar.snapshot,
        calendar.schedule,
        calendarDate(input.firstDay),
        calendarDate(input.lastDay),
      ),
      input.dayMode,
      input.hours ?? {},
    );
    const totalHours = totalRequestHours(days);
    if (totalHours <= 0) {
      add('no_scheduled_hours', 'There are no scheduled hours in these dates.');
    }

    const clash = await this.overlap(
      agencyId,
      employee._id,
      input,
      days,
      args.excludeRequestId,
    );
    if (clash) add('overlap', clash);

    const position = await this.balance.position({
      agencyId,
      policyId: policy._id,
      rules,
      userId: employee._id,
      timeZone,
      excludeRequestId: args.excludeRequestId,
    });
    const hireDate = position?.hireDate ?? null;

    const allowedFrom = usageAllowedFrom(hireDate, rules.waitingPeriodDays);
    if (allowedFrom && input.firstDay < allowedFrom) {
      add(
        'waiting_period',
        `Time off from this policy can be used from ${formatDay(allowedFrom)}.`,
      );
    }

    let balance: TimeOffBalanceLines | null = null;
    let projection: TimeOffProjectionView | null = null;
    let lowestBalance: number | null = null;
    if (position) {
      balance = balanceLines({
        currentBalance: position.currentBalance,
        otherRequestedHours: position.otherRequestedHours,
        thisRequestHours: totalHours,
      });
      const projected = projectFor(rules, position, days);
      projection = toProjectionView(projected);
      lowestBalance = projected.lowestBalance;
      if (projected.capExceededBy > 0) {
        add(
          'usage_cap',
          `This is ${projected.capExceededBy} h over the policy's yearly limit of ${rules.annualUsageCapHours} h.`,
        );
      }
      if (projected.lowestBalance < 0 && !rules.allowNegativeBalance) {
        add(
          'negative_balance',
          projected.lowestOn
            ? `The balance would be ${-projected.lowestBalance} h short on ${formatDay(projected.lowestOn)}.`
            : `The balance would be ${-projected.lowestBalance} h short.`,
        );
      }
      if (mode === 'record') {
        const periodStart = periodStartFor(rules, hireDate, today);
        if (
          periodStart &&
          days.some((day) => day.hours > 0 && day.date < periodStart)
        ) {
          add(
            'old_period',
            'That day is in a period that has already been reset. Adjust the balance instead.',
          );
        }
      }
    }

    const soft: readonly TimeOffCheckCode[] =
      mode === 'record' ? RECORD_WARNING_CODES : [];
    return {
      policy,
      rules,
      days,
      totalHours,
      balance,
      projection,
      lowestBalance,
      blockers: checks.filter((check) => !soft.includes(check.code)),
      warnings: checks.filter((check) => soft.includes(check.code)),
    };
  }

  /**
   * A message naming the dates the person already has time off on, or null.
   * Their Submitted, Changes Requested and Approved requests on **any**
   * policy count; a Draft does not. Compared on dates that carry hours
   * (decided 2026-11-05: a hard block).
   */
  private async overlap(
    agencyId: string,
    employeeId: Types.ObjectId,
    input: RequestInput,
    days: readonly TimeOffRequestDay[],
    excludeRequestId?: Types.ObjectId | null,
  ): Promise<string | null> {
    const others = await this.requests
      .find({
        agencyId,
        employeeId,
        status: { $in: LIVE_TIME_OFF_REQUEST_STATUSES },
        deletedAt: null,
        firstDay: { $lte: input.lastDay },
        lastDay: { $gte: input.firstDay },
        ...(excludeRequestId ? { _id: { $ne: excludeRequestId } } : {}),
      })
      .select('reference days')
      .lean<Pick<RequestLean, 'reference' | 'days'>[]>();
    for (const other of others) {
      const dates = overlappingDates(days, other.days ?? []);
      if (dates.length === 0) continue;
      const shown = dates.slice(0, 3).map(formatDay).join(', ');
      const more = dates.length > 3 ? ` and ${dates.length - 3} more` : '';
      return `There is already time off on ${shown}${more} (${other.reference ?? 'another request'}).`;
    }
    return null;
  }

  // ── Guards ─────────────────────────────────────────────────────────────

  /**
   * The request, if the caller may see it: their own, or one in a branch
   * they review. A Draft is its creator's alone. Anything else is a 404 —
   * a 403 would confirm the request exists.
   */
  private async visible(
    access: AccessContext,
    agencyId: string,
    requestId: string,
  ): Promise<RequestLean> {
    const missing = () => new NotFoundException('That request does not exist.');
    if (!Types.ObjectId.isValid(requestId)) throw missing();
    const doc = await this.requests
      .findOne({
        _id: new Types.ObjectId(requestId),
        agencyId,
        deletedAt: null,
      })
      .lean<RequestLean | null>();
    if (!doc) throw missing();
    if (this.isEmployee(access, doc)) return doc;
    if (doc.status === 'draft' || !reviewsBranch(access, doc.branchId))
      throw missing();
    return doc;
  }

  /** The caller's own Draft or Changes Requested row, and the caller. */
  private async ownEditable(
    access: AccessContext,
    agencyId: string,
    requestId: string,
  ): Promise<{ doc: RequestLean; me: UserLean }> {
    const doc = await this.visible(access, agencyId, requestId);
    if (!this.isEmployee(access, doc)) {
      throw new NotFoundException('That request does not exist.');
    }
    this.assertActionable(doc);
    if (doc.status !== 'draft' && doc.status !== 'changes_requested') {
      throw await this.alreadyDecided(access, agencyId, doc._id);
    }
    return { doc, me: await this.requireUser(agencyId, access.userId) };
  }

  private isEmployee(access: AccessContext, doc: RequestLean): boolean {
    return doc.employeeId?.toString() === access.userId;
  }

  private viewer(access: AccessContext, doc: RequestLean) {
    const isEmployee = this.isEmployee(access, doc);
    return {
      isEmployee,
      canReview: !isEmployee && reviewsBranch(access, doc.branchId),
    };
  }

  /** An imported row is history: nothing acts on it. */
  private assertActionable(doc: RequestLean): void {
    if (doc.source === 'legacy' || !doc.status) {
      throw refusal(
        409,
        'imported',
        'This request was imported from SmartSuite and cannot be changed.',
      );
    }
  }

  /**
   * Approval needs the policy still in use, and the employee still in it
   * and still with the agency. The balance is *not* re-checked: the
   * reviewer sees the live numbers and decides.
   */
  private async assertApprovable(
    agencyId: string,
    doc: RequestLean,
  ): Promise<void> {
    const [policy, employee] = await Promise.all([
      this.policies
        .findOne({ _id: doc.policyId, agencyId })
        .select('archivedAt memberIds')
        .lean<Pick<PolicyLean, 'archivedAt' | 'memberIds'> | null>(),
      this.users
        .findOne({ _id: doc.employeeId })
        .select('isActive deactivatedAt')
        .lean<Pick<UserLean, 'isActive' | 'deactivatedAt'> | null>(),
    ]);
    const reason =
      !policy || policy.archivedAt
        ? 'The time off policy is no longer in use.'
        : !(policy.memberIds ?? []).some((id) => id.equals(doc.employeeId))
          ? 'The employee is no longer in this time off policy.'
          : !employee || employee.deactivatedAt
            ? 'The employee is no longer with the agency.'
            : null;
    if (reason) {
      throw refusal(
        409,
        'policy_unavailable',
        `${reason} Decline the request instead.`,
      );
    }
  }

  /**
   * A period that has already reset is closed (decided 2026-11-05): its
   * carryover was calculated from the leave it held, so handing hours back
   * into it would move today's balance by an amount the cap never saw.
   */
  private async assertPeriodOpen(
    agencyId: string,
    doc: RequestLean,
    timeZone: string,
  ): Promise<void> {
    if (!doc.policyId || !doc.employeeId) return;
    const policy = await this.policies
      .findOne({ _id: doc.policyId, agencyId })
      .lean<PolicyLean | null>();
    if (!policy) return;
    const rules = timeOffRulesOf(policy);
    const position = await this.balance.position({
      agencyId,
      policyId: policy._id,
      rules,
      userId: doc.employeeId,
      timeZone,
    });
    if (!position) return;
    const periodStart = periodStartFor(
      rules,
      position.hireDate,
      position.today,
    );
    if (
      periodStart &&
      doc.days.some((day) => day.hours > 0 && day.date < periodStart)
    ) {
      throw refusal(
        400,
        'old_period',
        'This leave is in a period that has already been reset. Adjust the balance instead.',
      );
    }
  }

  /** `409` with the record as it now stands — what "first decision wins" answers. */
  private async alreadyDecided(
    access: AccessContext,
    agencyId: string,
    requestId: Types.ObjectId,
  ): Promise<HttpException> {
    const current = await this.requests
      .findOne({ _id: requestId, agencyId })
      .lean<RequestLean | null>();
    return refusal(
      409,
      'already_decided',
      'This request has already been decided or changed. It has been refreshed.',
      current && !current.deletedAt
        ? { request: await this.toView(access, agencyId, current) }
        : {},
    );
  }

  // ── Lookups ────────────────────────────────────────────────────────────

  protected async requireUser(
    agencyId: string,
    userId: string,
  ): Promise<UserLean> {
    const user = Types.ObjectId.isValid(userId)
      ? await this.users
          .findOne({
            _id: new Types.ObjectId(userId),
            agencyId: new Types.ObjectId(agencyId),
            isPlatformAdmin: { $ne: true },
          })
          .select(USER_FIELDS)
          .lean<UserLean | null>()
      : null;
    if (!user)
      throw new NotFoundException('That person is not in this agency.');
    return user;
  }

  /**
   * The branch a person belongs to for HR: their own, or — for someone with
   * none, an Agency Owner — the agency's default branch. A request is
   * stamped with it and a branch-scoped reviewer is tested against it.
   */
  protected async homeBranchId(
    agencyId: string,
    user: UserLean,
  ): Promise<string> {
    if (user.branchId) return user.branchId.toString();
    const agency = new Types.ObjectId(agencyId);
    const branch =
      (await this.branches
        .findOne({ agencyId: agency, isDefault: true })
        .select('_id')
        .lean<{ _id: Types.ObjectId } | null>()) ??
      (await this.branches
        .findOne({ agencyId: agency })
        .sort({ createdAt: 1 })
        .select('_id')
        .lean<{ _id: Types.ObjectId } | null>());
    if (!branch) throw new ConflictException('This agency has no branch yet.');
    return branch._id.toString();
  }

  /** `TOR-2026-007`: the agency's next number for the year the request is made in. */
  protected async nextReference(
    agencyId: string,
    timeZone: string,
    now: Date,
    session?: ClientSession | null,
  ): Promise<string> {
    const year = Number(agencyTodayIso(timeZone, now).slice(0, 4));
    const seq = await this.sequences.next(
      `timeOffRequest:${agencyId}:${year}`,
      session,
    );
    return formatTimeOffRequestRef(year, seq);
  }

  /** People of the agency whose name or email matches every word typed. */
  private async usersNamed(
    agencyId: string,
    q: string,
  ): Promise<Types.ObjectId[]> {
    const terms = q.split(/\s+/).filter(Boolean).slice(0, 5);
    const rows = await this.users
      .find({
        agencyId: new Types.ObjectId(agencyId),
        $and: terms.map((term) => {
          const pattern = new RegExp(escapeRegex(term), 'i');
          return {
            $or: [
              { firstName: pattern },
              { lastName: pattern },
              { email: pattern },
            ],
          };
        }),
      })
      .select('_id')
      .limit(200)
      .lean<{ _id: Types.ObjectId }[]>();
    return rows.map((row) => row._id);
  }

  // ── Views ──────────────────────────────────────────────────────────────

  private async page(
    filter: FilterQuery<TimeOffRequestDocument>,
    sort: Record<string, 1 | -1>,
    query: { page: number; pageSize: number },
    today: string,
  ): Promise<TimeOffRequestList> {
    const [docs, total] = await Promise.all([
      this.requests
        .find(filter)
        .sort(sort)
        .skip((query.page - 1) * query.pageSize)
        .limit(query.pageSize)
        .select('-days -timeline')
        .lean<RequestLean[]>(),
      this.requests.countDocuments(filter),
    ]);
    const lookups = await this.lookups(docs);
    return {
      items: docs.map((doc) => toRow(doc, lookups, today)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** The names a set of requests mentions, in two queries. */
  private async lookups(docs: readonly RequestLean[]): Promise<Lookups> {
    const userIds = new Set<string>();
    const policyIds = new Set<string>();
    for (const doc of docs) {
      for (const id of [doc.employeeId, doc.initiatorId]) {
        if (id) userIds.add(id.toString());
      }
      for (const row of doc.timeline ?? []) {
        if (row.actorId) userIds.add(row.actorId.toString());
      }
      if (doc.policyId) policyIds.add(doc.policyId.toString());
    }
    const [users, policies] = await Promise.all([
      userIds.size
        ? this.users
            .find({
              _id: { $in: [...userIds].map((id) => new Types.ObjectId(id)) },
            })
            .select('email firstName lastName')
            .lean<UserLean[]>()
        : Promise.resolve<UserLean[]>([]),
      policyIds.size
        ? this.policies
            .find({
              _id: { $in: [...policyIds].map((id) => new Types.ObjectId(id)) },
            })
            .select('name timeOffType accrualType')
            .lean<PolicyLean[]>()
        : Promise.resolve<PolicyLean[]>([]),
    ]);
    return {
      users: new Map(
        users.map((user) => [user._id.toString(), personName(user)]),
      ),
      policies: new Map(
        policies.map((policy) => [policy._id.toString(), policyRef(policy)]),
      ),
    };
  }

  protected async toView(
    access: AccessContext,
    agencyId: string,
    doc: RequestLean,
  ): Promise<TimeOffRequestView> {
    const today = agencyTodayIso(access.timeZone);
    const lookups = await this.lookups([doc]);
    const viewer = this.viewer(access, doc);
    const person = (id: Types.ObjectId | null | undefined) =>
      id
        ? {
            id: id.toString(),
            name: lookups.users.get(id.toString()) ?? 'Unknown',
          }
        : null;

    // The balance lines belong to a request still to be decided; once it is
    // approved its hours are in the ledger and the lines would count twice.
    const undecided =
      doc.status === 'draft' ||
      doc.status === 'submitted' ||
      doc.status === 'changes_requested';
    let balance: TimeOffBalanceLines | null = null;
    let projection: TimeOffProjectionView | null = null;
    if (undecided && doc.policyId && doc.employeeId) {
      const policy = await this.policies
        .findOne({ _id: doc.policyId, agencyId })
        .lean<PolicyLean | null>();
      const rules = policy ? timeOffRulesOf(policy) : null;
      const position = rules
        ? await this.balance.position({
            agencyId,
            policyId: doc.policyId,
            rules,
            userId: doc.employeeId,
            timeZone: access.timeZone,
            excludeRequestId: doc._id,
          })
        : null;
      if (rules && position) {
        balance = balanceLines({
          currentBalance: position.currentBalance,
          otherRequestedHours: position.otherRequestedHours,
          thisRequestHours: doc.totalHours ?? 0,
        });
        projection = toProjectionView(
          projectFor(rules, position, doc.days ?? []),
        );
      }
    }

    return {
      ...toRow(doc, lookups, today),
      days: (doc.days ?? []).map(({ date, hours, scheduledHours, reason }) => ({
        date,
        hours,
        scheduledHours,
        reason,
      })),
      note: doc.note ?? null,
      timeline: (doc.timeline ?? []).map((row) => ({
        at: row.at.toISOString(),
        actor: person(row.actorId),
        action: row.action,
        fromStatus: row.fromStatus ?? null,
        toStatus: row.toStatus ?? null,
        note: row.note ?? null,
        warnings: row.warnings ?? [],
      })),
      balance,
      projection,
      actions: requestActions(doc, viewer, today),
      ...(viewer.canReview
        ? { othersOff: await this.othersOff(agencyId, doc) }
        : {}),
    };
  }

  /** Who else in the branch is off, or waiting to be, on these dates. Information only. */
  private async othersOff(
    agencyId: string,
    doc: RequestLean,
  ): Promise<NonNullable<TimeOffRequestView['othersOff']>> {
    if (!doc.firstDay || !doc.lastDay) return [];
    const rows = await this.requests
      .find({
        agencyId,
        branchId: doc.branchId,
        status: { $in: ['submitted', 'approved'] },
        deletedAt: null,
        _id: { $ne: doc._id },
        employeeId: { $ne: doc.employeeId },
        firstDay: { $lte: doc.lastDay },
        lastDay: { $gte: doc.firstDay },
      })
      .sort({ firstDay: 1 })
      .limit(20)
      .select('employeeId firstDay lastDay status')
      .lean<RequestLean[]>();
    const lookups = await this.lookups(rows);
    return rows.flatMap((row) =>
      row.employeeId && row.firstDay && row.lastDay && row.status
        ? [
            {
              employee: {
                id: row.employeeId.toString(),
                name: lookups.users.get(row.employeeId.toString()) ?? 'Unknown',
              },
              firstDay: row.firstDay,
              lastDay: row.lastDay,
              status: row.status,
            },
          ]
        : [],
    );
  }

  // ── Notifications ──────────────────────────────────────────────────────

  /**
   * Tell `recipientIds` about `request`. Called after the write has
   * committed, and never allowed to fail it: the outbox row is written
   * before the send, so an Inngest outage delays the notification rather
   * than losing it.
   *
   * The dedupe key carries the timeline length: `{recipient, dedupeKey}` is
   * unique forever, so a second "changes requested" on the same request
   * needs a key of its own or it would be silently dropped.
   */
  protected async notify(
    type: NotificationType,
    request: RequestLean,
    recipientIds: readonly string[],
    actorId: string | null,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    const recipients = [...new Set(recipientIds.filter(Boolean))];
    if (recipients.length === 0) return;
    try {
      const lookups = await this.lookups([request]);
      const actor = actorId
        ? await this.users
            .findById(actorId)
            .select('email firstName lastName')
            .lean<UserLean | null>()
        : null;
      const id = request._id.toString();
      await this.inngest.send(notificationRequested, {
        type,
        recipientIds: recipients,
        agencyId: request.agencyId,
        actorId,
        entity: { kind: 'timeOffRequest', id },
        data: {
          requestId: id,
          reference: request.reference,
          employeeName: request.employeeId
            ? (lookups.users.get(request.employeeId.toString()) ?? null)
            : null,
          actorName: actor ? personName(actor) : null,
          policyName: request.policyId
            ? (lookups.policies.get(request.policyId.toString())?.name ?? null)
            : null,
          firstDay: request.firstDay,
          lastDay: request.lastDay,
          totalHours: request.totalHours,
          note: null,
          ...extra,
        },
        dedupeKey: `${type}:${id}:${request.timeline?.length ?? 0}`,
      });
    } catch (err) {
      this.logger.warn(
        `Could not request the ${type} notification for ${request._id.toString()}: ${String(err)}`,
      );
    }
  }
}

// ── Pure helpers ───────────────────────────────────────────────────────────

interface Lookups {
  users: Map<string, string>;
  policies: Map<string, TimeOffPolicyRef>;
}

function policyRef(policy: PolicyLean): TimeOffPolicyRef {
  return {
    id: policy._id.toString(),
    name: policy.name,
    timeOffType: policy.timeOffType ?? 'custom',
    unlimited: policy.accrualType === 'unlimited',
  };
}

/** The `$or` of the list groups asked for; nothing when none is. */
function groupFilter(
  groups: readonly TimeOffRequestGroup[] | undefined,
  today: string,
): FilterQuery<TimeOffRequestDocument> {
  if (!groups?.length) return {};
  const clause = (
    group: TimeOffRequestGroup,
  ): FilterQuery<TimeOffRequestDocument> => {
    switch (group) {
      case 'draft':
        return { status: 'draft' };
      case 'pending':
        return { status: 'submitted' };
      case 'changes_requested':
        return { status: 'changes_requested' };
      // *Taken* is Approved leave whose last day has passed — derived here,
      // never stored.
      case 'approved':
        return { status: 'approved', lastDay: { $gte: today } };
      case 'taken':
        return { status: 'approved', lastDay: { $lt: today } };
      case 'declined':
        return { status: 'declined' };
      case 'cancelled':
        return { status: 'cancelled' };
      case 'imported':
        return { source: 'legacy' };
    }
  };
  return { $or: groups.map(clause) };
}

function toRow(
  doc: RequestLean,
  lookups: Lookups,
  today: string,
): TimeOffRequestRow {
  const person = (id: Types.ObjectId | null | undefined) =>
    id
      ? {
          id: id.toString(),
          name: lookups.users.get(id.toString()) ?? 'Unknown',
        }
      : null;
  const source = doc.source;
  const status = doc.status ?? null;
  return {
    id: doc._id.toString(),
    reference: doc.reference ?? null,
    source,
    status,
    group: requestGroup(
      { source, status, lastDay: doc.lastDay ?? null },
      today,
    ),
    employee: person(doc.employeeId),
    recordedBy: source === 'recorded' ? person(doc.initiatorId) : null,
    policy: doc.policyId
      ? (lookups.policies.get(doc.policyId.toString()) ?? null)
      : null,
    firstDay: doc.firstDay ?? null,
    lastDay: doc.lastDay ?? null,
    dayMode: doc.dayMode ?? null,
    totalHours: doc.totalHours ?? 0,
    autoApproved: doc.autoApproved ?? false,
    submittedAt: doc.submittedAt?.toISOString() ?? null,
    createdAt: doc.createdAt?.toISOString() ?? null,
    legacy: doc.legacy
      ? {
          status: doc.legacy.status ?? null,
          type: doc.legacy.type ?? null,
          requestType: doc.legacy.requestType ?? null,
        }
      : null,
  };
}

function toPreview(evaluation: Evaluation): TimeOffPreview {
  return {
    days: evaluation.days,
    totalHours: evaluation.totalHours,
    balance: evaluation.balance,
    projection: evaluation.projection,
    blockers: evaluation.blockers,
    warnings: evaluation.warnings,
  };
}

/** The stored fields of a request's four inputs, with its hours. */
function requestFields(input: RequestInput, evaluation: Evaluation) {
  return {
    policyId: evaluation.policy._id,
    firstDay: input.firstDay,
    lastDay: input.lastDay,
    dayMode: input.dayMode,
    days: evaluation.days,
    totalHours: evaluation.totalHours,
    note: input.note ?? null,
  };
}

/** A saved request as the inputs it was made from — what "send as it is" sends. */
function storedInput(doc: RequestLean): RequestInput {
  return {
    policyId: String(doc.policyId),
    firstDay: doc.firstDay ?? '',
    lastDay: doc.lastDay ?? '',
    dayMode: doc.dayMode ?? 'full',
    hours: doc.dayMode === 'partial' ? hoursByDate(doc.days ?? []) : undefined,
    note: doc.note ?? null,
  };
}

function entry(
  at: Date,
  actorId: Types.ObjectId | null,
  action: TimeOffTimelineAction,
  fromStatus: TimeOffRequestStatus | null,
  toStatus: TimeOffRequestStatus | null,
  note: string | null = null,
  warnings: TimeOffCheckCode[] = [],
): TimeOffTimelineEntry {
  return { at, actorId, action, fromStatus, toStatus, note, warnings };
}

function ledgerTarget(doc: RequestLean) {
  return {
    agencyId: doc.agencyId,
    policyId: doc.policyId as Types.ObjectId,
    userId: doc.employeeId as Types.ObjectId,
    requestId: doc._id,
  };
}

function projectFor(
  rules: TimeOffPolicyRules,
  position: TimeOffPosition,
  days: readonly Pick<TimeOffRequestDay, 'date' | 'hours'>[],
) {
  return projectLeave({
    rules,
    hireDate: position.hireDate,
    today: position.today,
    currentBalance: position.currentBalance,
    usedThisPeriod: position.usedThisPeriod,
    otherLeave: position.otherLeave,
    requestLeave: hoursByDate(days),
  });
}

function toProjectionView(
  projection: ReturnType<typeof projectLeave>,
): TimeOffProjectionView {
  return {
    lowestBalance: projection.lowestBalance,
    lowestOn: projection.lowestOn,
    crossesAccrual: projection.crossesAccrual,
  };
}
