import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  AccessContext,
  DataScope,
  ServiceTicketActivity,
  ServiceTicketStats,
  ServiceTicketView,
} from '@sfa/shared';
import { FilterQuery, Model, Types } from 'mongoose';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  AddNoteDto,
  CreateServiceTicketDto,
  ListTicketsQueryDto,
  UpdateStatusDto,
} from './dto/service-ticket.dto';
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
  ) {}

  /**
   * Build the tenant + data-scope filter for the requesting user. `own` sees
   * only tickets assigned to them, `branch` sees their branch, `agency` sees
   * the whole agency.
   */
  private scopeFilter(access: AccessContext): FilterQuery<ServiceTicketDocument> {
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
    if (query.status) {
      filter.status = query.status;
    }
    const tickets = await this.ticketModel
      .find(filter)
      .sort({ lastActivityAt: -1 })
      .lean();
    return tickets.map((t) => serializeTicket(t));
  }

  async findOne(
    access: AccessContext,
    id: string,
  ): Promise<ServiceTicketView> {
    const ticket = await this.getScopedOrThrow(access, id);
    return serializeTicket(ticket);
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
      access.branchId ?? (assignee?.branchId ? String(assignee.branchId) : null);

    const now = new Date();
    const ticketNumber = await this.nextTicketNumber(
      access.agencyId,
      dto.category,
    );

    const timeline: ServiceTicketActivityEntry[] = [
      {
        type: 'created',
        content: dto.openingNote?.trim()
          ? dto.openingNote.trim()
          : `Ticket opened — ${dto.category}.`,
        at: now,
      } as ServiceTicketActivityEntry,
    ];

    const created = await this.ticketModel.create({
      agencyId: new Types.ObjectId(access.agencyId),
      branchId: branchId ? new Types.ObjectId(branchId) : null,
      ticketNumber,
      clientName: dto.clientName,
      category: dto.category,
      status: dto.status ?? 'open',
      priority: dto.priority ?? 'medium',
      assignedRep,
      assignedUserId: assignedUserId
        ? new Types.ObjectId(assignedUserId)
        : null,
      policyNumber: dto.policyNumber ?? '',
      policyType: dto.policyType ?? '',
      household: dto.household ?? '',
      phone: dto.phone ?? '',
      email: dto.email ?? '',
      openedAt: now,
      lastActivityAt: now,
      timeline,
    });

    return serializeTicket(created.toObject());
  }

  async updateStatus(
    access: AccessContext,
    id: string,
    dto: UpdateStatusDto,
  ): Promise<ServiceTicketView> {
    const ticket = await this.getScopedOrThrow(access, id);
    const previous = ticket.status;
    if (previous !== dto.status) {
      const now = new Date();
      ticket.status = dto.status;
      ticket.lastActivityAt = now;
      ticket.timeline.push({
        type: 'status',
        author: await this.resolveUserName(access.userId),
        content: `Status changed: ${statusLabel(previous)} → ${statusLabel(dto.status)}`,
        at: now,
      } as ServiceTicketActivityEntry);
      await ticket.save();
    }
    return serializeTicket(ticket.toObject());
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
    } as ServiceTicketActivityEntry);
    ticket.lastActivityAt = now;
    await ticket.save();
    return serializeTicket(ticket.toObject());
  }

  async stats(access: AccessContext): Promise<ServiceTicketStats> {
    const filter = this.scopeFilter(access);
    const tickets = await this.ticketModel.find(filter).lean();

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const openTickets = tickets.filter((t) => t.status !== 'resolved').length;
    const needsActionToday = tickets.filter(
      (t) => t.status === 'overdue',
    ).length;
    const resolvedToday = tickets.filter(
      (t) =>
        t.status === 'resolved' &&
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

  private async resolveUserName(userId: string | null | undefined): Promise<string> {
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
  ): Promise<string> {
    const prefix = CATEGORY_PREFIX[category] ?? 'TKT';
    const count = await this.ticketModel.countDocuments({
      agencyId: new Types.ObjectId(agencyId),
    });
    return `${prefix}-${100 + count + 1}`;
  }
}

const CATEGORY_PREFIX: Record<string, string> = {
  'Renewal Review': 'RENEW',
  'Claims Inquiry': 'CLAIM',
  'Premium Dispute': 'PREM',
  'Policy Change': 'PCHG',
  'Billing Issue': 'BILL',
  'Coverage Question': 'CVGQ',
  'Cancellation Request': 'CANC',
  'New Business': 'NEWB',
};

function statusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
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

function serializeTicket(
  ticket: ServiceTicket & { _id: unknown },
): ServiceTicketView {
  const openedAt = new Date(ticket.openedAt);
  const lastActivityAt = new Date(ticket.lastActivityAt);
  return {
    id: String(ticket._id),
    ticketNumber: ticket.ticketNumber,
    clientName: ticket.clientName,
    category: ticket.category,
    status: ticket.status,
    priority: ticket.priority,
    assignedRep: ticket.assignedRep,
    assignedUserId: ticket.assignedUserId
      ? String(ticket.assignedUserId)
      : null,
    policyNumber: ticket.policyNumber,
    policyType: ticket.policyType,
    household: ticket.household,
    phone: ticket.phone,
    email: ticket.email,
    daysOpen: daysBetween(openedAt, new Date()),
    lastActivity: relativeLabel(lastActivityAt),
    openedAt: openedAt.toISOString(),
    lastActivityAt: lastActivityAt.toISOString(),
    timeline: (ticket.timeline ?? []).map((e) =>
      serializeActivity(e as ServiceTicketActivityEntry & { _id?: unknown }),
    ),
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
