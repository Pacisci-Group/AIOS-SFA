import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  SERVICE_TICKET_TERMINAL_STATUSES,
  terminalLeadStatusValues,
} from '@sfa/shared';
import { Activity } from '../activities/schemas/activity.schema';
import { currentUserObjectId } from '../common/context/request-context';
import {
  CrmRotation,
  CrmRotationDocument,
} from '../crm-rotations/schemas/crm-rotation.schema';
import { Onboarding } from '../crm/schemas/onboarding.schema';
import { RenewalCycle } from '../crm/schemas/renewal-cycle.schema';
import {
  ServiceTicket,
  ServiceTicketDocument,
} from '../crm/schemas/service-ticket.schema';
import { Deal } from '../deals/schemas/deal.schema';
import { Household } from '../households/schemas/household.schema';
import { Lead } from '../leads/schemas/lead.schema';
import { User, UserDocument } from './schemas/user.schema';

/** What a removal put back on the table, for the owner's confirmation toast. */
export interface ReleasedWork {
  /** Open service tickets returned to the unassigned queue. */
  ticketsUnassigned: number;
  /** Round-robin rotation entries switched off. */
  rotationsDeactivated: number;
  /** In-progress onboardings whose next calls now open unassigned. */
  onboardingsUnassigned: number;
  /** In-progress renewal cycles whose calls now open unassigned. */
  renewalCyclesUnassigned: number;
  /** Households left without an assigned CSR — the next sale picks one. */
  householdsUnassigned: number;
  /** Open leads returned to the unclaimed pool. */
  leadsUnassigned: number;
}

/**
 * Hands a departing user's outstanding work back so somebody else can pick it up.
 *
 * The no-successor half of removal. When the owner names a colleague instead,
 * `WorkTransferService` hands the same work — and more — to that person.
 *
 * ## The distinction this service exists to make
 * A user id on a record means one of two very different things, and the schema
 * does not label which:
 *
 * - **Assignment** — somebody is *expected to act*. When they leave, the work is
 *   stranded and must be released. That is what this touches.
 * - **Attribution** — a historical fact about who did something. `deals.producerId`
 *   is who sold the policy; `quoteRecaps.producerId` and
 *   `dealAuditItems.producerId` record who worked them. Clearing those would not
 *   "reassign" anything — it would delete the agency's record of what happened,
 *   break the leaderboard and every "produced by" column, and silently change
 *   historical performance numbers.
 *
 * **Nothing here may ever touch an attribution field.** If a future collection
 * needs releasing, add it only after deciding which of the two it is.
 *
 * ## Releasing the seeds, not only the tickets (PAC-136)
 * Clearing tickets alone undid itself: the next onboarding call is minted from
 * `onboarding.assignedCsrId`, renewal calls from `renewalCycle.assignedCsrId`,
 * new cycles from `household.assignedCrmId` — all still naming the removed
 * user, so fresh work kept landing on an account nobody can open. Each is
 * cleared here so that work opens **unassigned** and reaches the queue:
 *
 * - in-progress onboardings and renewal cycles → their calls open unassigned;
 * - households (and their deal mirror) → the next sale to that client picks a
 *   CSR by round-robin, and new renewal cycles open unassigned;
 * - open leads → back to the unclaimed pool (`producerId: null`), with a
 *   timeline entry each.
 *
 * ## What is deliberately left
 * - **Deal audits.** There is no audit queue to release into: an unassigned
 *   audit defaults back to its seller (`reconcileDealAudits`, the Manager
 *   dashboard), who here *is* the removed person. Left assigned, they stay
 *   visible on managers' boards under that name until reassigned.
 * - **Share links.** They already stop working the moment their producer is
 *   inactive (`ShareLinkAccessService` fails closed).
 *
 * Naming a successor covers both, which is why the remove dialog offers one.
 */
@Injectable()
export class UserWorkReleaseService {
  private readonly logger = new Logger(UserWorkReleaseService.name);

  constructor(
    @InjectModel(ServiceTicket.name)
    private readonly ticketModel: Model<ServiceTicketDocument>,
    @InjectModel(CrmRotation.name)
    private readonly rotationModel: Model<CrmRotationDocument>,
    @InjectModel(Onboarding.name)
    private readonly onboardingModel: Model<Onboarding>,
    @InjectModel(RenewalCycle.name)
    private readonly renewalCycleModel: Model<RenewalCycle>,
    @InjectModel(Household.name)
    private readonly householdModel: Model<Household>,
    @InjectModel(Deal.name) private readonly dealModel: Model<Deal>,
    @InjectModel(Lead.name) private readonly leadModel: Model<Lead>,
    @InjectModel(Activity.name)
    private readonly activityModel: Model<Activity>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  /** Count what {@link release} would free, without changing anything. */
  async preview(agencyId: string, userId: string): Promise<ReleasedWork> {
    const f = this.filters(agencyId, userId);
    const [
      ticketsUnassigned,
      rotationsDeactivated,
      onboardingsUnassigned,
      renewalCyclesUnassigned,
      householdsUnassigned,
      leadsUnassigned,
    ] = await Promise.all([
      this.ticketModel.countDocuments(f.tickets),
      this.rotationModel.countDocuments(f.rotations),
      this.onboardingModel.countDocuments(f.onboardings),
      this.renewalCycleModel.countDocuments(f.renewalCycles),
      this.householdModel.countDocuments(f.households),
      this.leadModel.countDocuments(f.leads),
    ]);
    return {
      ticketsUnassigned,
      rotationsDeactivated,
      onboardingsUnassigned,
      renewalCyclesUnassigned,
      householdsUnassigned,
      leadsUnassigned,
    };
  }

  async release(agencyId: string, userId: string): Promise<ReleasedWork> {
    const f = this.filters(agencyId, userId);

    // Captured first so each released lead gets its own timeline entry — after
    // the write they are indistinguishable from every other pooled lead.
    const leadIds = (
      await this.leadModel
        .find(f.leads, { _id: 1 })
        .lean<{ _id: Types.ObjectId }[]>()
    ).map((lead) => lead._id);

    const [tickets, rotations, onboardings, cycles, households, , leads] =
      await Promise.all([
        // `assignedRep` is a denormalized display name
        // (`crm/schemas/service-ticket.schema.ts`), so clearing the id alone
        // would leave the board still showing a departed rep against an
        // unassigned ticket. The two fields have to move together.
        this.ticketModel.updateMany(f.tickets, {
          $set: { assignedUserId: null, assignedRep: '' },
        }),

        // Load-bearing, and easy to miss.
        //
        // `CrmAssignmentService` builds its round-robin pool from
        // `{ agencyId, producerId, activeForProducer: true }` and never checks
        // whether the CRM behind `crmId` is still an active user. Releasing
        // this person's current tickets while leaving them in the rotation
        // would hand them a fresh one on the next sold deal — the work would
        // leak straight back to somebody who no longer has an account.
        this.rotationModel.updateMany(f.rotations, {
          $set: { activeForProducer: false },
        }),

        this.onboardingModel.updateMany(f.onboardings, {
          $set: { assignedCsrId: null },
        }),
        this.renewalCycleModel.updateMany(f.renewalCycles, {
          $set: { assignedCsrId: null },
        }),

        // `$unset`, not `null`: `CrmAssignmentService`'s conditional claim
        // matches `{ $in: [null, undefined] }`, and absent is what a household
        // that never had a CSR looks like.
        this.householdModel.updateMany(f.households, {
          $unset: { assignedCrmId: 1 },
        }),
        // The deal mirror follows, or the two drift apart for good.
        this.dealModel.updateMany(f.deals, { $unset: { assignedCrmId: 1 } }),

        // Not `lastActivityAt` — a removal is not activity on the lead.
        leadIds.length
          ? this.leadModel.updateMany(
              { _id: { $in: leadIds }, producerId: f.leads.producerId },
              { $set: { producerId: null } },
            )
          : { modifiedCount: 0 },
      ]);

    await this.recordLeadActivities(leadIds, userId);

    const released: ReleasedWork = {
      ticketsUnassigned: tickets.modifiedCount,
      rotationsDeactivated: rotations.modifiedCount,
      onboardingsUnassigned: onboardings.modifiedCount,
      renewalCyclesUnassigned: cycles.modifiedCount,
      householdsUnassigned: households.modifiedCount,
      leadsUnassigned: leads.modifiedCount,
    };

    this.logger.log(
      `Released work for user ${userId}: ${JSON.stringify(released)}`,
    );

    return released;
  }

  /**
   * Every filter in one place, each in its collection's `agencyId` type:
   * tickets, onboardings and renewal cycles store an **ObjectId**, every
   * `TenantRecord` collection a **string**.
   */
  private filters(agencyId: string, userId: string) {
    const agencyOid = new Types.ObjectId(agencyId);
    const user = new Types.ObjectId(userId);
    return {
      /**
       * Tickets still expecting action. A resolved or closed ticket is
       * history, and unassigning it would both rewrite the record of who
       * handled it and drop it into the unassigned queue as phantom work.
       */
      tickets: {
        agencyId: agencyOid,
        assignedUserId: user,
        status: { $nin: [...SERVICE_TICKET_TERMINAL_STATUSES] },
      },
      /** Rotation entries that would keep feeding this user new work. */
      rotations: { agencyId, crmId: user, activeForProducer: true },
      /** A completed chain mints nothing more; its CSR is history. */
      onboardings: {
        agencyId: agencyOid,
        assignedCsrId: user,
        completedAt: null,
      },
      renewalCycles: {
        agencyId: agencyOid,
        assignedCsrId: user,
        completedAt: null,
      },
      households: { agencyId, assignedCrmId: user },
      deals: { agencyId, assignedCrmId: user },
      /** A sold or lost lead's `producerId` is attribution — left alone. */
      leads: {
        agencyId,
        producerId: user,
        status: { $nin: terminalLeadStatusValues() },
      },
    };
  }

  /**
   * One timeline entry per released lead, so the lead's history says why it
   * is suddenly unowned. Best-effort and post-write, like
   * `LeadAssignmentService.recordActivity`.
   */
  private async recordLeadActivities(
    leadIds: Types.ObjectId[],
    userId: string,
  ): Promise<void> {
    if (!leadIds.length) return;
    try {
      const [leads, person] = await Promise.all([
        this.leadModel
          .find({ _id: { $in: leadIds } })
          .select('_id agencyId branchId')
          .lean<
            { _id: Types.ObjectId; agencyId: string; branchId: string }[]
          >(),
        this.userModel
          .findById(userId)
          .select('firstName lastName email')
          .lean<{ firstName?: string; lastName?: string; email?: string }>(),
      ]);
      const name =
        [person?.firstName, person?.lastName]
          .filter(Boolean)
          .join(' ')
          .trim() ||
        person?.email ||
        'Its owner';
      const occurredAt = new Date();
      await this.activityModel.insertMany(
        leads.map((lead) => ({
          agencyId: lead.agencyId,
          branchId: lead.branchId,
          type: 'lead_reassigned',
          subjectType: 'lead',
          leadId: lead._id,
          // The actor, never the lead's owner — see `LeadAssignmentService`.
          userId: currentUserObjectId(),
          occurredAt,
          summary: `Lead returned to the unclaimed pool — ${name} was removed from the agency`,
          source: 'internal',
          isTestRecord: false,
        })),
      );
    } catch (error) {
      this.logger.error(
        `Failed to record release activities for ${leadIds.length} lead(s)`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
