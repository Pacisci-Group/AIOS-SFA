import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  AccessContext,
  CreateLeadResponse,
  LEAD_SOURCE_NONE,
  NormalizedLeadSource,
  ServiceTicketView,
  leadStatusQueryValues,
  normalizeLeadSource,
  normalizeLeadStatus,
} from '@sfa/shared';
import { FilterQuery, Model, Types } from 'mongoose';
import { buildScopeFilter } from '../common/access/scope-filter';
import { LeadTicketsService } from '../crm/lead-tickets.service';
import { TenantContextResolver } from '../common/tenancy/tenant-context.resolver';
import { LeadAccessService } from './lead-access.service';
import { CreateLeadDto } from './dto/create-lead.dto';
import { ListLeadsDto } from './dto/list-leads.dto';
import { LeadIntakeService } from './intake/lead-intake.service';
import { IntakeContext } from './intake/intake.types';
import { LeadListResponse, LeadRow } from './leads.types';
import { Lead, LeadDocument } from './schemas/lead.schema';

/** Lean projection of the fields the list renders. */
type LeadLean = Pick<
  Lead,
  | 'firstName'
  | 'lastName'
  | 'emails'
  | 'phones'
  | 'status'
  | 'temperature'
  | 'quoteControlNumber'
> & {
  _id: Types.ObjectId;
  leadSource?: NormalizedLeadSource;
  lastActivityAt?: Date;
};

/** Escape a user-supplied string before embedding it in a `$regex`. */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

@Injectable()
export class LeadsService {
  constructor(
    @InjectModel(Lead.name) private readonly leadModel: Model<LeadDocument>,
    private readonly tenancy: TenantContextResolver,
    private readonly intake: LeadIntakeService,
    private readonly leadAccess: LeadAccessService,
    private readonly leadTickets: LeadTicketsService,
  ) {}

  /**
   * Create a lead from the authenticated New Lead form (PAC-37).
   *
   * Builds the internal {@link IntakeContext} and hands off — all matching,
   * dedupe, linking and assignment live in {@link LeadIntakeService}, which is
   * shared verbatim with the public share-link route.
   */
  async create(
    access: AccessContext,
    branchId: string | null,
    dto: CreateLeadDto,
  ): Promise<CreateLeadResponse> {
    const ctx = await this.buildInternalContext(access, branchId, dto);
    const outcome = await this.intake.process(ctx, {
      primaryContact: dto.primaryContact,
      address: dto.address,
      members: dto.members,
      policiesOfInterest: dto.policiesOfInterest,
      quoteControlNumber: dto.quoteControlNumber,
      submissionToken: dto.submissionToken,
      // Set only by the Household page's "Start Quote" flow, where the caller
      // already has the household open. Absent everywhere else, including the
      // public route, whose schema does not accept it.
      householdId: dto.householdId,
    });
    return { id: outcome.leadId.toString() };
  }

  /**
   * Open the CRM service ticket for a lead, or return the one it already has —
   * `POST /leads/:id/service-ticket`, called by the Start Quote dialog.
   *
   * Scope is clamped here, by the same `loadOwnedLead` every other lead-scoped
   * write goes through: a producer cannot open a ticket against someone else's
   * lead, and asking 404s rather than 403s. `LeadTicketsService` then does the
   * work without a second permission check, which is why that clamp has to
   * happen on this side of the call.
   */
  async openServiceTicket(
    access: AccessContext,
    branchId: string | null,
    leadId: string,
  ): Promise<ServiceTicketView> {
    const lead = await this.leadAccess.loadOwnedLead(access, branchId, leadId);
    return this.leadTickets.ensureForLead(access, lead);
  }

  /**
   * Tenancy for a lead typed in by a signed-in user.
   *
   * The caller is always the producer, with no role check — `leads:write` is
   * held by Agency Owner and Branch Manager too, so either can end up owning a
   * lead. That mirrors legacy and is an accepted trade-off (PAC-53), not an
   * oversight.
   */
  private async buildInternalContext(
    access: AccessContext,
    branchId: string | null,
    dto: CreateLeadDto,
  ): Promise<IntakeContext> {
    const tenant = await this.tenancy.resolve(access, branchId);
    const source = normalizeLeadSource(dto.leadSourceCode);

    return {
      agencyId: tenant.agencyId,
      branchId: tenant.branchId,
      producerId: new Types.ObjectId(access.userId),
      channel: 'internal',
      leadSource: { code: source.code, label: source.label },
      actorUserId: new Types.ObjectId(access.userId),
    };
  }

  /**
   * The Leads list (PAC-36). Everything — search, filters, sort, pagination — is
   * resolved server-side, so `total` is exact for every combination. (Legacy did
   * part of the work client-side over a fetched window, which made its totals and
   * page arithmetic approximate.)
   */
  async list(
    access: AccessContext,
    branchId: string | null,
    query: ListLeadsDto,
  ): Promise<LeadListResponse> {
    const { page, pageSize } = query;

    const filter = this.buildFilter(access, branchId, query);

    const total = await this.leadModel.countDocuments(filter);

    const records = await this.leadModel
      .find(filter)
      // `lastActivityAt` is the analogue of legacy's SmartSuite `last_updated`.
      // The Mongoose `updatedAt` is unusable for ordering: the migration stamped
      // every imported lead with the import run time. `_id` is a stable
      // tiebreaker so pagination doesn't shuffle between pages.
      .sort({ lastActivityAt: -1, _id: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean<LeadLean[]>();

    return {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      items: records.map((record) => this.toRow(record)),
    };
  }

  /** Compose the tenancy/scope clamp, the facet filters, and the search. */
  private buildFilter(
    access: AccessContext,
    branchId: string | null,
    query: ListLeadsDto,
  ): FilterQuery<LeadDocument> {
    // Tenancy + data-scope clamp. `scope`/`producerId` are the client's
    // *request*; `buildScopeFilter` only ever lets them narrow.
    const filter: FilterQuery<LeadDocument> = buildScopeFilter<LeadDocument>(
      access,
      branchId,
      { requestedScope: query.scope, producerId: query.producerId },
    );

    if (query.householdId) {
      // The DTO has already shape-checked it, so the cast cannot throw.
      filter.householdId = new Types.ObjectId(query.householdId);
    }

    if (query.status?.length) {
      // Each selected label expands to itself plus any raw SmartSuite code that
      // maps to it, so filtering "Requote" also finds documents storing `arW7O`.
      // Multiple selections are ORed by the single `$in`.
      filter.status = {
        $in: [...new Set(query.status.flatMap(leadStatusQueryValues))],
      };
    }
    if (query.temperature?.length) {
      filter.temperature = { $in: query.temperature };
    }
    if (query.leadSource === LEAD_SOURCE_NONE) {
      // Leads that arrived through a public share link carry no source — nobody
      // has said where they came from yet. Producers need to isolate them to
      // correct them, so "no source" is a first-class filter value rather than
      // something you hunt for by eye. Both shapes are matched: the schema
      // default `{ code: null, label: '' }`, and migrated records where the
      // field is absent entirely.
      filter.$and = [
        ...(filter.$and ?? []),
        {
          $or: [
            { 'leadSource.label': '' },
            { 'leadSource.label': { $exists: false } },
            { leadSource: null },
          ],
        },
      ];
    } else if (query.leadSource) {
      filter['leadSource.label'] = query.leadSource;
    }

    const dateRange = this.buildDateRange(query);
    if (dateRange) {
      // `createdDate` is the source-system creation date; fall back to the
      // Mongoose timestamp for records the migration left without one.
      filter.$and = [
        ...(filter.$and ?? []),
        {
          $or: [
            { createdDate: dateRange },
            { createdDate: null, createdAt: dateRange },
          ],
        },
      ];
    }

    const search = this.buildSearch(query.search);
    if (search) {
      filter.$and = [...(filter.$and ?? []), search];
    }

    return filter;
  }

  /** Inclusive `createdDate` range; `dateTo` covers the whole day. */
  private buildDateRange(
    query: ListLeadsDto,
  ): { $gte?: Date; $lte?: Date } | null {
    if (!query.dateFrom && !query.dateTo) return null;

    const range: { $gte?: Date; $lte?: Date } = {};
    if (query.dateFrom) {
      range.$gte = query.dateFrom;
    }
    if (query.dateTo) {
      const end = new Date(query.dateTo);
      end.setUTCHours(23, 59, 59, 999);
      range.$lte = end;
    }
    return range;
  }

  /**
   * Interpret the free-text query by shape, as legacy did — with its two worst
   * quirks fixed:
   *
   * - Legacy tested `/^[a-z0-9]{8,}$/` for a quote control number *first and
   *   exclusively*, so an ordinary surname like "Rodriguez" was treated as a QCN
   *   search (and a real `QCN-11741` failed the regex because of the hyphen).
   *   Here QCN is just one more branch of the general `$or`.
   * - Legacy matched only `first_name` server-side and refined the rest in
   *   memory. Every branch below is exact and server-side.
   */
  private buildSearch(raw?: string): FilterQuery<LeadDocument> | null {
    const q = (raw ?? '').trim();
    if (!q) return null;

    if (q.includes('@')) {
      // Mongo matches array fields element-wise, so this hits any of `emails`.
      return { emails: { $regex: escapeRegex(q), $options: 'i' } };
    }

    const digits = q.replace(/\D/g, '');
    if (digits.length >= 7) {
      return {
        $or: [
          { phones: { $regex: this.phoneRegex(digits) } },
          { quoteControlNumber: { $regex: escapeRegex(q), $options: 'i' } },
        ],
      };
    }

    const escaped = escapeRegex(q);
    const contains = { $regex: escaped, $options: 'i' };
    return {
      $or: [
        { firstName: contains },
        { lastName: contains },
        // Matches a full "first last" query, which neither single field can.
        {
          $expr: {
            $regexMatch: {
              input: {
                $trim: {
                  input: {
                    $concat: [
                      { $ifNull: ['$firstName', ''] },
                      ' ',
                      { $ifNull: ['$lastName', ''] },
                    ],
                  },
                },
              },
              regex: escaped,
              options: 'i',
            },
          },
        },
        { 'leadSource.label': contains },
        { quoteControlNumber: contains },
      ],
    };
  }

  /**
   * Match a digits-only query against phone numbers stored in whatever format
   * the source system used — `5551234` becomes `5\D*5\D*5\D*1\D*2\D*3\D*4`, so
   * it hits `(555) 123-4xxx` and `555.1234` alike.
   *
   * The input is digits only, so the pattern is injection-safe by construction.
   * It is not index-backed, but it always runs ANDed under `agencyId` (plus the
   * producer or branch clamp), which keeps the scanned set small. If this shows
   * up in profiling, the fix is a stored `phonesNormalized` field + backfill —
   * a separate ticket, not a speculative addition here.
   */
  private phoneRegex(digits: string): string {
    return digits.split('').join('\\D*');
  }

  /** Map a stored document to the display-ready row DTO. */
  private toRow(record: LeadLean): LeadRow {
    const name = [record.firstName, record.lastName]
      .filter((part) => Boolean(part?.trim()))
      .join(' ')
      .trim();

    const source = normalizeLeadSource(
      record.leadSource?.code,
      record.leadSource?.label,
    );

    return {
      id: record._id.toString(),
      name: name || 'Unknown Lead',
      leadSource: source.label,
      status: normalizeLeadStatus(record.status),
      temperature: record.temperature ?? 'Unknown',
      phone: record.phones?.[0] ?? null,
      email: record.emails?.[0] ?? null,
      updatedAt: record.lastActivityAt?.toISOString() ?? null,
    };
  }
}
