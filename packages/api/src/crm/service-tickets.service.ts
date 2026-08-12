import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  AccessContext,
  DataScope,
  DEFAULT_ONBOARDING_STEP_DEFINITIONS,
  ONBOARDING_CHECKLIST_KEYS,
  ONBOARDING_STEP_KEYS,
  ONBOARDING_STEP_LABELS,
  DEFAULT_RENEWAL_STEP_DEFINITIONS,
  RENEWAL_OUTCOME_LABELS,
  RENEWAL_STEP_LABELS,
  renewalTrackFor,
  SERVICE_TICKET_ARCHIVE_AFTER_DAYS,
  SERVICE_TICKET_TERMINAL_STATUSES,
  ServiceTicketActivity,
  ServiceTicketAssignee,
  ServiceTicketStats,
  ServiceTicketView,
  isTerminalTicketStatus,
  normalizeLeadStatus,
  allowsPolicyTransfer,
} from '@sfa/shared';
import type {
  OnboardingStepDefinition,
  OnboardingStepKey,
  OnboardingView,
  RenewalCycleView,
  RenewalDeskRow,
  RenewalStepDefinition,
  PolicyTransferRef,
  RenewalStepKey,
  RenewalTrack,
  ServiceTicketStatus,
} from '@sfa/shared';
import { FilterQuery, Model, Types } from 'mongoose';
import {
  ClientsService,
  type PolicyRenewalCandidate,
} from '../clients/clients.service';
import { Deal, DealDocument } from '../deals/schemas/deal.schema';
import {
  DealAudit,
  DealAuditDocument,
} from '../deal-audits/schemas/deal-audit.schema';
import { Lead, LeadDocument } from '../leads/schemas/lead.schema';
import { Policy, PolicyDocument } from '../policies/schemas/policy.schema';
import { PolicyTransfersService } from './policy-transfers.service';
import type { PresignTransferDocumentDto } from '../sold-deals/dto/presign-sold-document.dto';
import type { CreatePolicyTransferDto } from './dto/policy-transfer.dto';
import {
  AgencyRole,
  AgencyRoleDocument,
} from '../roles/schemas/agency-role.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  AddNoteDto,
  CompleteRenewalStepDto,
  CreateServiceTicketDto,
  ListTicketsQueryDto,
  UpdateOnboardingChecklistDto,
  SetRenewalOutcomeDto,
  UpdateOnboardingEmailsDto,
  UpdateRenewalPoliciesDto,
  UpdateStatusDto,
} from './dto/service-ticket.dto';
import {
  deriveOnboardingStatus,
  isStepActionable,
  scheduleSteps,
  type PlannedStep,
  type StepTiming,
} from './onboarding/onboarding-scheduling';
import {
  formatTermKey,
  renewalAnchorDate,
  scheduleRenewalSteps,
  type PlannedRenewalStep,
} from './renewal/renewal-scheduling';
import {
  renewalStepStatus,
  serializeRenewalCycle,
  serializeRenewalPolicy,
  serializeRenewalStep,
} from './renewal/renewal-serializer';
import {
  RenewalCycle,
  RenewalCycleDocument,
} from './schemas/renewal-cycle.schema';
import {
  RenewalScanState,
  RenewalScanStateDocument,
} from './schemas/renewal-scan-state.schema';
import {
  serializeOnboarding,
  serializeOnboardingStep,
} from './onboarding/onboarding-serializer';
import { Onboarding, OnboardingDocument } from './schemas/onboarding.schema';
import {
  OnboardingStepDefinitionDocument,
  OnboardingStepDefinitionRecord,
} from './schemas/onboarding-step-definition.schema';
import {
  ServiceTicket,
  ServiceTicketActivityEntry,
  ServiceTicketDocument,
} from './schemas/service-ticket.schema';

@Injectable()
export class ServiceTicketsService {
  constructor(
    @InjectModel(ServiceTicket.name)
    private ticketModel: Model<ServiceTicketDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(AgencyRole.name)
    private roleModel: Model<AgencyRoleDocument>,
    @InjectModel(OnboardingStepDefinitionRecord.name)
    private stepDefinitionModel: Model<OnboardingStepDefinitionDocument>,
    @InjectModel(Onboarding.name)
    private onboardingModel: Model<OnboardingDocument>,
    @InjectModel(RenewalCycle.name)
    private cycleModel: Model<RenewalCycleDocument>,
    @InjectModel(RenewalScanState.name)
    private scanStateModel: Model<RenewalScanStateDocument>,
    // Read-only, for the linked lead's status on a quote ticket. The schema is
    // registered on `CrmModule`; `LeadsModule` itself is deliberately not
    // imported here — it imports `CrmModule`, and the dependency runs that way.
    @InjectModel(Lead.name) private leadModel: Model<LeadDocument>,
    // Read-only, for the policy transfer a ticket may carry.
    @InjectModel(Deal.name) private dealModel: Model<DealDocument>,
    @InjectModel(Policy.name) private policyModel: Model<PolicyDocument>,
    @InjectModel(DealAudit.name)
    private dealAuditModel: Model<DealAuditDocument>,
    private readonly clientsService: ClientsService,
    private readonly policyTransfers: PolicyTransfersService,
  ) {}

  /**
   * Users who can own a ticket as its Assigned Client Relation Manager — the
   * agency's CSR and CRM role holders. Served here (not from `/users`) so a CSR
   * can populate the picker with only `crm_service:read`.
   */
  async listAssignees(access: AccessContext): Promise<ServiceTicketAssignee[]> {
    if (!access.agencyId) {
      throw new ForbiddenException('Agency context required');
    }
    const agencyId = new Types.ObjectId(access.agencyId);

    const roles = await this.roleModel
      .find({ agencyId, slug: { $in: ASSIGNABLE_ROLE_SLUGS } })
      .select('slug')
      .lean();
    if (!roles.length) {
      return [];
    }
    const slugById = new Map(roles.map((r) => [String(r._id), r.slug]));

    const filter: FilterQuery<UserDocument> = {
      agencyId,
      isPlatformAdmin: { $ne: true },
      isActive: { $ne: false },
      roleIds: { $in: roles.map((r) => r._id) },
    };
    // Agency-wide scopes see every CRM; narrower scopes stay inside the branch.
    if (access.dataScope !== DataScope.Agency && access.branchId) {
      filter.branchId = new Types.ObjectId(access.branchId);
    }

    const users = await this.userModel
      .find(filter)
      .select('firstName lastName email roleIds')
      .sort({ firstName: 1, lastName: 1 })
      .lean();

    return users.map((user) => ({
      id: String(user._id),
      name: userDisplayName(user),
      email: user.email ?? '',
      roles: (user.roleIds ?? [])
        .map((id) => slugById.get(String(id)))
        .filter((slug): slug is string => Boolean(slug)),
    }));
  }

  /**
   * Build the tenant + data-scope filter for the requesting user. `own` sees
   * only tickets assigned to them, `branch` sees their branch, `agency` sees
   * the whole agency.
   */
  private scopeFilter(
    access: AccessContext,
  ): FilterQuery<ServiceTicketDocument> {
    if (!access.agencyId) {
      // No agency context => nothing to see (defensive; guards prevent this).
      throw new ForbiddenException('Agency context required');
    }
    const filter: FilterQuery<ServiceTicketDocument> = {
      agencyId: new Types.ObjectId(access.agencyId),
    };

    if (access.dataScope === DataScope.Agency) {
      return filter;
    }
    if (access.dataScope === DataScope.Branch) {
      if (access.branchId) {
        filter.branchId = new Types.ObjectId(access.branchId);
      }
      return filter;
    }
    // own
    filter.assignedUserId = new Types.ObjectId(access.userId);
    return filter;
  }

  async list(
    access: AccessContext,
    query: ListTicketsQueryDto,
  ): Promise<ServiceTicketView[]> {
    const filter = this.scopeFilter(access);
    if (query.category) {
      filter.category = query.category;
    }
    if (query.status) {
      // Onboarding status is derived from step timing unless someone set it by
      // hand, so these tickets match on the steps — except the overridden ones,
      // which match the stored field like every other category does.
      const onboardingBranch = onboardingStatusMatch(query.status, new Date());
      filter.$and = [
        ...(filter.$and ?? []),
        {
          $or: [
            { category: { $ne: 'Onboarding' }, status: query.status },
            {
              category: 'Onboarding',
              statusOverriddenAt: { $ne: null },
              status: query.status,
            },
            ...(onboardingBranch
              ? [
                  {
                    category: 'Onboarding',
                    statusOverriddenAt: null,
                    ...onboardingBranch,
                  },
                ]
              : []),
          ],
        },
      ];
    }
    // Resolved tickets age out of the active queue after the archive window;
    // the Archived Tickets view asks for exactly the other side of that line.
    const archivedCondition = archivedMatch(archiveCutoff());
    if (query.archived) {
      filter.$and = [...(filter.$and ?? []), archivedCondition];
    } else {
      filter.$nor = [archivedCondition];
    }

    // A scheduled onboarding call is not on anyone's plate until it opens, so
    // it stays out of every list. `findOne` still returns it, so the chain
    // view and deep links keep working.
    filter.$nor = [...(filter.$nor ?? []), ...scheduledStepMatches(new Date())];

    const tickets = await this.ticketModel
      .find(filter)
      .sort({ lastActivityAt: -1 })
      .lean();
    return tickets.map((t) => serializeTicket(t));
  }

  /**
   * Every ticket a client owns, most recently touched first — the history
   * behind the household page's Activity & Tickets column.
   *
   * Deliberately unlike `list()` in one way: archived tickets stay in. A
   * client's history is the whole history, and dropping the ticket that was
   * resolved eight days ago would read as "that never happened" rather than
   * "that has aged out of the queue". `isArchived` on the view lets the caller
   * tell the two apart if it wants to.
   *
   * Scheduled steps stay out for the same reason they do everywhere else —
   * they are not work yet, and the household page shows the upcoming
   * onboarding calls in its own block above this one.
   *
   * The caller's data scope still applies, so an `own`-scoped user sees the
   * client's tickets that are assigned to them, not the branch's.
   */
  async listForHousehold(
    access: AccessContext,
    householdId: string,
  ): Promise<ServiceTicketView[]> {
    if (!Types.ObjectId.isValid(householdId)) {
      return [];
    }
    const filter = this.scopeFilter(access);
    filter.householdId = new Types.ObjectId(householdId);
    filter.$nor = scheduledStepMatches(new Date());

    const tickets = await this.ticketModel
      .find(filter)
      .sort({ lastActivityAt: -1 })
      .lean();
    return tickets.map((t) => serializeTicket(t));
  }

  async findOne(access: AccessContext, id: string): Promise<ServiceTicketView> {
    const ticket = await this.getScopedOrThrow(access, id);
    return serializeTicket(
      ticket.toObject(),
      await this.leadStatus(ticket),
      await this.policyTransfer(ticket),
    );
  }

  /**
   * A presigned PUT for a policy-transfer document.
   *
   * The scope clamp lives here, not in `PolicyTransfersService`: the ticket is
   * the transfer's only anchor, so `getScopedOrThrow` — which 404s an
   * out-of-scope ticket — is what stands in for the sold path's
   * `loadOwnedLead`. Everything downstream reads the household off the ticket
   * it has already been handed, so nothing the client sends can widen it.
   */
  async presignPolicyTransferDocument(
    access: AccessContext,
    id: string,
    dto: PresignTransferDocumentDto,
  ) {
    const ticket = await this.getScopedOrThrow(access, id);
    return this.policyTransfers.presign(ticket, dto);
  }

  /** Record a policy transfer and return the refreshed ticket. */
  async recordPolicyTransfer(
    access: AccessContext,
    id: string,
    dto: CreatePolicyTransferDto,
  ): Promise<ServiceTicketView> {
    const ticket = await this.getScopedOrThrow(access, id);
    await this.policyTransfers.record(access, ticket, dto);
    return this.findOne(access, id);
  }

  /**
   * The transfer booked from this ticket, or null.
   *
   * Read from the `Deal` and its policies rather than a record of its own —
   * with a per-row from-policy the existing graph already expresses a transfer
   * completely, and a parallel collection would only duplicate it.
   *
   * Single-ticket read only, like `leadStatus`: this is three queries, and no
   * list surface renders it.
   */
  private async policyTransfer(
    ticket: ServiceTicketDocument,
  ): Promise<PolicyTransferRef | null> {
    const deal = await this.dealModel
      .findOne({ agencyId: String(ticket.agencyId), ticketId: ticket._id })
      .lean();
    if (!deal) return null;

    const policies = await this.policyModel
      .find({ dealId: deal._id })
      .select(
        'policyNumber policyType premium transferredFromPolicyId createdAt',
      )
      .lean();

    const fromIds = policies
      .map((p) => p.transferredFromPolicyId)
      .filter((id): id is Types.ObjectId => id != null);
    const fromPolicies = fromIds.length
      ? await this.policyModel
          .find({ _id: { $in: fromIds } })
          .select('policyNumber policyType premium')
          .lean()
      : [];
    const fromById = new Map(fromPolicies.map((p) => [String(p._id), p]));

    const pairs = policies.flatMap((to) => {
      if (!to.transferredFromPolicyId) return [];
      const from = fromById.get(String(to.transferredFromPolicyId));
      if (!from) return [];
      return [
        {
          fromPolicyId: String(from._id),
          fromPolicyNumber: from.policyNumber ?? null,
          fromPolicyType: from.policyType ?? null,
          fromPremium: from.premium ?? 0,
          toPolicyId: String(to._id),
          toPolicyNumber: to.policyNumber ?? null,
          toPolicyType: to.policyType ?? null,
          toPremium: to.premium ?? 0,
        },
      ];
    });

    // Null rather than 0 when a from-policy no longer resolves: an unknown
    // saving is not a saving of nothing.
    const premiumDelta =
      pairs.length === policies.length
        ? pairs.reduce((sum, p) => sum + (p.toPremium - p.fromPremium), 0)
        : null;

    const audit = await this.dealAuditModel
      .findOne({ agencyId: String(ticket.agencyId), dealId: deal._id })
      .select('_id')
      .lean();

    return {
      dealId: String(deal._id),
      transferDate: deal.soldDate ? deal.soldDate.toISOString() : null,
      premium: deal.premium ?? 0,
      policyCount: deal.policyCount ?? policies.length,
      premiumDelta,
      recordedByName: deal.producerId
        ? await this.resolveUserName(String(deal.producerId))
        : 'System',
      recordedAt: (deal.createdAt ?? new Date()).toISOString(),
      dealAuditId: audit ? String(audit._id) : null,
      pairs,
    };
  }

  /**
   * The linked lead's status, for the workspace header's "resolves when the
   * lead closes" line. Null for every ticket that is not a quote.
   *
   * Read unscoped by design: the CSR is being told why the ticket in front of
   * them cannot be resolved, and the ticket is already scope-checked. Clamping
   * this to the CSR's own leads would blank the explanation on exactly the
   * tickets that need it — a lead whose producer is someone else.
   */
  private async leadStatus(
    ticket: Pick<ServiceTicket, 'leadId'>,
  ): Promise<string | null> {
    if (!ticket.leadId) return null;
    const lead = await this.leadModel
      .findById(ticket.leadId)
      .select('status')
      .lean();
    return lead ? normalizeLeadStatus(lead.status) : null;
  }

  async create(
    access: AccessContext,
    dto: CreateServiceTicketDto,
  ): Promise<ServiceTicketView> {
    if (!access.agencyId) {
      throw new ForbiddenException('Agency context required');
    }

    // Resolve the assignee. Default to the creator when none is provided so
    // `own`-scoped users always see the tickets they create.
    const assignedUserId = dto.assignedUserId ?? access.userId;
    const assignee = assignedUserId
      ? await this.userModel
          .findById(assignedUserId)
          .select('firstName lastName email branchId')
          .lean()
      : null;
    const assignedRep = dto.assignedRep ?? userDisplayName(assignee);

    // The ticket's branch is the creator's branch, falling back to the
    // assignee's branch (e.g. an agency-scoped owner assigning to a rep).
    const branchId =
      access.branchId ??
      (assignee?.branchId ? String(assignee.branchId) : null);

    const now = new Date();
    const ticketNumber = await this.nextTicketNumber(
      access.agencyId,
      dto.category,
    );
    // Created-by is always the caller — never something the client can set.
    const createdByName = await this.resolveUserName(access.userId);

    // Pull the display fields off the linked records so a ticket created from
    // the pickers alone still shows a client, policy, and household. Both reads
    // are scope-checked, so an out-of-scope id 404s rather than linking.
    const linkedPolicy = dto.policyId
      ? await this.clientsService.getPolicy(access, dto.policyId)
      : null;
    const householdId = dto.householdId ?? linkedPolicy?.household?.id ?? null;
    const linkedHousehold = householdId
      ? await this.clientsService.getHousehold(access, householdId)
      : null;

    const householdName =
      linkedHousehold?.name ?? linkedPolicy?.household?.name;
    const clientName =
      dto.clientName?.trim() ||
      linkedHousehold?.primaryContactName ||
      householdName ||
      'Unnamed client';
    const primaryContact = linkedHousehold?.contacts?.find((c) => c.isPrimary);

    // Onboarding is a chain, not a single ticket. Creating one by hand starts
    // the whole journey — the parent record plus the welcome-call ticket — and
    // returns that first ticket, so the New Ticket dialog behaves as expected.
    // This is the interim entry point until deal-audit approval calls
    // `startOnboarding` directly (see TODO(PAC-14)).
    if (dto.category === 'Onboarding') {
      if (!householdId) {
        throw new BadRequestException(
          'An onboarding ticket requires a household — onboarding is tracked per client',
        );
      }
      const started = await this.startOnboarding({
        agencyId: access.agencyId,
        branchId,
        householdId,
        clientName,
        assignedUserId,
        policyId: dto.policyId ?? linkedPolicy?.id ?? null,
        policyNumber: dto.policyNumber ?? linkedPolicy?.policyNumber ?? '',
        policyType: dto.policyType ?? linkedPolicy?.policyType ?? '',
        householdName: dto.household ?? householdName ?? '',
        phone:
          dto.phone ??
          primaryContact?.phones?.[0] ??
          linkedHousehold?.primaryPhones?.[0] ??
          '',
        email:
          dto.email ??
          primaryContact?.emails?.[0] ??
          linkedHousehold?.primaryEmails?.[0] ??
          '',
        createdByUserId: access.userId,
        createdByName,
        openingNote: dto.openingNote?.trim(),
      });
      const firstTicketId = started.chain.find((s) => s.ticketId)?.ticketId;
      if (firstTicketId) {
        return this.findOne(access, firstTicketId);
      }
    }

    const timeline: ServiceTicketActivityEntry[] = [
      {
        type: 'created',
        content: dto.openingNote?.trim()
          ? dto.openingNote.trim()
          : `Ticket opened — ${dto.category}.`,
        at: now,
      },
    ];

    const created = await this.ticketModel.create({
      agencyId: new Types.ObjectId(access.agencyId),
      branchId: branchId ? new Types.ObjectId(branchId) : null,
      ticketNumber,
      clientName,
      category: dto.category,
      status: dto.status ?? 'open',
      priority: dto.priority ?? 'medium',
      assignedRep,
      assignedUserId: assignedUserId
        ? new Types.ObjectId(assignedUserId)
        : null,
      createdByUserId:
        access.userId && Types.ObjectId.isValid(access.userId)
          ? new Types.ObjectId(access.userId)
          : null,
      createdByName,
      policyNumber: dto.policyNumber ?? linkedPolicy?.policyNumber ?? '',
      policyType: dto.policyType ?? linkedPolicy?.policyType ?? '',
      household: dto.household ?? householdName ?? '',
      policyId: dto.policyId ? new Types.ObjectId(dto.policyId) : null,
      householdId: householdId ? new Types.ObjectId(householdId) : null,
      phone:
        dto.phone ??
        primaryContact?.phones?.[0] ??
        linkedHousehold?.primaryPhones?.[0] ??
        '',
      email:
        dto.email ??
        primaryContact?.emails?.[0] ??
        linkedHousehold?.primaryEmails?.[0] ??
        '',
      openedAt: now,
      lastActivityAt: now,
      resolvedAt: isTerminalTicketStatus(dto.status ?? 'open') ? now : null,
      timeline,
      // Onboarding tickets never reach here — they are created by
      // `startOnboarding` above, which owns the chain.
      onboarding: null,
    });

    return serializeTicket(created.toObject());
  }

  async updateStatus(
    access: AccessContext,
    id: string,
    dto: UpdateStatusDto,
  ): Promise<ServiceTicketView> {
    const ticket = await this.getScopedOrThrow(access, id);

    // A quote ticket has no status of its own. It exists because a lead is
    // being quoted, and it is finished exactly when that lead is — so the lead
    // owns the transition and `resolveForLead` performs it. Letting a CSR
    // resolve this by hand is the disagreement the link exists to prevent, and
    // the picker already renders a static badge; this is the server-side half
    // of the same rule, for anyone calling the API directly.
    if (ticket.leadId) {
      throw new BadRequestException(
        "This ticket's status follows its lead — mark the lead Sold or Closed to resolve it.",
      );
    }

    // An onboarding ticket's status is normally derived from its call step's
    // timing, so a plain write to `ticket.status` would be discarded on the way
    // back out. Setting one by hand therefore also stamps `statusOverriddenAt`,
    // which tells `serializeTicket` to read the stored value from then on — the
    // picker offers the same four statuses here as on any other ticket.
    //
    // Resolving additionally *completes the call* when the step is open, so the
    // chain still advances and the next call opens. Without that, a resolved
    // onboarding ticket would leave its chain stalled.
    if (ticket.onboarding) {
      const previous = serializeTicket(ticket.toObject()).status;
      const canCompleteStep =
        isTerminalTicketStatus(dto.status) &&
        isStepActionable(
          {
            availableAt: ticket.onboarding.availableAt
              ? new Date(ticket.onboarding.availableAt)
              : null,
            dueAt: null,
            completedAt: ticket.onboarding.completedAt
              ? new Date(ticket.onboarding.completedAt)
              : null,
          },
          new Date(),
        );

      if (canCompleteStep) {
        await this.completeStepOnTicket(access, ticket);
        // The completion already derives to `resolved` and logged its own
        // timeline entry, so there is nothing left to override.
        if (dto.status === 'resolved') {
          return serializeTicket(ticket.toObject());
        }
      }
      if (previous !== dto.status) {
        await this.applyManualStatus(access, ticket, previous, dto.status);
      }
      return serializeTicket(ticket.toObject());
    }

    const previous = ticket.status;
    if (previous !== dto.status) {
      await this.applyManualStatus(access, ticket, previous, dto.status);
    }
    return serializeTicket(ticket.toObject());
  }

  /**
   * Write a hand-picked status and log it. On an onboarding ticket this also
   * stamps `statusOverriddenAt`, which is what makes the stored value beat the
   * call schedule on the way back out.
   */
  private async applyManualStatus(
    access: AccessContext,
    ticket: ServiceTicketDocument,
    previous: ServiceTicketStatus,
    next: ServiceTicketStatus,
  ): Promise<void> {
    const now = new Date();
    ticket.status = next;
    ticket.lastActivityAt = now;
    // Restart the archive clock each time the ticket ends; reopening clears it.
    ticket.resolvedAt = isTerminalTicketStatus(next) ? now : null;
    if (ticket.onboarding) {
      ticket.statusOverriddenAt = now;
    }
    ticket.timeline.push({
      type: 'status',
      author: await this.resolveUserName(access.userId),
      content: `Status changed: ${statusLabel(previous)} → ${statusLabel(next)}`,
      at: now,
    });
    await ticket.save();
  }

  async addNote(
    access: AccessContext,
    id: string,
    dto: AddNoteDto,
  ): Promise<ServiceTicketView> {
    const ticket = await this.getScopedOrThrow(access, id);
    const now = new Date();
    ticket.timeline.push({
      type: dto.type ?? 'note',
      author: await this.resolveUserName(access.userId),
      content: dto.content.trim(),
      at: now,
    });
    ticket.lastActivityAt = now;
    await ticket.save();
    return serializeTicket(ticket.toObject());
  }

  async stats(access: AccessContext): Promise<ServiceTicketStats> {
    const filter = this.scopeFilter(access);
    // Scheduled onboarding calls are not work yet — keep them out of the KPIs
    // for the same reason they are kept out of the queue.
    filter.$nor = scheduledStepMatches(new Date());
    const tickets = await this.ticketModel.find(filter).lean();

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const openTickets = tickets.filter(
      (t) => !isTerminalTicketStatus(t.status),
    ).length;
    const needsActionToday = tickets.filter(
      (t) => t.status === 'overdue',
    ).length;
    const resolvedToday = tickets.filter(
      (t) =>
        isTerminalTicketStatus(t.status) &&
        t.lastActivityAt &&
        new Date(t.lastActivityAt) >= startOfToday,
    ).length;
    const households = new Set(
      tickets.map((t) => t.household || t.clientName).filter(Boolean),
    );

    return {
      openTickets,
      needsActionToday,
      resolvedToday,
      // Renewal-desk metrics are not modeled yet; surface sensible defaults so
      // the scorecard renders without inventing ticket data.
      upcomingRenewals: 0,
      premiumIncreases: 0,
      dailyTarget: Math.max(resolvedToday, 10),
      totalHouseholds: households.size,
      avgLobDensity: 0,
    };
  }

  /* ---------------------------------------------------------------- *
   * Onboarding
   * ---------------------------------------------------------------- */

  /**
   * Start a client's onboarding: create the `Onboarding` record and the first
   * ticket (the welcome call), available immediately.
   *
   * TODO(PAC-14): call this from the deal-audit approval action once it
   * exists. That action is currently unowned — see the comment thread on
   * PAC-14 — so onboardings are started by hand until it lands.
   *
   * Idempotent on `dealId`, backed by the unique partial index on the
   * `onboardings` collection, so a retried approval is harmless.
   *
   * NOTE: `Deal` and `Household` are `TenantRecord`s, where `agencyId` /
   * `branchId` are plain strings; `ServiceTicket` and `Onboarding` store them
   * as `ObjectId`. Casting is required crossing this boundary — getting it
   * wrong returns zero documents silently rather than erroring.
   */
  async startOnboarding(input: {
    agencyId: string;
    branchId: string | null;
    householdId: string;
    clientName: string;
    salesProducerName?: string;
    dealId?: string | null;
    dealAuditId?: string | null;
    assignedUserId?: string | null;
    startedAt?: Date;
    /** Display context copied onto every ticket in the chain. */
    policyId?: string | null;
    policyNumber?: string;
    policyType?: string;
    householdName?: string;
    phone?: string;
    email?: string;
    createdByUserId?: string | null;
    createdByName?: string;
    openingNote?: string;
  }): Promise<OnboardingView> {
    if (!input.householdId || !Types.ObjectId.isValid(input.householdId)) {
      throw new BadRequestException(
        'An onboarding requires a household — it is tracked per client',
      );
    }

    const agencyId = new Types.ObjectId(input.agencyId);
    const dealId = input.dealId ? new Types.ObjectId(input.dealId) : null;

    // Idempotency: one onboarding per deal. Hand-started onboardings have no
    // deal and are therefore never deduplicated.
    if (dealId) {
      const existing = await this.onboardingModel.findOne({ agencyId, dealId });
      if (existing) {
        return this.serializeOnboardingById(existing);
      }
    }

    const startedAt = input.startedAt ?? new Date();
    const onboarding = await this.onboardingModel.create({
      agencyId,
      branchId: input.branchId ? new Types.ObjectId(input.branchId) : null,
      householdId: new Types.ObjectId(input.householdId),
      clientName: input.clientName || 'Unnamed client',
      salesProducerName: input.salesProducerName ?? '',
      dealId,
      dealAuditId: input.dealAuditId
        ? new Types.ObjectId(input.dealAuditId)
        : null,
      assignedCsrId: input.assignedUserId
        ? new Types.ObjectId(input.assignedUserId)
        : null,
      startedAt,
      currentStepKey: ONBOARDING_STEP_KEYS[0],
      completedAt: null,
      policyId: input.policyId ? new Types.ObjectId(input.policyId) : null,
      policyNumber: input.policyNumber ?? '',
      policyType: input.policyType ?? '',
      householdName: input.householdName ?? '',
      phone: input.phone ?? '',
      email: input.email ?? '',
      createdByUserId:
        input.createdByUserId && Types.ObjectId.isValid(input.createdByUserId)
          ? new Types.ObjectId(input.createdByUserId)
          : null,
      createdByName: input.createdByName ?? '',
      openingNote: input.openingNote ?? '',
    });

    await this.ensureStepTicket(onboarding, ONBOARDING_STEP_KEYS[0]);
    return this.serializeOnboardingById(onboarding);
  }

  /**
   * Complete an onboarding call and open the next one.
   *
   * This spans three documents, and local Mongo runs standalone (no replica
   * set), so there is no transaction to lean on. Safety comes from ordering
   * and idempotency instead:
   *
   *   1. stamp the completion — one atomic document update, the only write
   *      that must not be lost;
   *   2. create the next ticket — upserted against the unique
   *      `{agencyId, onboardingId, stepKey}` index, so a retry cannot duplicate;
   *   3. advance the parent record.
   *
   * If 2 or 3 fail the data is incomplete, never corrupt, and
   * `reconcileOnboarding` replays them from the completed tickets.
   */
  async completeOnboardingStep(
    access: AccessContext,
    id: string,
    stepKey: string,
  ): Promise<ServiceTicketView> {
    const ticket = await this.getScopedOrThrow(access, id);
    const step = requireOnboardingStep(ticket);

    if (step.stepKey !== stepKey) {
      throw new BadRequestException(
        `This ticket is the ${ONBOARDING_STEP_LABELS[step.stepKey]} step, not ${stepKey}`,
      );
    }

    return this.completeStepOnTicket(access, ticket);
  }

  /**
   * The completion itself, shared by the explicit "complete this call" action
   * and by resolving an onboarding ticket through the status picker. The caller
   * has already established that `ticket` carries the step being completed.
   */
  private async completeStepOnTicket(
    access: AccessContext,
    ticket: ServiceTicketDocument,
  ): Promise<ServiceTicketView> {
    const step = requireOnboardingStep(ticket);

    if (step.completedAt) {
      throw new BadRequestException('Step is already complete');
    }

    const now = new Date();
    if (
      !step.availableAt ||
      new Date(step.availableAt).getTime() > now.getTime()
    ) {
      throw new BadRequestException('Step is not available yet');
    }

    // (1) Stamp the completion.
    const completedByName = await this.resolveUserName(access.userId);
    step.completedAt = now;
    step.completedBy =
      access.userId && Types.ObjectId.isValid(access.userId)
        ? new Types.ObjectId(access.userId)
        : null;
    step.completedByName = completedByName;

    ticket.timeline.push({
      type: 'system',
      author: completedByName,
      content: `${ONBOARDING_STEP_LABELS[step.stepKey] ?? step.stepKey} completed.`,
      at: now,
    });
    ticket.lastActivityAt = now;
    ticket.status = 'resolved';
    ticket.resolvedAt = now;
    // The schedule is authoritative again: a completed step derives to
    // `resolved`, which is what any earlier hand-set status was standing in for.
    ticket.statusOverriddenAt = null;
    ticket.markModified('onboarding');
    await ticket.save();

    // (2) + (3) Open the next call and advance the parent. Both idempotent.
    const onboarding = await this.onboardingModel.findById(step.onboardingId);
    if (onboarding) {
      await this.reconcileOnboarding(onboarding);
    }

    return serializeTicket(ticket.toObject());
  }

  /**
   * Bring an onboarding's chain back in line with its completed tickets.
   *
   * Creates whatever ticket should exist next and refreshes `currentStepKey` /
   * `completedAt`. Idempotent and safe to call at any time — it is the repair
   * path for a chain that was interrupted between writes, and it runs on every
   * read of an onboarding so a dropped link self-heals the next time anyone
   * looks at it.
   */
  async reconcileOnboarding(
    onboarding: OnboardingDocument,
  ): Promise<OnboardingDocument> {
    const tickets = await this.chainTickets(onboarding);
    const completedAtByKey: Partial<Record<OnboardingStepKey, Date | null>> =
      {};
    for (const ticket of tickets) {
      if (ticket.onboarding) {
        completedAtByKey[ticket.onboarding.stepKey] = ticket.onboarding
          .completedAt
          ? new Date(ticket.onboarding.completedAt)
          : null;
      }
    }

    // The earliest step with no completion is the one that should be open.
    const nextStepKey =
      ONBOARDING_STEP_KEYS.find((key) => !completedAtByKey[key]) ?? null;

    if (nextStepKey) {
      // Only create it once its predecessor has actually closed; otherwise the
      // step is not schedulable yet and `ensureStepTicket` would no-op anyway.
      await this.ensureStepTicket(onboarding, nextStepKey);
      onboarding.currentStepKey = nextStepKey;
      onboarding.completedAt = null;
    } else {
      // Every call is done — the client's onboarding is complete.
      onboarding.currentStepKey = null;
      const lastCompletion = Object.values(completedAtByKey)
        .filter((d): d is Date => Boolean(d))
        .sort((a, b) => b.getTime() - a.getTime())[0];
      onboarding.completedAt = lastCompletion ?? new Date();
    }

    await onboarding.save();
    return onboarding;
  }

  /**
   * Create the ticket for `stepKey` if it does not already exist and its
   * timing is known. Returns silently when the step is not yet schedulable
   * (its predecessor is still open) or the ticket already exists — the unique
   * `{agencyId, onboardingId, stepKey}` index is the real guarantee, and a
   * concurrent duplicate is swallowed rather than surfaced.
   */
  private async ensureStepTicket(
    onboarding: OnboardingDocument,
    stepKey: OnboardingStepKey,
  ): Promise<void> {
    const existing = await this.ticketModel.findOne({
      agencyId: onboarding.agencyId,
      'onboarding.onboardingId': onboarding._id,
      'onboarding.stepKey': stepKey,
    });
    if (existing) {
      return;
    }

    const timing = await this.planStep(onboarding, stepKey);
    if (!timing?.availableAt) {
      // Predecessor still open — nothing to schedule yet.
      return;
    }

    const sequence = ONBOARDING_STEP_KEYS.indexOf(stepKey) + 1;
    const label = ONBOARDING_STEP_LABELS[stepKey];
    const assignee = onboarding.assignedCsrId
      ? await this.userModel
          .findById(onboarding.assignedCsrId)
          .select('firstName lastName email')
          .lean()
      : null;

    try {
      await this.createTicketWithNumber(String(onboarding.agencyId), {
        agencyId: onboarding.agencyId,
        branchId: onboarding.branchId,
        clientName: onboarding.clientName,
        category: 'Onboarding',
        status: 'open',
        priority: 'medium',
        assignedRep: userDisplayName(assignee),
        assignedUserId: onboarding.assignedCsrId,
        householdId: onboarding.householdId,
        // Same client context on every call in the chain.
        policyId: onboarding.policyId,
        policyNumber: onboarding.policyNumber,
        policyType: onboarding.policyType,
        household: onboarding.householdName,
        phone: onboarding.phone,
        email: onboarding.email,
        createdByUserId: onboarding.createdByUserId,
        createdByName: onboarding.createdByName,
        openedAt: timing.availableAt,
        lastActivityAt: timing.availableAt,
        resolvedAt: null,
        timeline: [
          {
            type: 'created',
            content:
              sequence === 1
                ? // Whoever started the onboarding gets their note on the
                  // first call; later calls are opened by the system.
                  onboarding.openingNote ||
                  `Onboarding started — ${label}. Sold by ${onboarding.salesProducerName || 'unknown producer'}.`
                : `${label} scheduled — step ${sequence} of ${ONBOARDING_STEP_KEYS.length}.`,
            at: new Date(),
          },
        ],
        onboarding: {
          onboardingId: onboarding._id,
          stepKey,
          sequence,
          availableAt: timing.availableAt,
          dueAt: timing.dueAt,
          completedAt: null,
          completedBy: null,
          completedByName: '',
        },
      });
    } catch (error) {
      // A concurrent completion already opened this step. The unique index did
      // its job; there is nothing to repair.
      if (!isDuplicateKeyError(error)) {
        throw error;
      }
    }
  }

  /** Timing for one step of a chain, from the agency's definitions. */
  private async planStep(
    onboarding: OnboardingDocument,
    stepKey: OnboardingStepKey,
  ): Promise<StepTiming | null> {
    const planned = await this.planChain(onboarding);
    return planned.find((p) => p.stepKey === stepKey) ?? null;
  }

  /** The whole chain's timing, given which steps are already complete. */
  private async planChain(
    onboarding: OnboardingDocument,
  ): Promise<PlannedStep[]> {
    const definitions = await this.resolveStepDefinitions(
      String(onboarding.agencyId),
    );
    const tickets = await this.chainTickets(onboarding);
    const completedAtByKey: Partial<Record<OnboardingStepKey, Date | null>> =
      {};
    for (const ticket of tickets) {
      if (ticket.onboarding) {
        completedAtByKey[ticket.onboarding.stepKey] = ticket.onboarding
          .completedAt
          ? new Date(ticket.onboarding.completedAt)
          : null;
      }
    }
    return scheduleSteps(
      definitions,
      new Date(onboarding.startedAt),
      completedAtByKey,
    );
  }

  private async chainTickets(
    onboarding: OnboardingDocument,
  ): Promise<ServiceTicketDocument[]> {
    return this.ticketModel
      .find({
        agencyId: onboarding.agencyId,
        'onboarding.onboardingId': onboarding._id,
      })
      .sort({ 'onboarding.sequence': 1 });
  }

  /** Read one onboarding by id, scoped, reconciling the chain on the way. */
  async getOnboarding(
    access: AccessContext,
    id: string,
  ): Promise<OnboardingView> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Onboarding not found');
    }
    if (!access.agencyId) {
      throw new ForbiddenException('Agency context required');
    }
    const onboarding = await this.onboardingModel.findOne({
      _id: new Types.ObjectId(id),
      agencyId: new Types.ObjectId(access.agencyId),
    });
    if (!onboarding) {
      throw new NotFoundException('Onboarding not found');
    }
    await this.reconcileOnboarding(onboarding);
    return this.serializeOnboardingById(onboarding);
  }

  /** The onboardings for a client, newest first. */
  async listOnboardingsForHousehold(
    access: AccessContext,
    householdId: string,
  ): Promise<OnboardingView[]> {
    if (!Types.ObjectId.isValid(householdId) || !access.agencyId) {
      return [];
    }
    const records = await this.onboardingModel
      .find({
        agencyId: new Types.ObjectId(access.agencyId),
        householdId: new Types.ObjectId(householdId),
      })
      .sort({ startedAt: -1 });

    return Promise.all(records.map((r) => this.serializeOnboardingById(r)));
  }

  private async serializeOnboardingById(
    onboarding: OnboardingDocument,
  ): Promise<OnboardingView> {
    const [tickets, planned] = await Promise.all([
      this.chainTickets(onboarding),
      this.planChain(onboarding),
    ]);
    return serializeOnboarding(
      onboarding.toObject(),
      tickets.map((t) => ({
        _id: t._id,
        ticketNumber: t.ticketNumber,
        onboarding: t.onboarding,
      })),
      planned,
    );
  }

  /**
   * Checklist items live on the parent record, not the ticket — they describe
   * the client rather than one call. The ticket id is just how the CSR reaches
   * them from the panel in front of them.
   */
  async updateOnboardingChecklist(
    access: AccessContext,
    id: string,
    dto: UpdateOnboardingChecklistDto,
  ): Promise<ServiceTicketView> {
    const ticket = await this.getScopedOrThrow(access, id);
    const step = requireOnboardingStep(ticket);
    const onboarding = await this.requireParent(step.onboardingId);

    let changed = false;
    for (const key of ONBOARDING_CHECKLIST_KEYS) {
      const value = dto[key];
      if (value === undefined || onboarding.checklist[key] === value) {
        continue;
      }
      onboarding.checklist[key] = value;
      changed = true;
    }

    if (changed) {
      onboarding.markModified('checklist');
      await onboarding.save();
      ticket.lastActivityAt = new Date();
      await ticket.save();
    }
    return serializeTicket(ticket.toObject());
  }

  /**
   * Record (or un-record) a client touchpoint. Nothing is sent — there is no
   * mailer in the system; this only captures that it happened offline. Also
   * per-client, so it lands on the parent record.
   */
  async updateOnboardingEmails(
    access: AccessContext,
    id: string,
    dto: UpdateOnboardingEmailsDto,
  ): Promise<ServiceTicketView> {
    const ticket = await this.getScopedOrThrow(access, id);
    const step = requireOnboardingStep(ticket);
    const onboarding = await this.requireParent(step.onboardingId);

    const recorded = dto.recorded ?? true;
    onboarding.emailMilestones[dto.milestone] = recorded ? new Date() : null;
    onboarding.markModified('emailMilestones');
    await onboarding.save();

    ticket.lastActivityAt = new Date();
    await ticket.save();

    return serializeTicket(ticket.toObject());
  }

  private async requireParent(
    onboardingId: Types.ObjectId,
  ): Promise<OnboardingDocument> {
    const onboarding = await this.onboardingModel.findById(onboardingId);
    if (!onboarding) {
      throw new NotFoundException('Onboarding not found');
    }
    return onboarding;
  }

  /**
   * The agency's step definitions, falling back to the shared defaults when an
   * agency has not been seeded. The fallback keeps onboarding usable on a
   * fresh install instead of producing a chain that never advances.
   */
  private async resolveStepDefinitions(
    agencyId: string,
  ): Promise<OnboardingStepDefinition[]> {
    const configured = await this.stepDefinitionModel
      .find({ agencyId: new Types.ObjectId(agencyId), active: { $ne: false } })
      .sort({ sortOrder: 1 })
      .lean();

    if (!configured.length) {
      return DEFAULT_ONBOARDING_STEP_DEFINITIONS;
    }

    return configured.map((definition) => ({
      stepKey: definition.stepKey,
      sortOrder: definition.sortOrder,
      anchor: definition.anchor,
      offsetMinutes: definition.offsetMinutes,
      slaMinutes: definition.slaMinutes,
    }));
  }

  private async getScopedOrThrow(
    access: AccessContext,
    id: string,
  ): Promise<ServiceTicketDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Ticket not found');
    }
    const filter = this.scopeFilter(access);
    filter._id = new Types.ObjectId(id);
    const ticket = await this.ticketModel.findOne(filter);
    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }
    return ticket;
  }

  /** Public for `LeadTicketsService`, which stamps the same author fields. */
  async resolveUserName(userId: string | null | undefined): Promise<string> {
    if (!userId || !Types.ObjectId.isValid(userId)) {
      return 'System';
    }
    const user = await this.userModel
      .findById(userId)
      .select('firstName lastName email')
      .lean();
    return userDisplayName(user);
  }

  /** Generate the next `<PREFIX>-<n>` ticket number for the agency. */
  private async nextTicketNumber(
    agencyId: string,
    category: string,
    attempt = 0,
  ): Promise<string> {
    const prefix = CATEGORY_PREFIX[category] ?? 'TKT';
    const count = await this.ticketModel.countDocuments({
      agencyId: new Types.ObjectId(agencyId),
    });
    // `attempt` walks the number forward on a clash. Re-counting alone is not
    // enough: the count only moves when a ticket is actually created, so a
    // number that is already taken — which happens once numbering has drifted
    // from the count, e.g. after deletions — would be retried identically
    // until the attempts ran out.
    return `${prefix}-${100 + count + 1 + attempt}`;
  }

  /**
   * Create a ticket, allocating its number with a retry.
   *
   * `nextTicketNumber` is a non-atomic `countDocuments() + 1` against a unique
   * index, so two tickets created in the same instant race. That was tolerable
   * when every ticket came from a human clicking a button; chaining creates a
   * ticket inside a completion handler, which makes the race real. Retrying on
   * the duplicate-key error is cheaper and less invasive than a counter
   * collection; each retry both re-counts *and* walks the number forward, so a
   * number that is simply already taken is skipped rather than retried.
   *
   * Public for `LeadTicketsService`: a quote ticket needs the same `QTE-nnn`
   * allocation and the same clash retry, and duplicating either would be how
   * the two drift apart.
   */
  async createTicketWithNumber(
    agencyId: string,
    doc: Record<string, unknown>,
  ): Promise<ServiceTicketDocument> {
    const category = String(doc.category ?? 'Other');
    let lastError: unknown;

    for (let attempt = 0; attempt < TICKET_NUMBER_RETRIES; attempt += 1) {
      try {
        return await this.ticketModel.create({
          ...doc,
          ticketNumber: await this.nextTicketNumber(
            agencyId,
            category,
            attempt,
          ),
        });
      } catch (error) {
        // Only a ticketNumber clash is retryable. Any other duplicate — a
        // second ticket for the same onboarding step, say — must surface.
        if (!isDuplicateKeyError(error) || !isTicketNumberClash(error)) {
          throw error;
        }
        lastError = error;
      }
    }
    throw lastError;
  }

  /* ------------------------------------------------------------------ *
   * Proactive renewal outreach
   *
   * A `RenewalCycle` per deal per term, with one or two call tickets hanging
   * off it. There is no scheduler in this API, so cycles materialize lazily
   * from a throttled scan run on the desk and stats reads — the same
   * reconcile-on-read bargain onboarding makes.
   * ------------------------------------------------------------------ */

  /**
   * Claim the next scan window, or return false if someone else holds it.
   *
   * The duplicate-key catch is the *normal* path once a document exists: when
   * `lastScanAt` is inside the window the filter misses, the upsert attempts an
   * insert, and the unique index rejects it.
   */
  private async claimScanWindow(agencyId: Types.ObjectId): Promise<boolean> {
    const cutoff = new Date(Date.now() - RENEWAL_SCAN_INTERVAL_MS);
    try {
      const claimed = await this.scanStateModel.findOneAndUpdate(
        { agencyId, lastScanAt: { $lt: cutoff } },
        { $set: { lastScanAt: new Date() } },
        { upsert: true, new: true },
      );
      return Boolean(claimed);
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        return false;
      }
      throw error;
    }
  }

  /** Renewal step definitions for an agency, falling back to the shared defaults. */
  private async resolveRenewalDefinitions(): Promise<RenewalStepDefinition[]> {
    // Config-in-DB is planned (see the onboarding equivalent); until an agency
    // has overrides the shared constants are the source of truth, which keeps
    // renewal outreach working on a fresh install.
    return Promise.resolve(DEFAULT_RENEWAL_STEP_DEFINITIONS);
  }

  /**
   * Bring an agency's renewal cycles in line with its book.
   *
   * Two-sided on purpose. Side A creates cycles for policies entering the
   * horizon; Side B sweeps the cycles already open, because Side A cannot see
   * a policy that was deleted, deactivated, or whose date moved out of range.
   */
  async materializeRenewalCycles(access: AccessContext): Promise<void> {
    if (!access.agencyId) {
      return;
    }
    const agencyId = new Types.ObjectId(access.agencyId);
    if (!(await this.claimScanWindow(agencyId))) {
      return;
    }

    const now = new Date();
    const horizonStart = new Date(now.getTime() - RENEWAL_GRACE_DAYS * DAY_MS);
    const horizonEnd = new Date(now.getTime() + RENEWAL_HORIZON_DAYS * DAY_MS);

    // Side A — policies entering the horizon.
    const candidates = await this.clientsService.findRenewalWindow(
      access,
      horizonStart,
      horizonEnd,
      RENEWAL_SCAN_BATCH,
    );
    for (const group of groupRenewalCandidates(candidates)) {
      await this.ensureRenewalCycle(access, agencyId, group);
    }

    // Side B — cycles already open, which may have drifted or gone stale.
    const open = await this.cycleModel
      .find({ agencyId, completedAt: null })
      .limit(RENEWAL_SCAN_BATCH);
    for (const cycle of open) {
      await this.reconcileRenewalCycle(access, cycle);
    }
  }

  /** Create a cycle and its call tickets if this group does not have one yet. */
  private async ensureRenewalCycle(
    access: AccessContext,
    agencyId: Types.ObjectId,
    group: RenewalGroup,
  ): Promise<RenewalCycleDocument | null> {
    const termKey = formatTermKey(group.anchor);
    const existing = await this.cycleModel.findOne({
      agencyId,
      groupKey: group.groupKey,
      termKey,
    });
    if (existing) {
      await this.reconcileRenewalCycle(access, existing);
      return existing;
    }

    const household = group.householdId
      ? await this.clientsService
          .getHousehold(access, group.householdId)
          .catch(() => null)
      : null;

    let cycle: RenewalCycleDocument;
    try {
      cycle = await this.cycleModel.create({
        agencyId,
        branchId: group.branchId ? new Types.ObjectId(group.branchId) : null,
        groupKey: group.groupKey,
        dealId: group.dealId ? new Types.ObjectId(group.dealId) : null,
        householdId: group.householdId
          ? new Types.ObjectId(group.householdId)
          : null,
        termKey,
        renewalDate: group.anchor,
        track: group.track,
        policies: group.policies.map(toCyclePolicy),
        clientName:
          household?.primaryContactName ||
          household?.name ||
          group.policies[0]?.policyNumber ||
          'Renewal',
        householdName: household?.name ?? '',
        phone: household?.primaryPhones?.[0] ?? '',
        email: household?.primaryEmails?.[0] ?? '',
        currentStepKey: null,
        completedAt: null,
        // The client's CSR owns the outreach. This matters more than it looks:
        // a `csr` user is `own`-scoped, so an unassigned ticket is invisible to
        // exactly the person meant to work it.
        assignedCsrId:
          household?.assignedCrmId &&
          Types.ObjectId.isValid(household.assignedCrmId)
            ? new Types.ObjectId(household.assignedCrmId)
            : null,
      });
    } catch (error) {
      // A concurrent scan created it. The unique index did its job.
      if (!isDuplicateKeyError(error)) throw error;
      const raced = await this.cycleModel.findOne({
        agencyId,
        groupKey: group.groupKey,
        termKey,
      });
      if (raced) await this.reconcileRenewalCycle(access, raced);
      return raced;
    }

    await this.reconcileRenewalCycle(access, cycle);
    return cycle;
  }

  /**
   * Repair a cycle against its policies, and open whatever call tickets should
   * exist. Idempotent, and run on every read — a cycle broken between writes
   * self-heals the next time anyone looks at it.
   */
  async reconcileRenewalCycle(
    access: AccessContext,
    cycle: RenewalCycleDocument,
  ): Promise<RenewalCycleDocument> {
    const now = new Date();
    const policies = await this.clientsService.findRenewalCandidatesByIds(
      access,
      cycle.policies.map((p) => String(p.policyId)),
    );

    // (1) Nothing left to renew — close it out. Never delete: audit trail.
    if (!policies.length) {
      if (!cycle.completedAt) {
        cycle.completedAt = now;
        cycle.currentStepKey = null;
        cycle.closedReason = 'policy_ineligible';
        await cycle.save();
        await this.closeRenewalTickets(
          cycle,
          'Renewal cycle closed — the policies are no longer active.',
        );
      }
      return cycle;
    }

    // (2) Has the carrier moved the date?
    const anchor = earliestAnchor(policies) ?? cycle.renewalDate;
    const driftDays = Math.abs(
      (anchor.getTime() - new Date(cycle.renewalDate).getTime()) / DAY_MS,
    );
    if (driftDays > RENEWAL_DRIFT_TOLERANCE_DAYS) {
      // Too far to be the same outreach — a new term, or a data correction big
      // enough that the old plan is meaningless. The next scan opens a fresh
      // cycle under the new termKey.
      if (!cycle.completedAt) {
        cycle.completedAt = now;
        cycle.currentStepKey = null;
        cycle.closedReason = 'superseded';
        await cycle.save();
        await this.closeRenewalTickets(
          cycle,
          'Renewal date moved beyond this cycle — superseded by a new one.',
        );
      }
      return cycle;
    }

    // (3) Adopt a small drift, refresh the checklist, and re-plan.
    cycle.renewalDate = anchor;
    cycle.policies = policies.map((policy) => mergeCyclePolicy(cycle, policy));
    cycle.track = trackForPolicies(policies);
    cycle.markModified('policies');

    const definitions = await this.resolveRenewalDefinitions();
    const tickets = await this.renewalTickets(cycle);
    const completedAtByKey: Partial<Record<RenewalStepKey, Date | null>> = {};
    for (const ticket of tickets) {
      if (ticket.renewal) {
        completedAtByKey[ticket.renewal.stepKey] =
          ticket.renewal.completedAt ?? null;
      }
    }
    const planned = scheduleRenewalSteps(
      definitions,
      cycle.track,
      anchor,
      completedAtByKey,
    );

    // (4) Every call gets a ticket up front — renewal steps do not chain, so
    // nothing waits on the call before it.
    for (const step of planned) {
      await this.ensureRenewalTicket(cycle, step, planned.length);
    }

    // (5) Roll up state from the tickets.
    const refreshed = await this.renewalTickets(cycle);
    const outstanding = planned.find(
      (step) =>
        !refreshed.find((t) => t.renewal?.stepKey === step.stepKey)?.renewal
          ?.completedAt,
    );
    cycle.currentStepKey = outstanding?.stepKey ?? null;

    const review = refreshed.find(
      (t) => t.renewal?.stepKey === 'renewal_review',
    );
    if (review?.renewal?.outcome) {
      cycle.outcome = review.renewal.outcome;
      cycle.outcomeAt = review.renewal.outcomeAt ?? null;
      cycle.outcomeByName = review.renewal.completedByName ?? '';
    }

    if (!outstanding) {
      cycle.completedAt =
        refreshed
          .map((t) => t.renewal?.completedAt)
          .filter((d): d is Date => Boolean(d))
          .sort((a, b) => b.getTime() - a.getTime())[0] ?? now;
      cycle.closedReason = 'completed';
    } else {
      cycle.completedAt = null;
      cycle.closedReason = null;
    }

    await cycle.save();
    return cycle;
  }

  /** Every ticket belonging to a cycle, in call order. */
  private async renewalTickets(
    cycle: RenewalCycleDocument,
  ): Promise<ServiceTicketDocument[]> {
    return this.ticketModel
      .find({
        agencyId: cycle.agencyId,
        'renewal.renewalCycleId': cycle._id,
      })
      .sort({ 'renewal.sequence': 1 });
  }

  /**
   * Create the ticket for one call if it does not exist. The unique partial
   * index on `{agencyId, renewalCycleId, stepKey}` is the real guarantee; a
   * concurrent duplicate is swallowed rather than surfaced.
   */
  private async ensureRenewalTicket(
    cycle: RenewalCycleDocument,
    step: PlannedRenewalStep,
    totalSteps: number,
  ): Promise<void> {
    const existing = await this.ticketModel.findOne({
      agencyId: cycle.agencyId,
      'renewal.renewalCycleId': cycle._id,
      'renewal.stepKey': step.stepKey,
    });

    if (existing) {
      // Adopt re-planned timing, but never rewrite a call already made.
      if (!existing.renewal?.completedAt && existing.renewal) {
        existing.renewal.availableAt = step.availableAt;
        existing.renewal.dueAt = step.dueAt;
        existing.renewal.renewalDate = cycle.renewalDate;
        existing.markModified('renewal');
        await existing.save();
      }
      return;
    }

    const primary = cycle.policies[0];
    try {
      await this.createTicketWithNumber(String(cycle.agencyId), {
        agencyId: cycle.agencyId,
        branchId: cycle.branchId ?? null,
        clientName: cycle.clientName,
        category: 'Renewal Review',
        status: 'open',
        priority: 'medium',
        assignedUserId: cycle.assignedCsrId ?? null,
        assignedRep: await this.resolveUserName(
          cycle.assignedCsrId ? String(cycle.assignedCsrId) : null,
        ),
        createdByName: 'Renewal outreach',
        policyNumber: primary?.policyNumber ?? '',
        policyType: primary?.policyType ?? '',
        household: cycle.householdName ?? '',
        policyId: primary?.policyId ?? null,
        householdId: cycle.householdId ?? null,
        phone: cycle.phone ?? '',
        email: cycle.email ?? '',
        // Dated to when the call opens, not to now — a scheduled call has not
        // been sitting on anyone's plate.
        openedAt: step.availableAt,
        lastActivityAt: step.availableAt,
        resolvedAt: null,
        timeline: [
          {
            type: 'system',
            content:
              `${step.label} scheduled — ${cycle.policies.length} ` +
              `polic${cycle.policies.length === 1 ? 'y' : 'ies'} renewing ` +
              `${cycle.renewalDate.toISOString().slice(0, 10)}.`,
            at: step.availableAt,
          },
        ],
        onboarding: null,
        renewal: {
          renewalCycleId: cycle._id,
          stepKey: step.stepKey,
          track: cycle.track,
          sequence: step.sequence,
          totalSteps,
          renewalDate: cycle.renewalDate,
          availableAt: step.availableAt,
          dueAt: step.dueAt,
          completedAt: null,
          completedBy: null,
          completedByName: '',
          outcome: null,
          outcomeAt: null,
        },
      });
    } catch (error) {
      // Swallow only the step-uniqueness duplicate — a concurrent scan opened
      // this call, and the unique index did its job. A *ticketNumber* duplicate
      // reaching here means `createTicketWithNumber` exhausted its retries, and
      // silently dropping that would leave a cycle with no ticket to work.
      if (!isDuplicateKeyError(error) || isTicketNumberClash(error)) {
        throw error;
      }
    }
  }

  /** Close a dead cycle's outstanding call tickets, with a reason on each. */
  private async closeRenewalTickets(
    cycle: RenewalCycleDocument,
    reason: string,
  ): Promise<void> {
    const tickets = await this.renewalTickets(cycle);
    const now = new Date();
    for (const ticket of tickets) {
      if (ticket.renewal?.completedAt) continue;
      ticket.status = 'closed';
      ticket.resolvedAt = now;
      ticket.lastActivityAt = now;
      ticket.statusOverriddenAt = now;
      ticket.timeline.push({ type: 'system', content: reason, at: now });
      await ticket.save();
    }
  }

  /** This ticket's renewal call, or a 400. Guards every renewal mutation. */
  private requireRenewalStep(
    ticket: ServiceTicketDocument,
  ): NonNullable<ServiceTicketDocument['renewal']> {
    if (!ticket.renewal) {
      throw new BadRequestException('Ticket is not a renewal outreach call');
    }
    return ticket.renewal;
  }

  private async requireCycle(
    renewalCycleId: Types.ObjectId,
  ): Promise<RenewalCycleDocument> {
    const cycle = await this.cycleModel.findById(renewalCycleId);
    if (!cycle) {
      throw new NotFoundException('Renewal cycle not found');
    }
    return cycle;
  }

  /**
   * Tick a policy off the call's checklist.
   *
   * Addressed by ticket id because that is where the CSR is, but written to the
   * parent cycle — the checklist covers the deal, not one call, so both calls
   * see the same ticks. Returns the refreshed ticket, so the client refreshes
   * the object it posted from.
   */
  async updateRenewalPolicies(
    access: AccessContext,
    id: string,
    dto: UpdateRenewalPoliciesDto,
  ): Promise<ServiceTicketView> {
    const ticket = await this.getScopedOrThrow(access, id);
    const step = this.requireRenewalStep(ticket);
    const cycle = await this.requireCycle(step.renewalCycleId);

    const entry = cycle.policies.find(
      (policy) => String(policy.policyId) === dto.policyId,
    );
    if (!entry) {
      throw new BadRequestException('That policy is not on this renewal');
    }

    const discussed = dto.discussed ?? true;
    const now = new Date();
    const userName = await this.resolveUserName(access.userId);

    entry.discussedAt = discussed ? now : null;
    entry.discussedBy =
      discussed && access.userId && Types.ObjectId.isValid(access.userId)
        ? new Types.ObjectId(access.userId)
        : null;
    entry.discussedByName = discussed ? userName : '';
    cycle.markModified('policies');
    await cycle.save();

    ticket.lastActivityAt = now;
    ticket.timeline.push({
      type: 'system',
      author: userName,
      content: `${entry.policyType} ${entry.policyNumber} ${
        discussed ? 'discussed on the call' : 'un-ticked'
      }.`,
      at: now,
    });
    await ticket.save();

    return serializeTicket(ticket.toObject());
  }

  /**
   * Close a renewal call.
   *
   * Two rules, both enforced here rather than trusted to the UI:
   *
   *   - **every policy must be ticked.** One call covers the whole deal, so a
   *     completion with an unticked policy means a line went undiscussed.
   *   - **the renewal review must carry an outcome**, on both tracks — the
   *     merged auto call reuses that same step key. The annual review must not:
   *     there is no renewal decision to make 90 days out.
   */
  async completeRenewalStep(
    access: AccessContext,
    id: string,
    stepKey: string,
    dto: CompleteRenewalStepDto,
  ): Promise<ServiceTicketView> {
    const ticket = await this.getScopedOrThrow(access, id);
    const step = this.requireRenewalStep(ticket);

    if (step.stepKey !== stepKey) {
      throw new BadRequestException(
        `This ticket is the ${RENEWAL_STEP_LABELS[step.stepKey]}, not ${stepKey}`,
      );
    }
    if (step.completedAt) {
      throw new BadRequestException('This call is already complete');
    }
    if (
      !isStepActionable(
        {
          availableAt: step.availableAt,
          dueAt: step.dueAt,
          completedAt: step.completedAt,
        },
        new Date(),
      )
    ) {
      throw new BadRequestException('This call has not opened yet');
    }

    const cycle = await this.requireCycle(step.renewalCycleId);

    const undiscussed = cycle.policies.filter((policy) => !policy.discussedAt);
    if (undiscussed.length) {
      throw new BadRequestException(
        `Every policy must be discussed first — still open: ${undiscussed
          .map((policy) => `${policy.policyType} ${policy.policyNumber}`)
          .join(', ')}`,
      );
    }

    const requiresOutcome = step.stepKey === 'renewal_review';
    if (requiresOutcome && !dto.outcome) {
      throw new BadRequestException(
        'Record whether the client took the renewal or is shopping around',
      );
    }
    if (!requiresOutcome && dto.outcome) {
      throw new BadRequestException(
        'The annual review has no renewal decision to record',
      );
    }

    const now = new Date();
    const userName = await this.resolveUserName(access.userId);

    step.completedAt = now;
    step.completedBy =
      access.userId && Types.ObjectId.isValid(access.userId)
        ? new Types.ObjectId(access.userId)
        : null;
    step.completedByName = userName;
    if (dto.outcome) {
      step.outcome = dto.outcome;
      step.outcomeAt = now;
    }

    ticket.status = 'resolved';
    ticket.resolvedAt = now;
    ticket.lastActivityAt = now;
    // The schedule is authoritative again: a completed call derives to resolved.
    ticket.statusOverriddenAt = null;
    ticket.timeline.push({
      type: 'system',
      author: userName,
      content: dto.outcome
        ? `${RENEWAL_STEP_LABELS[step.stepKey]} completed — ${RENEWAL_OUTCOME_LABELS[dto.outcome].toLowerCase()}.`
        : `${RENEWAL_STEP_LABELS[step.stepKey]} completed.`,
      at: now,
    });
    if (dto.note?.trim()) {
      ticket.timeline.push({
        type: 'note',
        author: userName,
        content: dto.note.trim(),
        at: now,
      });
    }
    ticket.markModified('renewal');
    await ticket.save();

    if (dto.outcome) {
      cycle.outcome = dto.outcome;
      cycle.outcomeAt = now;
      cycle.outcomeBy = step.completedBy;
      cycle.outcomeByName = userName;
      if (dto.note?.trim()) {
        cycle.outcomeNote = dto.note.trim();
      }
      await cycle.save();
    }
    await this.reconcileRenewalCycle(access, cycle);

    return serializeTicket(ticket.toObject());
  }

  /** Correct a recorded outcome after the fact. */
  async setRenewalOutcome(
    access: AccessContext,
    id: string,
    dto: SetRenewalOutcomeDto,
  ): Promise<ServiceTicketView> {
    const ticket = await this.getScopedOrThrow(access, id);
    const step = this.requireRenewalStep(ticket);

    if (step.stepKey !== 'renewal_review') {
      throw new BadRequestException(
        'Only the renewal review records a renewal decision',
      );
    }

    const previous = step.outcome;
    if (previous === dto.outcome) {
      return serializeTicket(ticket.toObject());
    }

    const now = new Date();
    const userName = await this.resolveUserName(access.userId);
    step.outcome = dto.outcome;
    step.outcomeAt = now;
    ticket.lastActivityAt = now;
    ticket.timeline.push({
      type: 'status',
      author: userName,
      content: previous
        ? `Renewal outcome changed: ${RENEWAL_OUTCOME_LABELS[previous]} → ${RENEWAL_OUTCOME_LABELS[dto.outcome]}`
        : `Renewal outcome recorded: ${RENEWAL_OUTCOME_LABELS[dto.outcome]}`,
      at: now,
    });
    ticket.markModified('renewal');
    await ticket.save();

    const cycle = await this.requireCycle(step.renewalCycleId);
    cycle.outcome = dto.outcome;
    cycle.outcomeAt = now;
    cycle.outcomeByName = userName;
    if (dto.note?.trim()) {
      cycle.outcomeNote = dto.note.trim();
    }
    await cycle.save();

    return serializeTicket(ticket.toObject());
  }

  /** One cycle, reconciled before it is serialized. */
  async getRenewalCycle(
    access: AccessContext,
    renewalCycleId: string,
  ): Promise<RenewalCycleView> {
    if (!Types.ObjectId.isValid(renewalCycleId)) {
      throw new NotFoundException('Renewal cycle not found');
    }
    if (!access.agencyId) {
      throw new ForbiddenException('Agency context required');
    }
    const cycle = await this.cycleModel.findOne({
      _id: new Types.ObjectId(renewalCycleId),
      agencyId: new Types.ObjectId(access.agencyId),
    });
    if (!cycle) {
      throw new NotFoundException('Renewal cycle not found');
    }

    await this.reconcileRenewalCycle(access, cycle);
    return this.serializeCycle(cycle);
  }

  private async serializeCycle(
    cycle: RenewalCycleDocument,
  ): Promise<RenewalCycleView> {
    const [tickets, definitions] = await Promise.all([
      this.renewalTickets(cycle),
      this.resolveRenewalDefinitions(),
    ]);
    const planned = scheduleRenewalSteps(
      definitions,
      cycle.track,
      cycle.renewalDate,
      Object.fromEntries(
        tickets
          .filter((t) => t.renewal)
          .map((t) => [t.renewal!.stepKey, t.renewal!.completedAt ?? null]),
      ),
    );
    return serializeRenewalCycle(
      cycle.toObject(),
      tickets.map((t) => ({
        _id: t._id,
        ticketNumber: t.ticketNumber,
        renewal: t.renewal,
      })),
      planned,
    );
  }

  /**
   * The Proactive Renewal Outreach desk: one row per cycle, showing the call
   * that is actually on the CSR's plate.
   *
   * Runs the throttled scan first, which is what makes renewals appear without
   * a cron. Scheduled calls stay out — a call that has not opened is not work.
   */
  async renewalDesk(access: AccessContext): Promise<RenewalDeskRow[]> {
    await this.materializeRenewalCycles(access);

    if (!access.agencyId) {
      return [];
    }
    const now = new Date();
    const agencyId = new Types.ObjectId(access.agencyId);
    const cycles = await this.cycleModel
      .find({ agencyId, completedAt: null })
      .sort({ renewalDate: 1 })
      .limit(RENEWAL_DESK_LIMIT);
    if (!cycles.length) {
      return [];
    }

    const definitions = await this.resolveRenewalDefinitions();
    // Scoped like every other ticket read: an `own`-scoped CSR sees the calls
    // assigned to them, not the whole agency's book. A cycle whose call is not
    // visible simply produces no row.
    const tickets = await this.ticketModel
      .find({
        ...this.scopeFilter(access),
        'renewal.renewalCycleId': { $in: cycles.map((c) => c._id) },
        'renewal.completedAt': null,
        'renewal.availableAt': { $ne: null, $lte: now },
      })
      .sort({ 'renewal.dueAt': 1 })
      .lean();

    const rows: RenewalDeskRow[] = [];
    for (const cycle of cycles) {
      // The open call for this cycle, if any. A cycle whose only call is still
      // scheduled has nothing to show yet.
      const ticket = tickets.find(
        (t) => String(t.renewal?.renewalCycleId) === String(cycle._id),
      );
      if (!ticket?.renewal) continue;

      const step = serializeRenewalStep(ticket.renewal, definitions, now);
      rows.push({
        cycleId: String(cycle._id),
        ticketId: String(ticket._id),
        ticketNumber: ticket.ticketNumber,
        stepKey: step.stepKey,
        label: step.label,
        track: cycle.track,
        clientName: cycle.clientName,
        householdId: cycle.householdId ? String(cycle.householdId) : null,
        householdName: cycle.householdName ?? '',
        policyCount: cycle.policies.length,
        policies: cycle.policies.map(serializeRenewalPolicy),
        renewalDate: step.renewalDate,
        daysUntilRenewal: step.daysUntilRenewal,
        availableAt: step.availableAt,
        dueAt: step.dueAt,
        status: renewalStepStatus(ticket.renewal, now),
        isActionable: step.isActionable,
        isOverdue: step.isOverdue,
        mergedFrom: step.mergedFrom,
        outcome: step.outcome,
      });
    }

    // Most urgent first: overdue leads, then soonest renewal.
    return rows.sort(
      (a, b) =>
        Number(b.isOverdue) - Number(a.isOverdue) ||
        a.daysUntilRenewal - b.daysUntilRenewal,
    );
  }
}

/* -------------------------------------------------------------------------- *
 * Renewal outreach — tuning and grouping
 * -------------------------------------------------------------------------- */

const DAY_MS = 24 * 60 * 60 * 1000;

/** How far ahead the scan looks — the widest lead time on any track. */
const RENEWAL_HORIZON_DAYS = 90;
/** How long after a renewal a cycle can still be closed out with an outcome. */
const RENEWAL_GRACE_DAYS = 14;
/**
 * How far a carrier can move a renewal date before it is treated as a new term
 * rather than the same outreach. Less than half the shortest term (6 months),
 * so an adoption can never reach into the next cycle.
 */
const RENEWAL_DRIFT_TOLERANCE_DAYS = 45;
/** Policies per scan pass. Bounds the work so a large book converges gradually. */
const RENEWAL_SCAN_BATCH = 500;
/** Minimum gap between scans for one agency. */
const RENEWAL_SCAN_INTERVAL_MS = 10 * 60 * 1000;
/** Rows the desk will render. */
const RENEWAL_DESK_LIMIT = 100;
/**
 * How far apart two policies in the same deal can renew and still be one call.
 * Auto (6mo) drifts out of sync with Home (12mo) inside a bundle, so a wide
 * window would merge renewals months apart into a single conversation.
 */
const RENEWAL_GROUP_WINDOW_DAYS = 15;

interface RenewalGroup {
  groupKey: string;
  dealId: string | null;
  householdId: string | null;
  branchId: string | null;
  anchor: Date;
  track: RenewalTrack;
  policies: PolicyRenewalCandidate[];
}

/** The earliest renewal among a set of policies — a cycle's anchor. */
function earliestAnchor(policies: PolicyRenewalCandidate[]): Date | null {
  const dates = policies
    .map((policy) => renewalAnchorDate(policy))
    .filter((d): d is Date => Boolean(d))
    .sort((a, b) => a.getTime() - b.getTime());
  return dates[0] ?? null;
}

/**
 * A cycle covering any 12-month policy gets both calls; an auto-only cycle gets
 * the single merged one. Mixed bundles follow the longer term, because the
 * annual policy genuinely warrants the 90-day warm-up.
 */
function trackForPolicies(policies: PolicyRenewalCandidate[]): RenewalTrack {
  return policies.every(
    (policy) => renewalTrackFor(policy.policyType) === 'semiannual',
  )
    ? 'semiannual'
    : 'annual';
}

/**
 * Fold policies into one outreach per deal per renewal window.
 *
 * The CSR makes one phone call for a deal, so policies renewing together are
 * one ticket with a checklist. Policies in the same deal renewing months apart
 * — the auto-in-a-bundle case — split into separate cycles.
 *
 * Policies with no deal group by household instead, which is why the key is a
 * single string rather than two nullable ids.
 */
function groupRenewalCandidates(
  candidates: PolicyRenewalCandidate[],
): RenewalGroup[] {
  const byKey = new Map<string, PolicyRenewalCandidate[]>();
  for (const policy of candidates) {
    if (!renewalAnchorDate(policy)) continue;
    const key = policy.dealId
      ? `deal:${policy.dealId}`
      : policy.householdId
        ? `household:${policy.householdId}`
        : `policy:${policy.id}`;
    byKey.set(key, [...(byKey.get(key) ?? []), policy]);
  }

  const groups: RenewalGroup[] = [];
  for (const [groupKey, policies] of byKey) {
    const sorted = [...policies].sort(
      (a, b) =>
        (renewalAnchorDate(a)?.getTime() ?? 0) -
        (renewalAnchorDate(b)?.getTime() ?? 0),
    );

    // Walk in date order, starting a new cycle whenever the next renewal falls
    // outside the current one's window.
    let bucket: PolicyRenewalCandidate[] = [];
    let bucketAnchor: Date | null = null;
    const flush = () => {
      if (!bucket.length || !bucketAnchor) return;
      groups.push({
        groupKey,
        dealId: bucket[0].dealId,
        householdId: bucket[0].householdId,
        branchId: bucket[0].branchId,
        anchor: bucketAnchor,
        track: trackForPolicies(bucket),
        policies: bucket,
      });
      bucket = [];
      bucketAnchor = null;
    };

    for (const policy of sorted) {
      const anchor = renewalAnchorDate(policy)!;
      if (
        bucketAnchor &&
        (anchor.getTime() - bucketAnchor.getTime()) / DAY_MS >
          RENEWAL_GROUP_WINDOW_DAYS
      ) {
        flush();
      }
      bucketAnchor ??= anchor;
      bucket.push(policy);
    }
    flush();
  }

  return groups;
}

/** A policy as stored on a cycle's checklist. */
function toCyclePolicy(policy: PolicyRenewalCandidate) {
  return {
    policyId: new Types.ObjectId(policy.id),
    policyNumber: policy.policyNumber,
    policyType: policy.policyType,
    carrier: policy.carrier,
    premium: policy.premium,
    renewalDate: renewalAnchorDate(policy),
    discussedAt: null,
    discussedBy: null,
    discussedByName: '',
  };
}

/** Refresh a checklist line from the policy, preserving the "discussed" tick. */
function mergeCyclePolicy(
  cycle: RenewalCycleDocument,
  policy: PolicyRenewalCandidate,
) {
  const existing = cycle.policies.find((p) => String(p.policyId) === policy.id);
  return {
    ...toCyclePolicy(policy),
    discussedAt: existing?.discussedAt ?? null,
    discussedBy: existing?.discussedBy ?? null,
    discussedByName: existing?.discussedByName ?? '',
  };
}

/** Roles whose holders can be a ticket's Assigned Client Relation Manager. */
const ASSIGNABLE_ROLE_SLUGS = ['csr', 'crm'];

const CATEGORY_PREFIX: Record<string, string> = {
  Onboarding: 'ONBD',
  Endorsement: 'ENDR',
  Billing: 'BILL',
  'Claims Assist': 'CLAIM',
  'Renewal Review': 'RENEW',
  Other: 'TKT',
  Quote: 'QTE',
  'Policy Change': 'PCHG',
  Payment: 'PAY',
  'Company Transfer': 'XFER',
  Save: 'SAVE',
  Termination: 'TERM',
  'Renewal Taken': 'RNWT',
};

function statusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

/** How many times to re-allocate a ticket number before giving up. */
const TICKET_NUMBER_RETRIES = 5;

/** Onboarding step or a 400 — guards every onboarding mutation. */
function requireOnboardingStep(
  ticket: ServiceTicketDocument,
): NonNullable<ServiceTicketDocument['onboarding']> {
  if (ticket.category !== 'Onboarding' || !ticket.onboarding) {
    throw new BadRequestException('Ticket is not an onboarding');
  }
  return ticket.onboarding;
}

interface MongoDuplicateKeyError {
  code?: number;
  keyPattern?: Record<string, unknown>;
  message?: string;
}

function isDuplicateKeyError(error: unknown): boolean {
  return (error as MongoDuplicateKeyError)?.code === 11000;
}

/** True when the duplicate was on `ticketNumber` rather than another index. */
function isTicketNumberClash(error: unknown): boolean {
  const keyPattern = (error as MongoDuplicateKeyError)?.keyPattern;
  if (keyPattern) {
    return Object.keys(keyPattern).includes('ticketNumber');
  }
  return String((error as MongoDuplicateKeyError)?.message ?? '').includes(
    'ticketNumber',
  );
}

/**
 * Onboarding tickets that have not opened yet.
 *
 * A scheduled call is not on the CSR's plate: it is created the moment the
 * previous call closes, but stays out of every list until `availableAt`
 * passes. Reading it directly by id still works, so the chain view and deep
 * links do not break.
 */
function scheduledOnboardingMatch(
  now: Date,
): FilterQuery<ServiceTicketDocument> {
  return {
    category: 'Onboarding',
    'onboarding.availableAt': { $gt: now },
  };
}

/**
 * Every kind of scheduled step that has not opened yet, for `$nor`.
 *
 * Renewal works the same way as onboarding: both call tickets are created when
 * the cycle is, and the 45-day one stays out of every list until it opens.
 * Applied to `list()` **and** `stats()` — missing the latter would inflate
 * `openTickets` by every scheduled call in the book.
 *
 * Keyed on payload presence rather than category, because `Renewal Review` is
 * a category a CSR can also pick by hand in the New Ticket dialog.
 */
function scheduledStepMatches(now: Date): FilterQuery<ServiceTicketDocument>[] {
  return [
    scheduledOnboardingMatch(now),
    { 'renewal.availableAt': { $gt: now } },
  ];
}

/**
 * Mongo match for an onboarding ticket whose *derived* status is `status`.
 *
 * Mirrors `deriveOnboardingStatus`, so the two must change together. Now that
 * a ticket carries exactly one step, these are plain scalar predicates rather
 * than the `$elemMatch` gymnastics the embedded array needed.
 *
 * Returns null for statuses onboarding never derives into (`in_progress`,
 * `waiting_on_client`, …) — such a filter simply matches no onboarding ticket.
 *
 * The `$ne: null` guards matter: BSON sorts null before dates, so a bare
 * `{ dueAt: { $lt: now } }` would match an unscheduled step too.
 */
function onboardingStatusMatch(
  status: ServiceTicketStatus,
  now: Date,
): FilterQuery<ServiceTicketDocument> | null {
  switch (status) {
    case 'resolved':
      return { 'onboarding.completedAt': { $ne: null } };
    case 'overdue':
      return {
        'onboarding.completedAt': null,
        'onboarding.dueAt': { $ne: null, $lt: now },
      };
    case 'open':
      // Available but not past due — `overdue` outranks `open`.
      return {
        'onboarding.completedAt': null,
        'onboarding.availableAt': { $ne: null, $lte: now },
        'onboarding.dueAt': { $gte: now },
      };
    case 'waiting':
      // Scheduled but not yet open. These are hidden from every list anyway;
      // the predicate exists so the mapping stays complete and honest.
      return {
        'onboarding.completedAt': null,
        'onboarding.availableAt': { $gt: now },
      };
    default:
      return null;
  }
}

function userDisplayName(
  user: { firstName?: string; lastName?: string; email?: string } | null,
): string {
  if (!user) {
    return 'System';
  }
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return name || user.email || 'System';
}

function serializeActivity(
  entry: ServiceTicketActivityEntry & { _id?: unknown },
): ServiceTicketActivity {
  const at = new Date(entry.at);
  return {
    id: String((entry as { _id?: unknown })._id ?? ''),
    type: entry.type,
    author: entry.author,
    content: entry.content,
    at: at.toISOString(),
    timestamp: formatTimestamp(at),
  };
}

/** The instant before which a resolved ticket counts as archived. */
function archiveCutoff(now: Date = new Date()): Date {
  return new Date(
    now.getTime() - SERVICE_TICKET_ARCHIVE_AFTER_DAYS * 24 * 60 * 60 * 1000,
  );
}

/**
 * Mongo match for archived tickets. Tickets resolved before `resolvedAt`
 * existed fall back to `lastActivityAt`, which is when their status last
 * changed.
 */
function archivedMatch(cutoff: Date): FilterQuery<ServiceTicketDocument> {
  return {
    status: { $in: [...SERVICE_TICKET_TERMINAL_STATUSES] },
    $expr: {
      $lte: [{ $ifNull: ['$resolvedAt', '$lastActivityAt'] }, cutoff],
    },
  };
}

/**
 * Exported so `LeadTicketsService` returns the identical shape — a quote ticket
 * opened from Start Quote must serialize exactly like one read back from the
 * queue, `isStatusLocked` included.
 *
 * `leadStatus` is passed in rather than looked up here: the single-ticket read
 * has the lead in hand, and every list path would otherwise pay a lead read per
 * row for a field no list displays.
 */
export function serializeTicket(
  ticket: ServiceTicket & { _id: unknown },
  leadStatus: string | null = null,
  policyTransfer: PolicyTransferRef | null = null,
): ServiceTicketView {
  const now = new Date();
  const openedAt = new Date(ticket.openedAt);
  const lastActivityAt = new Date(ticket.lastActivityAt);
  const resolvedAt = ticket.resolvedAt ? new Date(ticket.resolvedAt) : null;

  // Onboarding tickets derive their status from their step's timing rather
  // than the stored field: the `waiting -> open -> overdue` transitions happen
  // through the passage of time, with no write to hang an update off.
  //
  // Unless a CSR has set the status by hand, that is — an explicit choice beats
  // the schedule, and `statusOverriddenAt` records that it was made. Completing
  // the call clears the override and hands the ticket back to the schedule.
  const onboarding = ticket.onboarding
    ? serializeOnboardingStep(ticket.onboarding, now)
    : null;
  // Either kind of scheduled step derives a status the same way. A ticket
  // never carries both — it is one call of one kind.
  const scheduled = ticket.onboarding ?? ticket.renewal ?? null;
  const status =
    scheduled && !ticket.statusOverriddenAt
      ? deriveOnboardingStatus(
          {
            availableAt: scheduled.availableAt
              ? new Date(scheduled.availableAt)
              : null,
            dueAt: scheduled.dueAt ? new Date(scheduled.dueAt) : null,
            completedAt: scheduled.completedAt
              ? new Date(scheduled.completedAt)
              : null,
          },
          now,
        )
      : ticket.status;

  const isArchived =
    isTerminalTicketStatus(status) &&
    (resolvedAt ?? lastActivityAt) <= archiveCutoff();
  return {
    id: String(ticket._id),
    ticketNumber: ticket.ticketNumber,
    clientName: ticket.clientName,
    category: ticket.category,
    status,
    priority: ticket.priority,
    assignedRep: ticket.assignedRep,
    assignedUserId: ticket.assignedUserId
      ? String(ticket.assignedUserId)
      : null,
    createdByUserId: ticket.createdByUserId
      ? String(ticket.createdByUserId)
      : null,
    createdByName: ticket.createdByName ?? '',
    policyNumber: ticket.policyNumber,
    policyType: ticket.policyType,
    household: ticket.household,
    policyId: ticket.policyId ? String(ticket.policyId) : null,
    householdId: ticket.householdId ? String(ticket.householdId) : null,
    leadId: ticket.leadId ? String(ticket.leadId) : null,
    // A quote ticket's status belongs to its lead. The pickers render a static
    // badge off this rather than re-deriving `leadId !== null` per surface.
    isStatusLocked: ticket.leadId != null,
    leadStatus,
    phone: ticket.phone,
    email: ticket.email,
    daysOpen: daysBetween(openedAt, new Date()),
    lastActivity: relativeLabel(lastActivityAt),
    openedAt: openedAt.toISOString(),
    lastActivityAt: lastActivityAt.toISOString(),
    resolvedAt: resolvedAt ? resolvedAt.toISOString() : null,
    isArchived,
    timeline: (ticket.timeline ?? []).map((e) =>
      serializeActivity(e as ServiceTicketActivityEntry & { _id?: unknown }),
    ),
    // Category-driven, so the button appears on a fresh ticket before any
    // transfer exists. `policyTransfer` non-null is what then replaces it with
    // the read-only summary.
    allowsPolicyTransfer: allowsPolicyTransfer(ticket.category),
    policyTransfer,
    onboarding,
    renewal: ticket.renewal
      ? serializeRenewalStep(
          ticket.renewal,
          // Agenda and merge metadata come from the shipped definitions; a
          // per-agency override would be resolved by the caller instead.
          DEFAULT_RENEWAL_STEP_DEFINITIONS,
          now,
        )
      : null,
  };
}

function daysBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

function relativeLabel(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const mins = Math.floor(diffMs / (1000 * 60));
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return formatTimestamp(date);
}

function formatTimestamp(date: Date): string {
  const datePart = date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const timePart = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
  return `${datePart} — ${timePart}`;
}
