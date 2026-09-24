import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  DataScope,
  MANAGEMENT_AUDIT_SLA_BUSINESS_DAYS,
  normalizeLeadStatus,
} from '@sfa/shared';
import type {
  AccessContext,
  AgingAuditRow,
  ManagementAlertList,
  ManagementAlerts,
  OverdueTicketRow,
  ProducerDrawerResponse,
  ProducerOpenAuditItem,
  ProducerPipelineLead,
  StalledLeadRow,
  TeamActivityResponse,
  TeamActivityRow,
  TeamActivityStats,
  UserAvailability,
} from '@sfa/shared';
import { Aggregate, FilterQuery, Model, PipelineStage, Types } from 'mongoose';
import {
  agingCutoff,
  businessDaysBetween,
} from '../common/dates/business-days';
import { daysSince } from '../common/domain/deal-derive';
import { initialsFrom } from '../common/domain/initials';
import { displayName, displayNamesFor } from '../common/domain/user-names';
import {
  quotedMatch,
  resolvePeriod,
  salesScope,
  soldMatch,
} from '../common/sales-metrics/sales-matches';
import {
  QUOTED_LINES,
  SOLD_LINES,
  linesPrefix,
} from '../common/sales-metrics/sales-pipelines';
import {
  ServiceTicket,
  ServiceTicketDocument,
} from '../crm/schemas/service-ticket.schema';
import { ticketTenantFilter } from '../crm/service-ticket-queries';
import {
  DealAuditItem,
  DealAuditItemDocument,
} from '../deal-audit-items/schemas/deal-audit-item.schema';
import {
  DealAudit,
  DealAuditDocument,
} from '../deal-audits/schemas/deal-audit.schema';
import { Deal, DealDocument } from '../deals/schemas/deal.schema';
import { LeadSourcesService } from '../lead-sources/lead-sources.service';
import { Lead, LeadDocument } from '../leads/schemas/lead.schema';
import {
  YmdRange,
  chicagoDayStart,
  chicagoParts,
  fromYmd,
  toYmd,
} from '../performance/performance.range';
import { RoleAssignmentsService } from '../permissions/role-assignments.service';
import {
  QuoteRecap,
  QuoteRecapDocument,
} from '../quote-recaps/schemas/quote-recap.schema';
import {
  AgencyRole,
  AgencyRoleDocument,
} from '../roles/schemas/agency-role.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import type {
  ManagementAlertListQueryDto,
  ManagementDashboardQueryDto,
} from './dto/management-dashboard-query.dto';
import {
  COUNT_STAGE,
  LATEST_QUOTE_LOOKUP,
  activePipelinePrefix,
  agingAuditsPrefix,
  householdsByProducer,
  openAuditItemsByProducer,
  overdueTicketsPrefix,
  pagedFacet,
  producerOpenAuditItems,
  stalledLeadsPrefix,
} from './management-dashboard.pipelines';

/** The role slug whose holders make up the Team Activity roster. */
const PRODUCER_ROLE_SLUG = 'producer';

/** The most leads the producer drawer's Active Pipeline lists. */
const MAX_PIPELINE_LEADS = 50;

interface KeyedCount {
  _id: Types.ObjectId | null;
  count: number;
}

interface KeyedOpenItems {
  _id: Types.ObjectId | null;
  openAuditItems: number;
}

interface RosterEntry {
  name: string;
  availability: UserAvailability | null;
}

interface StalledLeadLean {
  _id: Types.ObjectId;
  firstName?: string;
  lastName?: string;
  status?: string;
  producerId?: Types.ObjectId;
  householdId?: Types.ObjectId;
  leadSourceId?: Types.ObjectId;
  lastActivityAt?: Date;
}

interface AgingDealLean {
  _id: Types.ObjectId;
  clientName?: string;
  producerId?: Types.ObjectId;
  householdId?: Types.ObjectId;
  soldDate?: Date;
  soldDateYmd?: number;
  _audit: {
    _id: Types.ObjectId;
    auditStatus?: string;
    openFailedCount?: number;
  }[];
}

interface OverdueTicketLean {
  _id: Types.ObjectId;
  ticketNumber: string;
  clientName: string;
  category: string;
  assignedUserId?: Types.ObjectId | null;
  assignedRep?: string;
  householdId?: Types.ObjectId | null;
  openedAt: Date;
  onboarding?: { dueAt?: Date | null } | null;
  renewal?: { dueAt?: Date | null } | null;
}

interface PipelineLeadLean {
  _id: Types.ObjectId;
  firstName?: string;
  lastName?: string;
  status?: string;
  householdId?: Types.ObjectId;
  policiesOfInterest?: { policyType: string }[];
  createdDate?: Date;
  createdAt?: Date;
  lastActivityAt?: Date;
  _quote: { premium?: number }[];
}

interface OpenItemLean {
  _id: Types.ObjectId;
  dealAuditId?: Types.ObjectId;
  dealId?: Types.ObjectId;
  itemName?: string;
  title?: string;
  raisedAt?: Date;
  clientName?: string;
  householdId?: Types.ObjectId;
  soldDate?: Date;
}

interface UserLean {
  _id: Types.ObjectId;
  firstName?: string;
  lastName?: string;
  email: string;
  branchId?: Types.ObjectId | null;
  availability?: UserAvailability;
}

/**
 * What `count` and `page` need from a model. Structural rather than `Model<T>`
 * because the hydrated document types of two collections are unrelated, and a
 * helper generic over `Model<T>` cannot take both.
 */
interface Aggregator {
  aggregate<R>(pipeline: PipelineStage[]): Aggregate<R[]>;
}

const key = (id: Types.ObjectId | null | undefined): string =>
  id ? id.toString() : '';

const iso = (date: Date | null | undefined): string | null =>
  date ? date.toISOString() : null;

/** `sold ÷ quoted` as a percentage to one decimal; `null` over no quotes. */
function householdRatio(sold: number, quoted: number): number | null {
  return quoted > 0 ? Math.round((sold / quoted) * 1000) / 10 : null;
}

/**
 * The Manager View dashboard — "Action Hub" (PAC-139).
 *
 * Read-only projections of `leads`, `deals`, `dealAudits`, `dealAuditItems`,
 * `quoteRecaps` and `serviceTickets`, live on every request. Every match starts
 * from the same scope clamp the Owner view uses (`salesScope`), so the page is
 * "the whole agency" only for a caller whose `DataScope` reaches that far.
 *
 * ## Three definitions, settled 23 Sep 2026
 *
 * - **Stalled lead** — `lastActivityAt` more than 48 hours ago (or never),
 *   status not terminal. Not `updatedAt`: see `stalledLeadsPrefix`.
 * - **Aging audit** — a new-business deal sold in the period, more than five
 *   *business* days ago (`business-days.ts`), whose audit is not `Pass`.
 * - **Overdue ticket** — stored `status: 'overdue'`, for tickets opened in
 *   the period. The column is materialised by `SyncTicketStatusFn`
 *   (PAC-102), so this agrees with the Service dashboard and the queue.
 *
 * ## What the filters reach
 *
 * Producer narrows the three cards and the producer drawer, never the Team
 * Activity roster ("how many producers have stalled leads" — David, 00:29:05).
 * Lead source and line of business narrow everything. Period narrows
 * everything **except Open Audit Items**, which is an all-time backlog.
 */
@Injectable()
export class ManagementDashboardService {
  constructor(
    @InjectModel(Lead.name) private readonly leadModel: Model<LeadDocument>,
    @InjectModel(Deal.name) private readonly dealModel: Model<DealDocument>,
    @InjectModel(DealAudit.name)
    private readonly dealAuditModel: Model<DealAuditDocument>,
    @InjectModel(DealAuditItem.name)
    private readonly dealAuditItemModel: Model<DealAuditItemDocument>,
    @InjectModel(QuoteRecap.name)
    private readonly quoteRecapModel: Model<QuoteRecapDocument>,
    @InjectModel(ServiceTicket.name)
    private readonly ticketModel: Model<ServiceTicketDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(AgencyRole.name)
    private readonly roleModel: Model<AgencyRoleDocument>,
    private readonly leadSources: LeadSourcesService,
    private readonly roleAssignments: RoleAssignmentsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Alert cards
  // ---------------------------------------------------------------------------

  async alerts(
    access: AccessContext,
    branchId: string | null,
    query: ManagementDashboardQueryDto,
  ): Promise<ManagementAlerts> {
    const now = new Date();
    const { period, current } = resolvePeriod(query);

    const [stalledLeads, agingAudits, overdueTickets] = await Promise.all([
      this.count(
        this.leadModel,
        this.stalledPrefix(access, branchId, query, current, now),
      ),
      this.count(
        this.dealModel,
        this.agingPrefix(access, branchId, query, current, now),
      ),
      this.count(
        this.ticketModel,
        this.overduePrefix(access, branchId, query, current),
      ),
    ]);

    return { period, stalledLeads, agingAudits, overdueTickets };
  }

  async stalledLeads(
    access: AccessContext,
    branchId: string | null,
    query: ManagementAlertListQueryDto,
  ): Promise<ManagementAlertList<StalledLeadRow>> {
    const now = new Date();
    const { period, current } = resolvePeriod(query);

    const { total, items } = await this.page<StalledLeadLean>(
      this.leadModel,
      this.stalledPrefix(access, branchId, query, current, now),
      // Stalest first: the lead nobody has touched for longest is the one to
      // chase first.
      { lastActivityAt: 1, _id: 1 },
      query,
    );

    const [names, sources] = await Promise.all([
      displayNamesFor(
        this.userModel,
        [...new Set(items.map((lead) => key(lead.producerId)))].filter(Boolean),
      ),
      this.leadSources.labelsFor(access.agencyId),
    ]);

    return this.list(period, query, total, items, (lead) => ({
      leadId: lead._id.toString(),
      name: leadName(lead),
      status: normalizeLeadStatus(lead.status),
      producerId: key(lead.producerId) || null,
      producerName: names.get(key(lead.producerId)) ?? null,
      householdId: key(lead.householdId) || null,
      leadSourceName: sources.get(key(lead.leadSourceId)) ?? null,
      lastActivityAt: iso(lead.lastActivityAt),
      hoursSinceActivity: lead.lastActivityAt
        ? Math.floor(
            (now.getTime() - lead.lastActivityAt.getTime()) / 3_600_000,
          )
        : null,
    }));
  }

  async agingAudits(
    access: AccessContext,
    branchId: string | null,
    query: ManagementAlertListQueryDto,
  ): Promise<ManagementAlertList<AgingAuditRow>> {
    const now = new Date();
    const today = chicagoParts(now);
    const { period, current } = resolvePeriod(query);

    const { total, items } = await this.page<AgingDealLean>(
      this.dealModel,
      this.agingPrefix(access, branchId, query, current, now),
      // Oldest sale first — the one that has been waiting longest.
      { soldDateYmd: 1, _id: 1 },
      query,
    );

    const names = await displayNamesFor(
      this.userModel,
      [...new Set(items.map((deal) => key(deal.producerId)))].filter(Boolean),
    );

    return this.list(period, query, total, items, (deal) => {
      const audit = deal._audit[0];
      return {
        dealAuditId: audit._id.toString(),
        dealId: deal._id.toString(),
        householdId: key(deal.householdId) || null,
        clientName: deal.clientName?.trim() || 'Unknown client',
        producerId: key(deal.producerId) || null,
        producerName: names.get(key(deal.producerId)) ?? null,
        auditStatus: audit.auditStatus ?? 'Not Submitted',
        openFailedCount: audit.openFailedCount ?? 0,
        soldDate: iso(deal.soldDate),
        businessDaysOpen: deal.soldDateYmd
          ? businessDaysBetween(fromYmd(deal.soldDateYmd), today)
          : 0,
      };
    });
  }

  async overdueTickets(
    access: AccessContext,
    branchId: string | null,
    query: ManagementAlertListQueryDto,
  ): Promise<ManagementAlertList<OverdueTicketRow>> {
    // `now` is for the row's `daysOverdue` only; the match reads the stored
    // status and needs no clock.
    const now = new Date();
    const { period, current } = resolvePeriod(query);

    const { total, items } = await this.page<OverdueTicketLean>(
      this.ticketModel,
      this.overduePrefix(access, branchId, query, current),
      { openedAt: 1, _id: 1 },
      query,
    );

    return this.list(period, query, total, items, (ticket) => {
      const dueAt = ticket.onboarding?.dueAt ?? ticket.renewal?.dueAt ?? null;
      return {
        ticketId: ticket._id.toString(),
        ticketNumber: ticket.ticketNumber,
        clientName: ticket.clientName,
        category: ticket.category,
        assignedUserId: key(ticket.assignedUserId) || null,
        assignedRep: ticket.assignedRep ?? '',
        householdId: key(ticket.householdId) || null,
        dueAt: iso(dueAt),
        openedAt: ticket.openedAt.toISOString(),
        daysOverdue: dueAt && dueAt < now ? daysSince(dueAt, now) : null,
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Team Activity
  // ---------------------------------------------------------------------------

  async team(
    access: AccessContext,
    branchId: string | null,
    query: ManagementDashboardQueryDto,
  ): Promise<TeamActivityResponse> {
    const { period, current } = resolvePeriod(query);

    // No producer multi-select here, by design: the table *is* the team.
    const [sold, quoted, open, roster] = await Promise.all([
      this.householdsSoldBy(access, branchId, undefined, query, current),
      this.householdsQuotedBy(access, branchId, undefined, query, current),
      this.openItemsBy(access, branchId, undefined),
      this.roster(access, branchId),
    ]);

    const ids = new Set<string>([
      ...roster.keys(),
      ...sold.keys(),
      ...quoted.keys(),
      ...open.keys(),
    ]);
    ids.delete('');

    // Someone with sales in the window who does not hold the producer role —
    // the owner closing a deal, or a producer who has since left — still sold
    // them; the row stays, described here instead of by the roster.
    const others = await this.usersFor(
      [...ids].filter((id) => !roster.has(id)),
    );

    const rows: TeamActivityRow[] = [...ids].map((id) => {
      const person = roster.get(id) ?? others.get(id);
      const name = person?.name ?? 'Unknown producer';
      const householdsSold = sold.get(id) ?? 0;
      const householdsQuoted = quoted.get(id) ?? 0;
      return {
        producerId: id,
        name,
        initials: initialsFrom(name),
        availability: person?.availability ?? null,
        householdsQuoted,
        householdsSold,
        householdCloseRatio: householdRatio(householdsSold, householdsQuoted),
        openAuditItems: open.get(id) ?? 0,
      };
    });

    // Most households sold first, then most quoted, then by name — so equal
    // producers never swap between loads.
    rows.sort(
      (a, b) =>
        b.householdsSold - a.householdsSold ||
        b.householdsQuoted - a.householdsQuoted ||
        a.name.localeCompare(b.name),
    );

    return { period, rows, totals: this.totalsOf(rows) };
  }

  // ---------------------------------------------------------------------------
  // Producer drawer
  // ---------------------------------------------------------------------------

  async producer(
    access: AccessContext,
    branchId: string | null,
    producerId: string,
    query: ManagementDashboardQueryDto,
  ): Promise<ProducerDrawerResponse> {
    const user = await this.userModel
      .findOne({
        _id: new Types.ObjectId(producerId),
        agencyId: new Types.ObjectId(access.agencyId ?? ''),
        isPlatformAdmin: { $ne: true },
      })
      .select('firstName lastName email branchId availability isActive')
      .lean<(UserLean & { isActive: boolean }) | null>();

    // Outside the caller's scope reads as "no such producer", not as a hint
    // that there is one — the same answer a wrong id gets.
    if (!user || !this.inScope(access, branchId, user)) {
      throw new NotFoundException('Producer not found');
    }

    const now = new Date();
    const { period, current } = resolvePeriod(query);
    const pinned = [producerId];

    const [sold, quoted, open, pipeline, items] = await Promise.all([
      this.householdsSoldBy(access, branchId, pinned, query, current),
      this.householdsQuotedBy(access, branchId, pinned, query, current),
      this.openItemsBy(access, branchId, pinned),
      this.leadModel.aggregate<PipelineLeadLean>([
        ...activePipelinePrefix(
          salesScope<LeadDocument>(access, branchId, pinned),
          query,
          current,
        ),
        // Most recently worked first; `_id` keeps the order stable.
        { $sort: { lastActivityAt: -1, _id: -1 } },
        { $limit: MAX_PIPELINE_LEADS },
        LATEST_QUOTE_LOOKUP,
      ]),
      this.dealAuditItemModel.aggregate<OpenItemLean>(
        producerOpenAuditItems(
          access.agencyId ?? '',
          salesScope<DealDocument>(access, branchId, pinned),
        ),
      ),
    ]);

    // Pinned to one producer, so each map holds at most that one key — summed
    // rather than indexed so a sale with no `producerId` can never leak in.
    const sum = (map: Map<string, number>) =>
      [...map.entries()]
        .filter(([id]) => id === producerId)
        .reduce((acc, [, value]) => acc + value, 0);
    const householdsSold = sum(sold);
    const householdsQuoted = sum(quoted);

    const name = displayName(user);

    return {
      period,
      producer: {
        producerId,
        name,
        initials: initialsFrom(name),
        availability: user.isActive ? (user.availability ?? null) : null,
      },
      stats: {
        householdsQuoted,
        householdsSold,
        householdCloseRatio: householdRatio(householdsSold, householdsQuoted),
        openAuditItems: sum(open),
      },
      activePipeline: pipeline.map((lead): ProducerPipelineLead => ({
        leadId: lead._id.toString(),
        name: leadName(lead),
        householdId: key(lead.householdId) || null,
        status: normalizeLeadStatus(lead.status),
        lineOfBusiness:
          lead.policiesOfInterest
            ?.map((row) => row.policyType)
            .filter(Boolean)
            .join(' · ') || null,
        ageDays: daysSince(lead.createdDate ?? lead.createdAt, now),
        value: lead._quote[0]?.premium ?? null,
        lastActivityAt: iso(lead.lastActivityAt),
      })),
      openAuditItems: items.map((item): ProducerOpenAuditItem => ({
        dealAuditId: key(item.dealAuditId),
        dealId: key(item.dealId),
        householdId: key(item.householdId) || null,
        clientName: item.clientName?.trim() || 'Unknown client',
        itemTitle: item.itemName?.trim() || item.title?.trim() || 'Audit item',
        daysOpen: daysSince(item.raisedAt, now),
        soldDate: iso(item.soldDate),
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // Pipelines
  // ---------------------------------------------------------------------------

  private stalledPrefix(
    access: AccessContext,
    branchId: string | null,
    query: ManagementDashboardQueryDto,
    range: YmdRange,
    now: Date,
  ): PipelineStage[] {
    return stalledLeadsPrefix(
      salesScope<LeadDocument>(access, branchId, query.producerIds),
      query,
      range,
      now,
    );
  }

  /**
   * The business-day cutoff is folded into the sold-date window, so the
   * predicate is a plain indexed range: aging ⇔ `soldDateYmd < cutoff`.
   */
  private agingPrefix(
    access: AccessContext,
    branchId: string | null,
    query: ManagementDashboardQueryDto,
    range: YmdRange,
    now: Date,
  ): PipelineStage[] {
    const cutoffYmd = toYmd(
      agingCutoff(chicagoParts(now), MANAGEMENT_AUDIT_SLA_BUSINESS_DAYS),
    );
    const aged: YmdRange = {
      ...range,
      endYmd: Math.min(range.endYmd, cutoffYmd),
    };
    return agingAuditsPrefix(
      soldMatch(access, branchId, query.producerIds, aged),
      query,
    );
  }

  private overduePrefix(
    access: AccessContext,
    branchId: string | null,
    query: ManagementDashboardQueryDto,
    range: YmdRange,
  ): PipelineStage[] {
    // `openedAt` is a real instant, so the Chicago calendar window has to be
    // turned into two instants; `endYmd` is exclusive already.
    const window = {
      from: chicagoDayStart(fromYmd(range.startYmd)),
      to: chicagoDayStart(fromYmd(range.endYmd)),
    };
    return overdueTicketsPrefix(ticketTenantFilter(access), query, window);
  }

  private async householdsSoldBy(
    access: AccessContext,
    branchId: string | null,
    producerIds: readonly string[] | undefined,
    query: ManagementDashboardQueryDto,
    range: YmdRange,
  ): Promise<Map<string, number>> {
    const rows = await this.dealModel.aggregate<KeyedCount>(
      householdsByProducer(
        linesPrefix(
          soldMatch(access, branchId, producerIds, range),
          SOLD_LINES,
          query,
          false,
        ),
      ),
    );
    return new Map(rows.map((row) => [key(row._id), row.count]));
  }

  private async householdsQuotedBy(
    access: AccessContext,
    branchId: string | null,
    producerIds: readonly string[] | undefined,
    query: ManagementDashboardQueryDto,
    range: YmdRange,
  ): Promise<Map<string, number>> {
    const rows = await this.quoteRecapModel.aggregate<KeyedCount>(
      householdsByProducer(
        linesPrefix(
          quotedMatch(access, branchId, producerIds, range),
          QUOTED_LINES,
          query,
          false,
        ),
      ),
    );
    return new Map(rows.map((row) => [key(row._id), row.count]));
  }

  /** All-time, by design — see `TeamActivityStats.openAuditItems`. */
  private async openItemsBy(
    access: AccessContext,
    branchId: string | null,
    producerIds: readonly string[] | undefined,
  ): Promise<Map<string, number>> {
    const rows = await this.dealAuditModel.aggregate<KeyedOpenItems>(
      openAuditItemsByProducer(
        access.agencyId ?? '',
        salesScope<DealDocument>(access, branchId, producerIds),
      ),
    );
    return new Map(rows.map((row) => [key(row._id), row.openAuditItems]));
  }

  // ---------------------------------------------------------------------------
  // Roster and scope
  // ---------------------------------------------------------------------------

  /**
   * Active holders of the `producer` role, within the caller's scope. The
   * pattern is `ServiceTicketsService.listAssignees`: role by slug, users
   * through the `userRoles` join.
   */
  private async roster(
    access: AccessContext,
    branchId: string | null,
  ): Promise<Map<string, RosterEntry>> {
    if (!access.agencyId) return new Map();
    const agencyId = new Types.ObjectId(access.agencyId);

    const role = await this.roleModel
      .findOne({ agencyId, slug: PRODUCER_ROLE_SLUG })
      .select({ _id: 1 })
      .lean<{ _id: Types.ObjectId } | null>();
    if (!role) return new Map();

    let ids = await this.roleAssignments.roleUserIds(role._id);
    if (access.dataScope === DataScope.Own) {
      ids = ids.filter((id) => id.toString() === access.userId);
    }
    if (!ids.length) return new Map();

    const filter: FilterQuery<UserDocument> = {
      _id: { $in: ids },
      agencyId,
      isActive: true,
      isPlatformAdmin: { $ne: true },
    };
    const branch = this.branchFor(access, branchId);
    if (branch) filter.branchId = new Types.ObjectId(branch);

    const users = await this.userModel
      .find(filter)
      .select('firstName lastName email availability')
      .lean<UserLean[]>();

    return new Map(
      users.map((user) => [
        user._id.toString(),
        { name: displayName(user), availability: user.availability ?? null },
      ]),
    );
  }

  /**
   * Name and availability for users outside the roster. Deactivated users are
   * named — they still sold what they sold — but carry no availability: the
   * switch means nothing for someone who is gone.
   */
  private async usersFor(ids: string[]): Promise<Map<string, RosterEntry>> {
    if (!ids.length) return new Map();
    const users = await this.userModel
      .find({ _id: { $in: ids.map((id) => new Types.ObjectId(id)) } })
      .select('firstName lastName email availability isActive')
      .lean<(UserLean & { isActive?: boolean })[]>();
    return new Map(
      users.map((user) => [
        user._id.toString(),
        {
          name: displayName(user),
          availability: user.isActive ? (user.availability ?? null) : null,
        },
      ]),
    );
  }

  /** The branch a branch-scoped caller is clamped to; `null` otherwise. */
  private branchFor(
    access: AccessContext,
    branchId: string | null,
  ): string | null {
    if (access.dataScope !== DataScope.Branch) return null;
    return branchId ?? access.branchId;
  }

  private inScope(
    access: AccessContext,
    branchId: string | null,
    user: UserLean,
  ): boolean {
    if (access.dataScope === DataScope.Own) {
      return user._id.toString() === access.userId;
    }
    const branch = this.branchFor(access, branchId);
    return !branch || key(user.branchId) === branch;
  }

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------

  private async count(
    model: Aggregator,
    prefix: PipelineStage[],
  ): Promise<number> {
    const [row] = await model.aggregate<{ count: number }>([
      ...prefix,
      COUNT_STAGE,
    ]);
    return row?.count ?? 0;
  }

  private async page<TRow>(
    model: Aggregator,
    prefix: PipelineStage[],
    sort: Record<string, 1 | -1>,
    query: ManagementAlertListQueryDto,
  ): Promise<{ total: number; items: TRow[] }> {
    const [facet] = await model.aggregate<{
      total: { count: number }[];
      items: TRow[];
    }>([...prefix, pagedFacet(sort, query.page, query.pageSize)]);
    return {
      total: facet?.total[0]?.count ?? 0,
      items: facet?.items ?? [],
    };
  }

  private list<TLean, TRow>(
    period: ManagementAlertList<TRow>['period'],
    query: ManagementAlertListQueryDto,
    total: number,
    items: TLean[],
    toRow: (item: TLean) => TRow,
  ): ManagementAlertList<TRow> {
    return {
      period,
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
      items: items.map(toRow),
    };
  }

  private totalsOf(rows: TeamActivityStats[]): TeamActivityStats {
    const householdsQuoted = rows.reduce((s, r) => s + r.householdsQuoted, 0);
    const householdsSold = rows.reduce((s, r) => s + r.householdsSold, 0);
    return {
      householdsQuoted,
      householdsSold,
      householdCloseRatio: householdRatio(householdsSold, householdsQuoted),
      openAuditItems: rows.reduce((s, r) => s + r.openAuditItems, 0),
    };
  }
}

function leadName(lead: { firstName?: string; lastName?: string }): string {
  return (
    [lead.firstName, lead.lastName].filter(Boolean).join(' ').trim() ||
    'Unknown lead'
  );
}
