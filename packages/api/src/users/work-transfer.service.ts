import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, FilterQuery, Model, Types } from 'mongoose';
import {
  DataScope,
  SERVICE_TICKET_TERMINAL_STATUSES,
  terminalLeadStatusValues,
  type AccessContext,
} from '@sfa/shared';
import { Activity } from '../activities/schemas/activity.schema';
import { currentUserObjectId } from '../common/context/request-context';
import { TransactionRunner } from '../common/mongo/transaction.runner';
import { RoleAssignmentsService } from '../permissions/role-assignments.service';
import { CrmRotation } from '../crm-rotations/schemas/crm-rotation.schema';
import { Onboarding } from '../crm/schemas/onboarding.schema';
import { RenewalCycle } from '../crm/schemas/renewal-cycle.schema';
import { ServiceTicket } from '../crm/schemas/service-ticket.schema';
import { DealAuditItem } from '../deal-audit-items/schemas/deal-audit-item.schema';
import { DealAudit } from '../deal-audits/schemas/deal-audit.schema';
import { Deal } from '../deals/schemas/deal.schema';
import { Household } from '../households/schemas/household.schema';
import { Lead } from '../leads/schemas/lead.schema';
import { ShareLink } from '../share-links/schemas/share-link.schema';
import { User, UserDocument } from './schemas/user.schema';
import {
  WorkTransfer,
  WorkTransferDocument,
  WorkTransferTouched,
} from './schemas/work-transfer.schema';

/** How much of a person's book a transfer moves, per kind of record. */
export interface WorkTransferCounts {
  /** Open service tickets (anything not resolved or closed). */
  tickets: number;
  /** Onboardings still in progress — they mint the next call's ticket. */
  onboardings: number;
  /** Renewal cycles still in progress — they mint the renewal-call tickets. */
  renewalCycles: number;
  /** Households whose assigned CSR this person is. */
  households: number;
  /** Deals mirroring those households' CSR. */
  deals: number;
  /** Leads not yet in a terminal status. */
  leads: number;
  /**
   * Open deal audits this person is assignee or reviewer on, plus open audits
   * on their sales that nobody was assigned to — those were theirs by default.
   */
  audits: number;
  /** Unresolved audit items on their sales — the checklist the successor now owns. */
  auditItems: number;
  /** Live share links that route new leads to this person. */
  shareLinks: number;
  /** Round-robin slots the successor takes over. */
  rotationsTakenOver: number;
  /** Slots switched off because the successor already has one for that producer. */
  rotationsDeactivated: number;
}

export interface WorkTransferResult extends WorkTransferCounts {
  fromUserId: string;
  toUserId: string;
  toName: string;
}

/** One option in the successor picker. */
export interface TransferCandidate {
  _id: Types.ObjectId;
  email: string;
  firstName?: string;
  lastName?: string;
}

/** The two people a transfer is between, both already validated. */
interface Parties {
  from: UserDocument;
  to: UserDocument;
  fromName: string;
  toName: string;
  /** For the ticket timeline note's `author`. */
  actorName: string;
}

/** The slice of a rotation row the split needs. */
interface RotationRow {
  _id: Types.ObjectId;
  producerId?: Types.ObjectId;
  activeForProducer: boolean;
}

/** The records a transfer would rewrite, resolved before any write. */
type Plan = WorkTransferTouched;

/**
 * Hands a person's open work to a named colleague (PAC-136, PAC-137).
 *
 * The transfer-to-a-person counterpart of {@link UserWorkReleaseService}, which
 * only puts work back in the queue. Replaces the hand-written reassignment
 * migrations (`migrations/20260909120000-reassign-ashley-medina-to-mike-iles.js`
 * is the one this was distilled from).
 *
 * ## What moves, and why each is here
 *
 * The rule from the product owner: what is still *to be done* goes to the
 * successor; what was already done stays credited to whoever did it. That
 * splits into two groups.
 *
 * **Open work** — someone is expected to act on it now:
 * - `serviceTickets.assignedUserId` + `assignedRep` on non-terminal tickets.
 * - `leads.producerId` on non-terminal leads. After a lead is sold the field
 *   is attribution, which is exactly why terminal leads are excluded.
 * - `dealAudits.auditAssignee` / `auditReviewer` on open audits, when the
 *   owner is this *user* (a role-owned audit is a queue, not a person). An
 *   open audit on one of their sales with **no** assignee is claimed for the
 *   successor too — unassigned meant "the selling producer's" by default.
 * - `dealAuditItems.producerId` + `producerName` on **unresolved** items of
 *   their sales. Once a producer leaves, every outstanding checklist item is
 *   the successor's to chase (product owner, 2026-10-05). Resolved items keep
 *   the name — `resolvedById` records who actually cleared them.
 *
 * **Seeds** — not tasks themselves, but the fields the system reads when it
 * mints the *next* task. Moving the tickets without these undoes itself: the
 * next onboarding call or renewal ticket would be created for the departed
 * person.
 * - `onboardings.assignedCsrId` (in progress) → each next chain ticket.
 * - `renewalCycles.assignedCsrId` (in progress) → the renewal-call tickets.
 * - `households.assignedCrmId` → every future renewal cycle, and the CSR for
 *   any future sale to that household. `deals.assignedCrmId` mirrors it.
 * - `crmRotations.crmId` → the round-robin that hands out new households.
 * - `shareLinks.producerId` → who leads from a public link are assigned to.
 *
 * ## What never moves
 * Attribution: `producerId` on deals, quote recaps, resolved audit items and
 * chargebacks; `createdBy*`, `completedBy*`, `outcomeBy`, timeline authors,
 * activity actors. Rewriting those would restate historical performance and
 * break the leaderboard. `branchId` never moves either — a record's branch
 * belongs to the client, not to the rep working it.
 *
 * ## The rotation is not a field rewrite
 * Blindly setting `crmId` would give the successor two slots in any producer's
 * pool where they already have one, silently doubling their share of that
 * producer's future sales. An *active* row is taken over only while the
 * successor has no active slot for that producer — counting slots taken over
 * earlier in the same run — and is switched off otherwise. Inactive rows are
 * taken over as-is. `activeForProducer` is never turned on.
 */
@Injectable()
export class WorkTransferService {
  private readonly logger = new Logger(WorkTransferService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(ServiceTicket.name)
    private readonly ticketModel: Model<ServiceTicket>,
    @InjectModel(Onboarding.name)
    private readonly onboardingModel: Model<Onboarding>,
    @InjectModel(RenewalCycle.name)
    private readonly renewalCycleModel: Model<RenewalCycle>,
    @InjectModel(Household.name)
    private readonly householdModel: Model<Household>,
    @InjectModel(Deal.name) private readonly dealModel: Model<Deal>,
    @InjectModel(Lead.name) private readonly leadModel: Model<Lead>,
    @InjectModel(DealAudit.name)
    private readonly dealAuditModel: Model<DealAudit>,
    @InjectModel(DealAuditItem.name)
    private readonly dealAuditItemModel: Model<DealAuditItem>,
    @InjectModel(ShareLink.name)
    private readonly shareLinkModel: Model<ShareLink>,
    @InjectModel(CrmRotation.name)
    private readonly rotationModel: Model<CrmRotation>,
    @InjectModel(Activity.name)
    private readonly activityModel: Model<Activity>,
    @InjectModel(WorkTransfer.name)
    private readonly transferModel: Model<WorkTransferDocument>,
    private readonly transactions: TransactionRunner,
    private readonly roleAssignments: RoleAssignmentsService,
  ) {}

  /**
   * Who `fromUserId`'s work may be handed to: active colleagues holding at
   * least one of the same roles — a producer's book goes to a producer, a
   * CSR's to a CSR — and in the same branch (or either has none). Feeds the
   * dialog's picker, and {@link resolveParties} enforces the identical rules,
   * so the picker can never offer someone the transfer would then refuse.
   */
  async candidates(
    access: AccessContext,
    agencyId: string,
    fromUserId: string,
  ): Promise<TransferCandidate[]> {
    assertAgencyWide(access);
    const from = await this.findAgencyUser(agencyId, fromUserId);
    if (!from) throw new NotFoundException('User not found');

    const filter: FilterQuery<User> = {
      agencyId: new Types.ObjectId(agencyId),
      isActive: true,
      isPlatformAdmin: { $ne: true },
      _id: { $ne: from._id },
    };
    const allowed = await this.allowedSuccessorIds(agencyId, from);
    if (allowed) filter._id = { $ne: from._id, $in: allowed };
    // Same branch, or no branch — see `assertSameBranch`. `null` also matches
    // a missing field.
    if (from.branchId) {
      filter.$or = [{ branchId: from.branchId }, { branchId: null }];
    }

    return this.userModel
      .find(filter)
      .select('email firstName lastName')
      .collation({ locale: 'en', strength: 2 })
      .sort({ lastName: 1, firstName: 1, email: 1 })
      .lean<TransferCandidate[]>();
  }

  /** Count what {@link transfer} would move, without changing anything. */
  async preview(
    access: AccessContext,
    agencyId: string,
    fromUserId: string,
    toUserId: string,
  ): Promise<WorkTransferCounts> {
    const parties = await this.resolveParties(
      access,
      agencyId,
      fromUserId,
      toUserId,
    );
    return this.countsOf(await this.plan(agencyId, parties, null));
  }

  /**
   * Move `fromUserId`'s open work to `toUserId`.
   *
   * The source may be active or already removed — "she left last week, give
   * her clients to Mike" is the case this was built for. The successor must be
   * active: handing work to a deactivated account is how it reaches nobody.
   */
  async transfer(
    access: AccessContext,
    agencyId: string,
    fromUserId: string,
    toUserId: string,
  ): Promise<WorkTransferResult> {
    const parties = await this.resolveParties(
      access,
      agencyId,
      fromUserId,
      toUserId,
    );
    return this.transferResolved(agencyId, parties);
  }

  private async transferResolved(
    agencyId: string,
    parties: Parties,
  ): Promise<WorkTransferResult> {
    const { from, to, fromName, toName } = parties;

    // `withTransaction` may re-run this callback on a transient error, so the
    // plan is resolved inside it: a retry must see the state it is rewriting,
    // not a list captured before the first attempt.
    const plan = await this.transactions.run(async (session) => {
      const planned = await this.plan(agencyId, parties, session);
      await this.apply(parties, planned, session);
      await this.transferModel.create(
        [
          {
            agencyId: new Types.ObjectId(agencyId),
            fromUserId: from._id,
            toUserId: to._id,
            actorUserId: currentUserObjectId(),
            touched: planned,
          },
        ],
        { session },
      );
      return planned;
    });

    await this.recordLeadActivities(plan.leads, fromName, toName);

    const counts = this.countsOf(plan);
    this.logger.log(
      `Transferred work in agency ${agencyId} from ${from._id.toString()} to ` +
        `${to._id.toString()}: ${JSON.stringify(counts)}`,
    );

    return {
      ...counts,
      fromUserId: from._id.toString(),
      toUserId: to._id.toString(),
      toName,
    };
  }

  // --- Validation ------------------------------------------------------------

  private async resolveParties(
    access: AccessContext,
    agencyId: string,
    fromUserId: string,
    toUserId: string,
  ): Promise<Parties> {
    assertAgencyWide(access);
    if (fromUserId === toUserId) {
      throw new BadRequestException(
        'Pick someone other than the person whose work is being handed over.',
      );
    }

    const [from, to] = await Promise.all([
      this.findAgencyUser(agencyId, fromUserId),
      this.findAgencyUser(agencyId, toUserId),
    ]);
    if (!from) throw new NotFoundException('User not found');
    if (!to) throw new NotFoundException('That colleague was not found.');

    if (!to.isActive) {
      throw new ConflictException(
        `${displayName(to)} is not an active user and cannot take on work.`,
      );
    }

    const allowed = await this.allowedSuccessorIds(agencyId, from);
    if (allowed && !allowed.some((id) => id.equals(to._id))) {
      throw new ConflictException(
        `${displayName(to)} does not hold ${displayName(from)}’s role. Hand the work to someone in the same role.`,
      );
    }

    assertSameBranch(from, to);

    const actor = Types.ObjectId.isValid(access.userId)
      ? await this.userModel
          .findById(access.userId)
          .select('firstName lastName email')
          .lean<{ firstName?: string; lastName?: string; email?: string }>()
      : null;

    return {
      from,
      to,
      fromName: displayName(from),
      toName: displayName(to),
      actorName: actor ? displayName(actor) : 'System',
    };
  }

  /**
   * Users sharing at least one role with `from`, or `null` for "anyone" when
   * `from` holds no role at all — a role-less account has no peer group, and
   * refusing every successor would strand its work.
   *
   * Roles are kept on removal (`deactivateUser` only flips `isActive`), so this
   * still answers for someone who has already left.
   */
  private async allowedSuccessorIds(
    agencyId: string,
    from: UserDocument,
  ): Promise<Types.ObjectId[] | null> {
    const roleIds = await this.roleAssignments.userRoleIds(from._id);
    if (!roleIds.length) return null;
    return this.roleAssignments.usersHoldingAnyRole(roleIds, agencyId);
  }

  private findAgencyUser(agencyId: string, userId: string) {
    if (!Types.ObjectId.isValid(userId)) return Promise.resolve(null);
    return this.userModel.findOne({
      _id: new Types.ObjectId(userId),
      // `User.agencyId` is an ObjectId, unlike `TenantRecord`'s string.
      agencyId: new Types.ObjectId(agencyId),
      // Not the agency's to manage — and hidden from its directory already.
      isPlatformAdmin: { $ne: true },
    });
  }

  // --- Plan ------------------------------------------------------------------

  /**
   * Resolve every `_id` that will move, before writing anything.
   *
   * Capturing ids first (rather than `updateMany` on the user filter) is what
   * makes the counts exact and the transfer record complete — after the write,
   * moved records are indistinguishable from ones the successor already had.
   *
   * ⚠ `agencyId` is an **ObjectId** on tickets, onboardings and renewal cycles
   * and a **string** on every `TenantRecord` collection. Each filter below uses
   * its collection's type explicitly; a raw-driver query with the wrong one
   * matches nothing and says nothing.
   */
  private async plan(
    agencyId: string,
    { from, to }: Parties,
    session: ClientSession | null,
  ): Promise<Plan> {
    const agencyOid = new Types.ObjectId(agencyId);
    const fromId = from._id;
    const idsOf = async <T>(model: Model<T>, filter: FilterQuery<T>) => {
      const docs = await model
        .find(filter, { _id: 1 })
        .session(session)
        .lean<{ _id: Types.ObjectId }[]>();
      return docs.map((d) => d._id);
    };

    const [
      serviceTickets,
      onboardings,
      renewalCycles,
      households,
      deals,
      leads,
      auditAssignees,
      auditReviewers,
      auditItems,
      soldDealIds,
      shareLinks,
      rotations,
    ] = await runAll(session, [
      () =>
        idsOf(this.ticketModel, {
          agencyId: agencyOid,
          assignedUserId: fromId,
          status: { $nin: [...SERVICE_TICKET_TERMINAL_STATUSES] },
        }),
      () =>
        idsOf(this.onboardingModel, {
          agencyId: agencyOid,
          assignedCsrId: fromId,
          completedAt: null,
        }),
      () =>
        idsOf(this.renewalCycleModel, {
          agencyId: agencyOid,
          assignedCsrId: fromId,
          completedAt: null,
        }),
      () => idsOf(this.householdModel, { agencyId, assignedCrmId: fromId }),
      () => idsOf(this.dealModel, { agencyId, assignedCrmId: fromId }),
      () =>
        idsOf(this.leadModel, {
          agencyId,
          producerId: fromId,
          status: { $nin: terminalLeadStatusValues() },
        }),
      () =>
        idsOf(this.dealAuditModel, {
          agencyId,
          'auditAssignee.type': 'user',
          'auditAssignee.id': fromId,
          ...OPEN_AUDIT,
        }),
      () =>
        idsOf(this.dealAuditModel, {
          agencyId,
          'auditReviewer.type': 'user',
          'auditReviewer.id': fromId,
          ...OPEN_AUDIT,
        }),
      () =>
        idsOf(this.dealAuditItemModel, {
          agencyId,
          producerId: fromId,
          isResolved: { $ne: true },
        }),
      // Their sales — only to find audits on them that nobody was assigned to.
      () => idsOf(this.dealModel, { agencyId, producerId: fromId }),
      () =>
        idsOf(this.shareLinkModel, {
          agencyId,
          producerId: fromId,
          isActive: true,
        }),
      () =>
        this.rotationModel
          .find({ agencyId, crmId: fromId })
          .select('_id producerId activeForProducer')
          .sort({ order: 1, _id: 1 })
          .session(session)
          .lean<RotationRow[]>(),
    ]);

    const { rotationsTakenOver, rotationsDeactivated } =
      await this.planRotations(agencyId, to._id, rotations, session);

    // `auditAssignee: null` also matches a missing field — audits that predate
    // assignment, which `reconcileDealAudits` would have defaulted to the seller.
    const auditsClaimed = soldDealIds.length
      ? await idsOf(this.dealAuditModel, {
          agencyId,
          dealId: { $in: soldDealIds },
          auditAssignee: null,
          ...OPEN_AUDIT,
        })
      : [];

    return {
      serviceTickets,
      onboardings,
      renewalCycles,
      households,
      deals,
      leads,
      auditAssignees,
      auditReviewers,
      auditsClaimed,
      auditItems,
      shareLinks,
      rotationsTakenOver,
      rotationsDeactivated,
    };
  }

  /** Split the departing person's rotation rows — see the class docblock. */
  private async planRotations(
    agencyId: string,
    toId: Types.ObjectId,
    rows: RotationRow[],
    session: ClientSession | null,
  ): Promise<{
    rotationsTakenOver: Types.ObjectId[];
    rotationsDeactivated: Types.ObjectId[];
  }> {
    const rotationsTakenOver: Types.ObjectId[] = [];
    const rotationsDeactivated: Types.ObjectId[] = [];
    if (!rows.length) return { rotationsTakenOver, rotationsDeactivated };

    const held = await this.rotationModel
      .find({ agencyId, crmId: toId, activeForProducer: true })
      .select('producerId')
      .session(session)
      .lean<Pick<RotationRow, 'producerId'>[]>();
    const pools = new Set(held.map((r) => String(r.producerId)));

    for (const row of rows) {
      if (!row.activeForProducer) {
        rotationsTakenOver.push(row._id);
        continue;
      }
      const pool = String(row.producerId);
      if (pools.has(pool)) {
        rotationsDeactivated.push(row._id);
      } else {
        rotationsTakenOver.push(row._id);
        pools.add(pool);
      }
    }
    return { rotationsTakenOver, rotationsDeactivated };
  }

  // --- Apply -----------------------------------------------------------------

  /**
   * Write the plan. Every update is keyed by the planned `_id`s **and** the
   * departing user, so a record someone else reassigned in between is left
   * with its new owner rather than overwritten.
   *
   * `updateMany` rather than `bulkWrite` throughout: `authorshipPlugin` stamps
   * `updatedBy` on the `TenantRecord` collections only through Mongoose
   * middleware, which `bulkWrite` skips.
   */
  private async apply(
    { from, to, fromName, toName, actorName }: Parties,
    plan: Plan,
    session: ClientSession | null,
  ): Promise<void> {
    const opts = { session: session ?? undefined };
    const fromId = from._id;
    const toId = to._id;
    const byIds = (list: Types.ObjectId[]) => ({ _id: { $in: list } });
    const now = new Date();

    await runAll(session, [
      () =>
        plan.serviceTickets.length &&
        this.ticketModel.updateMany(
          { ...byIds(plan.serviceTickets), assignedUserId: fromId },
          {
            // `assignedRep` is a denormalized display name: moving the id alone
            // would leave the board showing the departed rep.
            $set: { assignedUserId: toId, assignedRep: toName },
            $push: {
              timeline: {
                type: 'system',
                author: actorName,
                content: `Reassigned from ${fromName} to ${toName}.`,
                userId: currentUserObjectId(),
                at: now,
              },
            },
          },
          opts,
        ),
      () =>
        plan.onboardings.length &&
        this.onboardingModel.updateMany(
          { ...byIds(plan.onboardings), assignedCsrId: fromId },
          { $set: { assignedCsrId: toId } },
          opts,
        ),
      () =>
        plan.renewalCycles.length &&
        this.renewalCycleModel.updateMany(
          { ...byIds(plan.renewalCycles), assignedCsrId: fromId },
          { $set: { assignedCsrId: toId } },
          opts,
        ),
      () =>
        plan.households.length &&
        this.householdModel.updateMany(
          { ...byIds(plan.households), assignedCrmId: fromId },
          { $set: { assignedCrmId: toId } },
          opts,
        ),
      () =>
        plan.deals.length &&
        this.dealModel.updateMany(
          { ...byIds(plan.deals), assignedCrmId: fromId },
          { $set: { assignedCrmId: toId } },
          opts,
        ),
      // Not `lastActivityAt`: a hand-over is not activity on the lead, and
      // bumping it would float a whole book of stale leads to the top of every
      // list sorted by recency. The `lead_reassigned` activity records it.
      () =>
        plan.leads.length &&
        this.leadModel.updateMany(
          { ...byIds(plan.leads), producerId: fromId },
          { $set: { producerId: toId } },
          opts,
        ),
      () =>
        plan.auditAssignees.length &&
        this.dealAuditModel.updateMany(
          { ...byIds(plan.auditAssignees), 'auditAssignee.id': fromId },
          { $set: { 'auditAssignee.id': toId } },
          opts,
        ),
      () =>
        plan.auditReviewers.length &&
        this.dealAuditModel.updateMany(
          { ...byIds(plan.auditReviewers), 'auditReviewer.id': fromId },
          { $set: { 'auditReviewer.id': toId } },
          opts,
        ),
      () =>
        plan.auditsClaimed.length &&
        this.dealAuditModel.updateMany(
          { ...byIds(plan.auditsClaimed), auditAssignee: null },
          { $set: { auditAssignee: { type: 'user', id: toId } } },
          opts,
        ),
      () =>
        plan.auditItems.length &&
        this.dealAuditItemModel.updateMany(
          {
            ...byIds(plan.auditItems),
            producerId: fromId,
            isResolved: { $ne: true },
          },
          // `producerName` is denormalized; moving the id alone would leave the
          // item still naming the departed producer.
          { $set: { producerId: toId, producerName: toName } },
          opts,
        ),
      () =>
        plan.shareLinks.length &&
        this.shareLinkModel.updateMany(
          { ...byIds(plan.shareLinks), producerId: fromId },
          { $set: { producerId: toId } },
          opts,
        ),
      () =>
        plan.rotationsTakenOver.length &&
        this.rotationModel.updateMany(
          { ...byIds(plan.rotationsTakenOver), crmId: fromId },
          // `activeForProducer` is carried over as-is, never turned on.
          { $set: { crmId: toId } },
          opts,
        ),
      () =>
        plan.rotationsDeactivated.length &&
        this.rotationModel.updateMany(
          { ...byIds(plan.rotationsDeactivated), crmId: fromId },
          { $set: { activeForProducer: false } },
          opts,
        ),
    ]);
  }

  /**
   * One `lead_reassigned` row per moved lead, matching what
   * `LeadAssignmentService` writes for a single reassignment.
   *
   * Best-effort and post-commit, for the same reason as there: the leads have
   * moved, and failing the request over timeline entries would fail in the
   * wrong direction.
   */
  private async recordLeadActivities(
    leadIds: Types.ObjectId[],
    fromName: string,
    toName: string,
  ): Promise<void> {
    if (!leadIds.length) return;
    try {
      const leads = await this.leadModel
        .find({ _id: { $in: leadIds } })
        .select('_id agencyId branchId')
        .lean<{ _id: Types.ObjectId; agencyId: string; branchId: string }[]>();
      const actor = currentUserObjectId();
      const occurredAt = new Date();
      await this.activityModel.insertMany(
        leads.map((lead) => ({
          agencyId: lead.agencyId,
          branchId: lead.branchId,
          type: 'lead_reassigned',
          subjectType: 'lead',
          leadId: lead._id,
          // The actor, never the new owner — see `LeadAssignmentService`.
          userId: actor,
          occurredAt,
          summary: `Lead reassigned from ${fromName} to ${toName}`,
          // The schema default is `'migration'`.
          source: 'internal',
          isTestRecord: false,
        })),
      );
    } catch (error) {
      this.logger.error(
        `Failed to record lead_reassigned activities for ${leadIds.length} lead(s)`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private countsOf(plan: Plan): WorkTransferCounts {
    const audits = new Set(
      [
        ...plan.auditAssignees,
        ...plan.auditReviewers,
        ...plan.auditsClaimed,
      ].map(String),
    ).size;
    return {
      tickets: plan.serviceTickets.length,
      onboardings: plan.onboardings.length,
      renewalCycles: plan.renewalCycles.length,
      households: plan.households.length,
      deals: plan.deals.length,
      leads: plan.leads.length,
      audits,
      auditItems: plan.auditItems.length,
      shareLinks: plan.shareLinks.length,
      rotationsTakenOver: plan.rotationsTakenOver.length,
      rotationsDeactivated: plan.rotationsDeactivated.length,
    };
  }
}

/**
 * Run `tasks` in parallel — or one at a time inside a transaction. MongoDB
 * does not support concurrent operations on one transaction's session, so
 * `Promise.all` there is a race the driver may or may not report.
 */
async function runAll<T extends (() => unknown)[]>(
  session: ClientSession | null,
  tasks: [...T],
): Promise<{ [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
  type Results = { [K in keyof T]: Awaited<ReturnType<T[K]>> };
  if (!session) {
    return (await Promise.all(tasks.map((task) => task()))) as Results;
  }
  const results: unknown[] = [];
  for (const task of tasks) results.push(await task());
  return results as Results;
}

/**
 * An audit still needing someone: not passed, or passed with items still
 * outstanding (the hand-off board keys on `openFailedCount`).
 */
const OPEN_AUDIT = {
  $or: [{ auditStatus: { $ne: 'Pass' } }, { openFailedCount: { $gt: 0 } }],
};

/**
 * Only an agency-wide role may transfer work (product owner, 2026-10-05). The
 * permission is still granted per role, so a custom agency-wide role can carry
 * it; a branch- or own-scoped holder is refused even with it, because handing
 * over a whole book is an agency decision, not a branch one.
 */
function assertAgencyWide(access: AccessContext): void {
  if (access.dataScope === DataScope.Agency || access.isPlatformAdmin) return;
  throw new ForbiddenException(
    'Transferring work needs an agency-wide role, such as Agency Owner.',
  );
}

/**
 * No cross-branch transfers (product owner, 2026-10-05). Records keep their
 * `branchId` — it belongs to the client — so work handed to someone in another
 * branch would be invisible to them if they are branch-scoped, and would cross
 * a boundary the agency drew on purpose. Someone with **no** branch (typically
 * an owner) may give to or take from anyone: they straddle no boundary.
 */
function assertSameBranch(from: UserDocument, to: UserDocument): void {
  if (!from.branchId || !to.branchId) return;
  if (from.branchId.equals(to.branchId)) return;
  throw new ConflictException(
    `${displayName(to)} works in a different branch from ${displayName(from)}. Work can only be handed over within a branch.`,
  );
}

function displayName(user: {
  firstName?: string;
  lastName?: string;
  email?: string;
}): string {
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return name || user.email || 'a former colleague';
}
