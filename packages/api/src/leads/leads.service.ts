import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  AccessContext,
  DataScope,
  NormalizedLeadSource,
  leadStatusQueryValues,
  normalizeLeadSource,
  normalizeLeadStatus,
} from '@sfa/shared';
import { FilterQuery, Model, Types } from 'mongoose';
import { ListLeadsDto } from './dto/list-leads.dto';
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
  ) {}

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
    const filter: FilterQuery<LeadDocument> = {
      agencyId: access.agencyId,
      isTestRecord: { $ne: true },
    };

    this.applyScope(filter, access, branchId, query);

    if (query.status) {
      // Match both the canonical label and any raw SmartSuite code that maps to
      // it, so filtering "Requote" also finds documents storing `arW7O`.
      filter.status = { $in: leadStatusQueryValues(query.status) };
    }
    if (query.temperature) {
      filter.temperature = query.temperature;
    }
    if (query.leadSource) {
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

  /**
   * Data scope is enforced here, never in the controller, and a client-supplied
   * `scope`/`producerId` can only ever *narrow* the result set:
   *
   * - `own`    — pinned to the caller. `scope=agency` and a foreign `producerId`
   *              are silently ignored rather than rejected, so a stale tab or a
   *              tampered query returns the caller's own leads instead of an
   *              error or (as in legacy) somebody else's.
   * - `branch` — pinned to the caller's branch; `producerId` applies *within* it.
   * - `agency` — pinned to the agency; `producerId` applies within it.
   *
   * `scope=own` is honoured at every level as a voluntary narrowing (the My/Agency
   * toggle).
   */
  private applyScope(
    filter: FilterQuery<LeadDocument>,
    access: AccessContext,
    branchId: string | null,
    query: ListLeadsDto,
  ): void {
    const self = new Types.ObjectId(access.userId);

    if (access.dataScope === DataScope.Own) {
      filter.producerId = self;
      return;
    }

    if (access.dataScope === DataScope.Branch && branchId) {
      filter.branchId = branchId;
    }
    // Agency scope: no narrowing beyond agencyId.

    if (query.scope === 'own') {
      filter.producerId = self;
      return;
    }

    if (query.producerId && Types.ObjectId.isValid(query.producerId)) {
      // Kept alongside the branch clamp above, so a branch-scoped user can't
      // reach a producer outside their branch.
      filter.producerId = new Types.ObjectId(query.producerId);
    }
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
