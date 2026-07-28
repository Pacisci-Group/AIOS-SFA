import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { AccessContext, DataScope } from '@sfa/shared';
import { FilterQuery, Model, Types } from 'mongoose';
import {
  Activity,
  ActivityDocument,
} from '../activities/schemas/activity.schema';
import { Deal, DealDocument, DealType } from '../deals/schemas/deal.schema';
import {
  DealAuditItem,
  DealAuditItemDocument,
} from '../deal-audit-items/schemas/deal-audit-item.schema';
import { StorageService } from '../storage/storage.service';
import { ListDealAuditsDto } from './dto/list-deal-audits.dto';
import { PresignAttachmentDto } from './dto/presign-attachment.dto';
import { ResolveDealAuditDto } from './dto/resolve-deal-audit.dto';
import {
  DealAuditListResponse,
  DealAuditRow,
  PresignAttachmentResponse,
  ResolveDealAuditResponse,
} from './deal-audits.types';

/** Verification status set when a producer resolves an item. */
const RESOLVED_UPDATE_STATUS = 'complete';
const RESOLVED_UPDATE_STATUS_LABEL = 'Verified - Complete';

/** Lean projection of the fields the board reads (incl. timestamp). */
type DealAuditItemLean = Pick<
  DealAuditItem,
  'clientName' | 'itemName' | 'daysOpen' | 'firstCreatedAt'
> & {
  _id: Types.ObjectId;
  dealId?: Types.ObjectId;
  createdAt?: Date;
};

@Injectable()
export class DealAuditsService {
  private readonly logger = new Logger(DealAuditsService.name);

  constructor(
    @InjectModel(DealAuditItem.name)
    private dealAuditItemModel: Model<DealAuditItemDocument>,
    @InjectModel(Deal.name) private dealModel: Model<DealDocument>,
    @InjectModel(Activity.name)
    private activityModel: Model<ActivityDocument>,
    private readonly storage: StorageService,
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

    const filter: FilterQuery<DealAuditItemDocument> = {
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

    const total = await this.dealAuditItemModel.countDocuments(filter);

    const records = await this.dealAuditItemModel
      .find(filter)
      // Oldest open first; `_id` tiebreaker keeps pagination stable.
      .sort({ daysOpen: -1, _id: 1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean<DealAuditItemLean[]>();

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

  /**
   * Issue a presigned upload URL for a resolution document. The caller must own
   * the item (enforced by {@link loadOwnedItem}); the key is server-generated and
   * agency-namespaced so a producer can only ever write under their own agency.
   */
  async presignAttachment(
    access: AccessContext,
    branchId: string | null,
    itemId: string,
    dto: PresignAttachmentDto,
  ): Promise<PresignAttachmentResponse> {
    const item = await this.loadOwnedItem(access, branchId, itemId);

    const key = this.storage.buildObjectKey({
      agencyId: item.agencyId,
      purpose: `deal-audits/${itemId}`,
      filename: dto.filename,
    });
    const presigned = await this.storage.createPresignedUpload(
      key,
      dto.contentType,
    );
    return {
      key: presigned.key,
      uploadUrl: presigned.uploadUrl,
      requiredHeaders: presigned.requiredHeaders,
      expiresIn: presigned.expiresIn,
    };
  }

  /**
   * Resolve (verify) an audit item: marks it complete so it drops off the
   * pending hand-off board, records the optional note/document, and writes an
   * audit-trail activity. Enforces `deal_audits:write` + `DataScope.own`.
   */
  async resolveItem(
    access: AccessContext,
    branchId: string | null,
    itemId: string,
    dto: ResolveDealAuditDto,
  ): Promise<ResolveDealAuditResponse> {
    const item = await this.loadOwnedItem(access, branchId, itemId);

    // Resolving is one-shot: the item leaves the board once it's done. Replaying
    // the request (stale tab, client retry) must not append the attachment or
    // move `resolvedAt` a second time.
    if (item.isResolved) {
      return {
        id: item._id.toString(),
        resolved: true,
        resolvedAt: (item.resolvedAt ?? new Date()).toISOString(),
      };
    }

    // If an attachment was declared, confirm the upload actually landed.
    if (dto.attachment) {
      const exists = await this.storage.objectExists(dto.attachment.key);
      if (!exists) {
        throw new NotFoundException(
          'Uploaded document was not found in storage.',
        );
      }
    }

    const resolvedAt = new Date();
    item.updateStatus = RESOLVED_UPDATE_STATUS;
    item.updateStatusLabel = RESOLVED_UPDATE_STATUS_LABEL;
    item.isResolved = true;
    item.resolvedAt = resolvedAt;
    item.resolvedById = new Types.ObjectId(access.userId);
    if (dto.note) {
      item.notes = dto.note;
    }
    if (dto.attachment) {
      item.attachments.push({
        key: dto.attachment.key,
        filename: dto.attachment.filename,
        contentType: dto.attachment.contentType,
        size: dto.attachment.size,
        uploadedAt: resolvedAt,
      });
    }
    await item.save();

    // Best-effort audit trail: the resolution is already committed, so a failure
    // to write the timeline entry must not report the whole operation as failed.
    try {
      await this.recordResolveActivity(access, item, resolvedAt);
    } catch (error) {
      this.logger.error(
        `Failed to record audit_resolved activity for item ${item._id.toString()}`,
        error instanceof Error ? error.stack : String(error),
      );
    }

    return {
      id: item._id.toString(),
      resolved: true,
      resolvedAt: resolvedAt.toISOString(),
    };
  }

  /** Presigned GET URL to view/download a stored resolution document. */
  async getAttachmentDownloadUrl(
    access: AccessContext,
    branchId: string | null,
    itemId: string,
    index: number,
  ): Promise<{ downloadUrl: string }> {
    const item = await this.loadOwnedItem(access, branchId, itemId);
    const attachment = item.attachments?.[index];
    if (!attachment) {
      throw new NotFoundException('Attachment not found.');
    }
    const downloadUrl = await this.storage.createPresignedDownload(
      attachment.key,
    );
    return { downloadUrl };
  }

  /**
   * Load an audit item by id within the caller's agency and enforce data scope:
   * `own` requires the item's producer to be the caller; `branch` requires the
   * item's branch to match. Throws 404 if missing, 403 on scope violation.
   */
  private async loadOwnedItem(
    access: AccessContext,
    branchId: string | null,
    itemId: string,
  ): Promise<DealAuditItemDocument> {
    if (!Types.ObjectId.isValid(itemId)) {
      throw new NotFoundException('Audit item not found.');
    }
    const item = await this.dealAuditItemModel.findOne({
      _id: new Types.ObjectId(itemId),
      agencyId: access.agencyId,
    });
    if (!item) {
      throw new NotFoundException('Audit item not found.');
    }

    if (access.dataScope === DataScope.Own) {
      if (item.producerId?.toString() !== access.userId) {
        throw new ForbiddenException(
          'You can only resolve your own audit items.',
        );
      }
    } else if (access.dataScope === DataScope.Branch && branchId) {
      if (item.branchId !== branchId) {
        throw new ForbiddenException(
          'You can only resolve audit items in your branch.',
        );
      }
    }
    return item;
  }

  /** Write an `audit_resolved` activity so the timeline records who/when. */
  private async recordResolveActivity(
    access: AccessContext,
    item: DealAuditItemDocument,
    resolvedAt: Date,
  ): Promise<void> {
    await this.activityModel.create({
      agencyId: item.agencyId,
      branchId: item.branchId,
      type: 'audit_resolved',
      subjectType: 'dealAuditItem',
      dealId: item.dealId,
      producerId: new Types.ObjectId(access.userId),
      occurredAt: resolvedAt,
      summary: `Resolved audit item "${
        item.itemName ?? 'requirement'
      }" for ${item.clientName ?? 'client'}`,
      source: 'app',
    });
  }
}
