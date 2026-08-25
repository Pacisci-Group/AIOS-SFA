import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  AccessContext,
  SERVICE_TICKET_TERMINAL_STATUSES,
  ServiceTicketView,
  isTerminalLeadStatus,
  normalizeLeadStatus,
} from '@sfa/shared';
import { Model, Types } from 'mongoose';
import { ClientsService } from '../clients/clients.service';
import { Lead, LeadDocument } from '../leads/schemas/lead.schema';
import {
  ServiceTicket,
  ServiceTicketDocument,
} from './schemas/service-ticket.schema';
import {
  ServiceTicketsService,
  serializeTicket,
} from './service-tickets.service';

/**
 * The tie between a lead and its service ticket.
 *
 * "Start Quote" on the Household page opens a `Quote` ticket alongside the
 * lead, so a quote in flight is visible on the CSR's desk. The two records then
 * share one lifecycle: the ticket has **no status of its own**
 * (`ServiceTicketsService.updateStatus` refuses to write one) and resolves when
 * the lead reaches a terminal status. That is the whole point — a quote's
 * service work finishes exactly when the quote does, and the failure mode this
 * removes is the two disagreeing: a ticket resolved under a live lead, or a
 * sold lead trailing an open ticket forever.
 *
 * Both methods are **internal**: neither runs a permission guard, because
 * neither is reached from a controller directly. `ensureForLead`'s caller
 * (`POST /leads/:id/service-ticket`) has already been guarded on `leads:write`
 * and has already clamped the lead to the caller's scope; `resolveForLead` is a
 * post-write side effect of a lead status change. This mirrors how
 * `ServiceTicketsService.startOnboarding` is called internally rather than
 * through its own endpoint.
 *
 * There is no event bus in this codebase — no `@nestjs/event-emitter`, no
 * Mongoose middleware anywhere — so `resolveForLead` is called explicitly from
 * each of the two paths that can write a terminal lead status. That is the
 * house pattern (`AdvanceLeadStep`, `QuoteRecapsService.advanceLeadStatus`,
 * `SoldDealIntakeService.recordSideEffects`), not a shortcut.
 */
@Injectable()
export class LeadTicketsService {
  private readonly logger = new Logger(LeadTicketsService.name);

  constructor(
    @InjectModel(ServiceTicket.name)
    private readonly ticketModel: Model<ServiceTicketDocument>,
    @InjectModel(Lead.name) private readonly leadModel: Model<LeadDocument>,
    private readonly tickets: ServiceTicketsService,
    private readonly clientsService: ClientsService,
  ) {}

  /**
   * Open the quote ticket for a lead, or return the one that already exists.
   *
   * Idempotent, and it has to be: the Start Quote dialog calls this every run,
   * including when the producer picks a lead from the list that was already
   * quoted once. Two guards, because neither alone is enough — the read catches
   * the common case cheaply, and the `E11000` catch closes the race between two
   * concurrent runs, since the partial-unique `{agencyId, leadId}` index is the
   * only thing that can arbitrate that.
   */
  async ensureForLead(
    access: AccessContext,
    lead: LeadDocument,
  ): Promise<ServiceTicketView> {
    const agencyId = String(lead.agencyId);
    const existing = await this.ticketModel.findOne({
      agencyId: new Types.ObjectId(agencyId),
      leadId: lead._id,
    });
    if (existing) {
      return serializeTicket(
        existing.toObject(),
        normalizeLeadStatus(lead.status),
      );
    }

    const now = new Date();
    // The ticket's branch is the lead's, falling back to the caller's. A lead
    // and its ticket belonging to different branches would hide one from the
    // other under branch scope.
    const branchId = lead.branchId ?? access.branchId ?? null;

    // Display fields come off the household through the same scoped read the
    // Clients pages use, exactly as `ServiceTicketsService.create` does. A lead
    // with no household yet still gets a ticket — the client name falls back to
    // the lead's own, which is what the queue row shows.
    const household = lead.householdId
      ? await this.clientsService
          .getHousehold(access, String(lead.householdId))
          .catch(() => null)
      : null;
    const primaryContact = household?.contacts?.find((c) => c.isPrimary);
    const leadName = [lead.firstName, lead.lastName]
      .filter(Boolean)
      .join(' ')
      .trim();
    const clientName =
      household?.primaryContactName ||
      household?.name ||
      leadName ||
      'Unnamed client';

    // Assigned to whoever pressed Start Quote. Under `own` data scope that is
    // what puts the ticket on their desk at all — an unassigned one would be
    // invisible to the very person who opened it.
    const actingUserId = access.userId;
    const actingUserName = await this.tickets.resolveUserName(actingUserId);

    try {
      const created = await this.tickets.createTicketWithNumber(agencyId, {
        agencyId: new Types.ObjectId(agencyId),
        branchId: branchId ? new Types.ObjectId(String(branchId)) : null,
        clientName,
        category: 'Quote',
        status: 'open',
        priority: 'medium',
        assignedRep: actingUserName,
        assignedUserId: Types.ObjectId.isValid(actingUserId)
          ? new Types.ObjectId(actingUserId)
          : null,
        createdByUserId: Types.ObjectId.isValid(actingUserId)
          ? new Types.ObjectId(actingUserId)
          : null,
        createdByName: actingUserName,
        leadId: lead._id,
        householdId: lead.householdId ?? null,
        household: household?.name ?? '',
        phone:
          primaryContact?.phones?.[0] ??
          household?.primaryPhones?.[0] ??
          lead.phones?.[0] ??
          '',
        email:
          primaryContact?.emails?.[0] ??
          household?.primaryEmails?.[0] ??
          lead.emails?.[0] ??
          '',
        openedAt: now,
        lastActivityAt: now,
        resolvedAt: null,
        timeline: [
          {
            type: 'created',
            author: actingUserName,
            content:
              'Quote started. This ticket resolves when the lead is marked Sold or Closed.',
            at: now,
          },
        ],
      });
      return serializeTicket(
        created.toObject(),
        normalizeLeadStatus(lead.status),
      );
    } catch (error) {
      // Lost the race — the other run's ticket is the one that exists.
      if (isDuplicateKeyError(error)) {
        const raced = await this.ticketModel.findOne({
          agencyId: new Types.ObjectId(agencyId),
          leadId: lead._id,
        });
        if (raced) {
          return serializeTicket(
            raced.toObject(),
            normalizeLeadStatus(lead.status),
          );
        }
      }
      throw error;
    }
  }

  /**
   * Resolve a lead's quote ticket once the lead is finished.
   *
   * One atomic conditional update — the same technique, and the same reasoning,
   * as `AdvanceLeadStep.run`: the "only resolve what is still open" rule is a
   * database invariant rather than a read-then-write race, and re-running it is
   * a no-op, so a caller on a replay path self-heals instead of double-writing
   * the timeline.
   *
   * Best-effort by design. Every caller has already committed the lead status
   * change that triggered it, and failing their request now would report that a
   * status change did not happen when it did.
   *
   * Fires on **any** terminal status, not just Sold and Closed: a `Lost` or
   * `Not Qualified` lead has no service work left either, and leaving its
   * ticket open would strand it in the queue with no way to clear it.
   */
  async resolveForLead(
    leadId: Types.ObjectId | string,
    agencyId: string,
    leadStatus?: string | null,
  ): Promise<void> {
    if (!isTerminalLeadStatus(leadStatus)) return;

    try {
      const now = new Date();
      await this.ticketModel.findOneAndUpdate(
        {
          agencyId: new Types.ObjectId(agencyId),
          leadId: new Types.ObjectId(String(leadId)),
          status: { $nin: [...SERVICE_TICKET_TERMINAL_STATUSES] },
        },
        {
          $set: {
            status: 'resolved',
            // Starts the 7-day archive clock, same as a hand-resolved ticket.
            resolvedAt: now,
            lastActivityAt: now,
          },
          $push: {
            timeline: {
              type: 'system',
              author: 'System',
              content: `Lead marked ${normalizeLeadStatus(leadStatus)} — ticket resolved.`,
              at: now,
            },
          },
        },
      );
    } catch (error) {
      this.logger.error(
        `Failed to resolve the quote ticket for lead ${String(leadId)}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Load a lead by id within the caller's agency, for the ensure endpoint.
   *
   * Deliberately **not** `LeadAccessService.loadOwnedLead`: importing
   * `LeadsModule` here would close the cycle (`LeadsModule` imports
   * `CrmModule`). The caller in `LeadsService` applies that clamp before
   * reaching this service, so this is the agency-level backstop, not the
   * primary check.
   */
  async loadLeadInAgency(
    agencyId: string,
    leadId: string,
  ): Promise<LeadDocument> {
    if (!Types.ObjectId.isValid(leadId)) {
      throw new NotFoundException('Lead not found');
    }
    const lead = await this.leadModel.findOne({
      _id: new Types.ObjectId(leadId),
      agencyId,
    });
    if (!lead) {
      throw new NotFoundException('Lead not found');
    }
    return lead;
  }
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: number }).code === 11000
  );
}
