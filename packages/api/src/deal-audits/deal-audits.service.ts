import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { AccessContext, DataScope } from '@sfa/shared';
import { FilterQuery, Model, Types } from 'mongoose';
import { Deal, DealDocument, DealType } from '../deals/schemas/deal.schema';
import {
  AuditRecord,
  AuditRecordDocument,
} from '../audit-records/schemas/audit-record.schema';
import { ListDealAuditsDto } from './dto/list-deal-audits.dto';
import { DealAuditListResponse, DealAuditRow } from './deal-audits.types';

/** Lean projection of the fields the board reads (incl. timestamp). */
type AuditRecordLean = Pick<
  AuditRecord,
  'clientName' | 'itemName' | 'daysOpen' | 'firstCreatedAt'
> & {
  _id: Types.ObjectId;
  dealId?: Types.ObjectId;
  createdAt?: Date;
};

@Injectable()
export class DealAuditsService {
  constructor(
    @InjectModel(AuditRecord.name)
    private auditRecordModel: Model<AuditRecordDocument>,
    @InjectModel(Deal.name) private dealModel: Model<DealDocument>,
  ) {}

  /**
   * Deals pending service hand-off: audit items that failed and are not yet
   * resolved, scoped to the caller's data scope. Producers (`own`) only ever
   * see their own deals' items. Sorted oldest-open first and paginated.
   */
  async listPendingHandoff(
    access: AccessContext,
    branchId: string | null,
    query: ListDealAuditsDto,
  ): Promise<DealAuditListResponse> {
    const { page, pageSize } = query;

    const filter: FilterQuery<AuditRecordDocument> = {
      agencyId: access.agencyId,
      isFailed: true,
      isResolved: false,
      isTestRecord: { $ne: true },
    };

    if (access.dataScope === DataScope.Own) {
      // `own` scope is only meaningful with a concrete user id.
      filter.producerId = new Types.ObjectId(access.userId);
    } else if (access.dataScope === DataScope.Branch && branchId) {
      filter.branchId = branchId;
    }
    // Agency scope: no producer/branch narrowing beyond agencyId.

    const total = await this.auditRecordModel.countDocuments(filter);

    const records = await this.auditRecordModel
      .find(filter)
      // Oldest open first; `_id` tiebreaker keeps pagination stable.
      .sort({ daysOpen: -1, _id: 1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean<AuditRecordLean[]>();

    const dealType = await this.loadDealTypes(records);

    const items: DealAuditRow[] = records.map((record) => {
      const id = record._id.toString();
      const type = record.dealId
        ? (dealType.get(record.dealId.toString()) ?? 'Other')
        : 'Other';
      return {
        id,
        ref: this.maskRef(id, record.firstCreatedAt ?? record.createdAt),
        client: record.clientName ?? 'Unknown Client',
        type,
        missing: record.itemName ?? 'Missing requirement',
        daysOpen: record.daysOpen ?? 0,
      };
    });

    return {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      items,
    };
  }

  /** Batch-load the linked deals' policy type for badge rendering. */
  private async loadDealTypes(
    records: Array<{ dealId?: Types.ObjectId }>,
  ): Promise<Map<string, DealType>> {
    const dealIds = [
      ...new Set(
        records
          .map((r) => r.dealId?.toString())
          .filter((v): v is string => Boolean(v)),
      ),
    ].map((id) => new Types.ObjectId(id));

    const map = new Map<string, DealType>();
    if (!dealIds.length) {
      return map;
    }

    const deals = await this.dealModel
      .find({ _id: { $in: dealIds } })
      .select('dealType')
      .lean<Array<{ _id: Types.ObjectId; dealType?: DealType }>>();
    for (const deal of deals) {
      map.set(deal._id.toString(), deal.dealType ?? 'Other');
    }
    return map;
  }

  /**
   * Data masking: never expose raw ObjectIds. Produce a stable, human-readable
   * label like `AUD-2026-0042` from the record id + its creation year.
   */
  private maskRef(id: string, createdAt?: Date): string {
    const year = (createdAt ?? new Date()).getUTCFullYear();
    const seq = parseInt(id.slice(-4), 16) % 10000;
    return `AUD-${year}-${seq.toString().padStart(4, '0')}`;
  }
}
