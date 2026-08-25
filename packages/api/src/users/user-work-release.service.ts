import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { SERVICE_TICKET_TERMINAL_STATUSES } from '@sfa/shared';
import {
  CrmRotation,
  CrmRotationDocument,
} from '../crm-rotations/schemas/crm-rotation.schema';
import {
  ServiceTicket,
  ServiceTicketDocument,
} from '../crm/schemas/service-ticket.schema';

/** What a removal put back on the table, for the owner's confirmation toast. */
export interface ReleasedWork {
  /** Open service tickets returned to the unassigned queue. */
  ticketsUnassigned: number;
  /** Round-robin rotation entries switched off. */
  rotationsDeactivated: number;
}

/**
 * Hands a departing user's outstanding work back so somebody else can pick it up.
 *
 * ## The distinction this service exists to make
 * A user id on a record means one of two very different things, and the schema
 * does not label which:
 *
 * - **Assignment** — somebody is *expected to act*. When they leave, the work is
 *   stranded and must be released. That is what this touches.
 * - **Attribution** — a historical fact about who did something. `deals.producerId`
 *   is who sold the policy; `leads.producerId`, `quoteRecaps.producerId` and
 *   `dealAuditItems.producerId` record who worked them. Clearing those would not
 *   "reassign" anything — it would delete the agency's record of what happened,
 *   break the leaderboard and every "produced by" column, and silently change
 *   historical performance numbers.
 *
 * **Nothing here may ever touch an attribution field.** If a future collection
 * needs releasing, add it only after deciding which of the two it is.
 */
@Injectable()
export class UserWorkReleaseService {
  private readonly logger = new Logger(UserWorkReleaseService.name);

  constructor(
    @InjectModel(ServiceTicket.name)
    private readonly ticketModel: Model<ServiceTicketDocument>,
    @InjectModel(CrmRotation.name)
    private readonly rotationModel: Model<CrmRotationDocument>,
  ) {}

  /** Count what {@link release} would free, without changing anything. */
  async preview(agencyId: string, userId: string): Promise<ReleasedWork> {
    const [ticketsUnassigned, rotationsDeactivated] = await Promise.all([
      this.ticketModel.countDocuments(this.openTicketFilter(agencyId, userId)),
      this.rotationModel.countDocuments(this.rotationFilter(agencyId, userId)),
    ]);
    return { ticketsUnassigned, rotationsDeactivated };
  }

  async release(agencyId: string, userId: string): Promise<ReleasedWork> {
    const [tickets, rotations] = await Promise.all([
      // `assignedRep` is a denormalized display name
      // (`crm/schemas/service-ticket.schema.ts`), so clearing the id alone would
      // leave the board still showing a departed rep against an unassigned
      // ticket. The two fields have to move together.
      this.ticketModel.updateMany(this.openTicketFilter(agencyId, userId), {
        $set: { assignedUserId: null, assignedRep: '' },
      }),

      // Load-bearing, and easy to miss.
      //
      // `CrmAssignmentService` builds its round-robin pool from
      // `{ agencyId, producerId, activeForProducer: true }` and never checks
      // whether the CRM behind `crmId` is still an active user. Releasing this
      // person's current tickets while leaving them in the rotation would hand
      // them a fresh one on the next sold deal — the work would leak straight
      // back to somebody who no longer has an account.
      this.rotationModel.updateMany(this.rotationFilter(agencyId, userId), {
        $set: { activeForProducer: false },
      }),
    ]);

    const released: ReleasedWork = {
      ticketsUnassigned: tickets.modifiedCount,
      rotationsDeactivated: rotations.modifiedCount,
    };

    this.logger.log(
      `Released work for user ${userId}: ${released.ticketsUnassigned} ticket(s) unassigned, ` +
        `${released.rotationsDeactivated} rotation entr(ies) deactivated.`,
    );

    return released;
  }

  /**
   * Tickets still expecting action.
   *
   * Terminal statuses are excluded via the shared
   * `SERVICE_TICKET_TERMINAL_STATUSES` rather than a local list — a resolved or
   * closed ticket is history, and unassigning it would both rewrite the record
   * of who handled it and drop it into the unassigned queue as phantom work.
   */
  private openTicketFilter(agencyId: string, userId: string) {
    return {
      agencyId: new Types.ObjectId(agencyId),
      assignedUserId: new Types.ObjectId(userId),
      status: { $nin: [...SERVICE_TICKET_TERMINAL_STATUSES] },
    };
  }

  /** Rotation entries that would keep feeding this user new work. */
  private rotationFilter(agencyId: string, userId: string) {
    return {
      agencyId: new Types.ObjectId(agencyId),
      crmId: new Types.ObjectId(userId),
      activeForProducer: true,
    };
  }
}
