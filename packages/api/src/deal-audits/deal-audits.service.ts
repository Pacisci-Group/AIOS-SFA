import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  AUDIT_REVIEW_OUTCOMES,
  AccessContext,
  DataScope,
  canReviewAudit,
  canSubmitAudit,
  normalizeDealAuditStatus,
} from '@sfa/shared';
import type {
  ActivityType,
  AuditOwnerView,
  AuditReviewDecision,
} from '@sfa/shared';
import { FilterQuery, Model, Types } from 'mongoose';
import {
  Activity,
  ActivityDocument,
} from '../activities/schemas/activity.schema';
import { buildScopeFilter } from '../common/access/scope-filter';
import { daysSince } from '../common/domain/deal-derive';
import { Deal, DealDocument, DealType } from '../deals/schemas/deal.schema';
import {
  DealAuditItem,
  DealAuditItemDocument,
} from '../deal-audit-items/schemas/deal-audit-item.schema';
import {
  AgencyRole,
  AgencyRoleDocument,
} from '../roles/schemas/agency-role.schema';
import { StorageService } from '../storage/storage.service';
import { User, UserDocument } from '../users/schemas/user.schema';
import { completionPercent, syncAuditCounters } from './audit-counters';
import { AddAuditNoteDto } from './dto/add-audit-note.dto';
import { AssignAuditDto, AuditOwnerInput } from './dto/assign-audit.dto';
import { DUE_SOON_DAYS, ListDealAuditsDto } from './dto/list-deal-audits.dto';
import { PresignAttachmentDto } from './dto/presign-attachment.dto';
import { ResolveDealAuditDto } from './dto/resolve-deal-audit.dto';
import { ReviewAuditDto } from './dto/review-audit.dto';
import {
  AuditOwnerRef,
  DealAudit,
  DealAuditDocument,
} from './schemas/deal-audit.schema';
import {
  AuditNoteView,
  AuditWorkflowView,
  DealAuditDealRow,
  DealAuditItemRow,
  DealAuditListResponse,
  PresignAttachmentResponse,
  ResolveDealAuditResponse,
} from './deal-audits.types';

/** Verification status set when a producer resolves an item. */
const RESOLVED_UPDATE_STATUS = 'complete';
const RESOLVED_UPDATE_STATUS_LABEL = 'Verified - Complete';

/** How many thread entries a note read returns. Unpaginated by design. */
const NOTE_PAGE_SIZE = 100;

/** Each review decision's timeline type — the pair that must not be merged. */
const REVIEW_ACTIVITY_TYPES: Record<AuditReviewDecision, ActivityType> = {
  approve: 'audit_approved',
  request_changes: 'audit_changes_requested',
  send_back: 'audit_sent_back',
};

const REVIEW_SUMMARIES: Record<AuditReviewDecision, string> = {
  approve: 'Audit approved',
  request_changes: 'Changes requested on audit',
  send_back: 'Audit sent back to assignee',
};

/**
 * DTO owner → stored owner. `null` clears the slot.
 *
 * The cast to ObjectId happens here rather than in the schema so the DTO can
 * keep validating a plain 24-hex string, which is what a client sends.
 */
function toOwnerRef(owner: AuditOwnerInput | null): AuditOwnerRef | null {
  return owner ? { type: owner.type, id: new Types.ObjectId(owner.id) } : null;
}

/** Lean projection of the item fields a checklist row renders from. */
type DealAuditItemLean = Pick<
  DealAuditItem,
  | 'clientName'
  | 'itemName'
  | 'daysOpen'
  | 'firstCreatedAt'
  | 'dueAt'
  | 'attachments'
  | 'isFailed'
  | 'isResolved'
> & {
  _id: Types.ObjectId;
  dealId?: Types.ObjectId;
  dealAuditId?: Types.ObjectId;
  createdAt?: Date;
};

/** Lean projection of the audit fields a board card renders from. */
type DealAuditLean = Pick<
  DealAudit,
  | 'title'
  | 'auditStatus'
  | 'auditDate'
  | 'itemCount'
  | 'resolvedCount'
  | 'openFailedCount'
  | 'oldestOpenAt'
  | 'dueAt'
> & {
  _id: Types.ObjectId;
  dealId?: Types.ObjectId;
  createdAt?: Date;
};

@Injectable()
export class DealAuditsService {
  private readonly logger = new Logger(DealAuditsService.name);

  constructor(
    /*
     * Class-typed, matching `AuditGenerationService`, the migration and the
     * demo seed. `Model<T>` is invariant in `T`, so `Model<DealAuditItem>` and
     * `Model<DealAuditItemDocument>` are not interchangeable and the shared
     * `syncAuditCounters` has to be handed one spelling consistently.
     * `findOne` still hydrates, so `loadOwnedItem` is unaffected.
     */
    @InjectModel(DealAuditItem.name)
    private dealAuditItemModel: Model<DealAuditItem>,
    @InjectModel(Deal.name) private dealModel: Model<DealDocument>,
    @InjectModel(Activity.name)
    private activityModel: Model<ActivityDocument>,
    // The board's driving collection since PAC-72 — see `DealAudit`'s docblock.
    @InjectModel(DealAudit.name)
    private dealAuditModel: Model<DealAudit>,
    // Both only ever read, and only to turn an owner's ObjectId into a name.
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(AgencyRole.name)
    private roleModel: Model<AgencyRoleDocument>,
    private readonly storage: StorageService,
  ) {}

  /**
   * Deals pending service hand-off — **one card per deal** (PAC-72 section A).
   *
   * Two indexed reads, not an aggregation: page over `dealAudits`, then load
   * the checklists for just the deals on that page with `$in`. The same
   * batch-then-map shape `loadDeals` already uses.
   *
   * ## Why this queries `dealAudits` and not `dealAuditItems`
   *
   * The obvious alternative — group items by `dealId` — cannot work. The data
   * scope clamp lives on the **audit** (`auditAssignee`), so it could only be
   * applied *after* the `$group`, turning every board load into a full agency
   * scan. Denormalizing the assignee onto every item instead would contradict
   * the settled "deal-level *who*, item-level *what*".
   *
   * The cost is that `DealAudit`'s counters must be maintained — see
   * `syncAuditCounters`. That was owed anyway: the completion percentage needs
   * a stored denominator, and sorting deals by their oldest open item is not
   * index-backed without one.
   */
  async listPendingHandoff(
    access: AccessContext,
    branchId: string | null,
    query: ListDealAuditsDto,
  ): Promise<DealAuditListResponse> {
    const { page, pageSize, due } = query;

    const filter: FilterQuery<DealAudit> = {
      ...buildScopeFilter<DealAudit>(access, branchId, {
        // The access key moved off `dealAuditItems.producerId` (PAC-72). The
        // item keeps `producerId` as provenance — who sold it — but the board
        // is scoped to whoever is working the audit.
        ownerField: { path: 'auditAssignee', polymorphic: true },
      }),
      // "Pending hand-off" is exactly "has at least one outstanding item". A
      // deal whose checklist is clear leaves the board regardless of where its
      // audit sits in the review workflow.
      openFailedCount: { $gt: 0 },
      // The soft deadline is a *filter*, never a state change — see `dueAt` on
      // the schema. `all` adds nothing, so the default query is unchanged.
      ...this.dueFilter(due),
    };

    const total = await this.dealAuditModel.countDocuments(filter);

    const audits = await this.dealAuditModel
      .find(filter)
      // Oldest open first; `_id` tiebreaker keeps pagination stable.
      .sort({ oldestOpenAt: 1, _id: 1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean<DealAuditLean[]>();

    const [deals, itemsByAudit] = await Promise.all([
      this.loadDeals(audits),
      this.loadChecklists(access.agencyId, audits),
    ]);

    const items: DealAuditDealRow[] = audits.map((audit) => {
      const id = audit._id.toString();
      const deal = audit.dealId
        ? deals.get(audit.dealId.toString())
        : undefined;
      const checklist = itemsByAudit.get(id) ?? [];

      return {
        id,
        // What the workflow endpoints are keyed on.
        dealId: audit.dealId?.toString() ?? '',
        ref: this.maskRef(id, audit.auditDate ?? audit.createdAt),
        client: deal?.clientName ?? audit.title ?? 'Unknown Client',
        type: deal?.dealType ?? 'Other',
        auditStatus: normalizeDealAuditStatus(audit.auditStatus),
        completionPct: completionPercent({
          itemCount: audit.itemCount ?? 0,
          resolvedCount: audit.resolvedCount ?? 0,
        }),
        itemCount: audit.itemCount ?? 0,
        openCount: audit.openFailedCount ?? 0,
        /*
         * Recomputed on read rather than served from a stored number (PAC-40).
         * `oldestOpenAt` is a real timestamp so the age is always current,
         * unlike the item-level `daysOpen`, which is written once at creation
         * and is only ever right on the day it was written.
         */
        oldestDaysOpen: audit.oldestOpenAt ? daysSince(audit.oldestOpenAt) : 0,
        dueAt: audit.dueAt ? audit.dueAt.toISOString() : null,
        items: checklist,
      };
    });

    return {
      page,
      pageSize,
      // Deals, not items — see `DealAuditListResponse`.
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      items,
    };
  }

  /**
   * The checklists for one page of audits, keyed by audit id.
   *
   * Loads **every** item, not just the outstanding ones: the drawer sorts
   * missing requirements to the top, which needs the settled ones present to
   * sort above. Outstanding first, then oldest first — the order the drawer
   * renders them in, decided here so the client does not re-derive it.
   */
  private async loadChecklists(
    agencyId: string | null,
    audits: Array<{ _id: Types.ObjectId }>,
  ): Promise<Map<string, DealAuditItemRow[]>> {
    const byAudit = new Map<string, DealAuditItemRow[]>();
    if (!audits.length) return byAudit;

    const records = await this.dealAuditItemModel
      .find({
        agencyId,
        dealAuditId: { $in: audits.map((audit) => audit._id) },
      })
      .lean<DealAuditItemLean[]>();

    for (const record of records) {
      const auditId = record.dealAuditId?.toString();
      if (!auditId) continue;

      const openedAt = record.firstCreatedAt ?? record.createdAt;
      const row: DealAuditItemRow = {
        id: record._id.toString(),
        missing: record.itemName ?? 'Missing requirement',
        daysOpen: daysSince(openedAt),
        open: record.isFailed === true && record.isResolved !== true,
        dueAt: record.dueAt ? record.dueAt.toISOString() : null,
        /*
         * The proofs attached at sale time (PAC-56 #21b), finally surfaced
         * (PAC-65 #16). They were written onto the item and read by nobody, so
         * the service team was chasing documents already sitting in storage.
         *
         * Index, filename and size only — never the storage key. See
         * `DealAuditRowAttachment`.
         */
        attachments: (record.attachments ?? []).map((file, index) => ({
          index,
          filename: file.filename,
          contentType: file.contentType,
          size: file.size,
        })),
      };

      const list = byAudit.get(auditId);
      if (list) list.push(row);
      else byAudit.set(auditId, [row]);
    }

    for (const list of byAudit.values()) {
      list.sort(
        (a, b) => Number(b.open) - Number(a.open) || b.daysOpen - a.daysOpen,
      );
    }
    return byAudit;
  }

  /**
   * The `due` query's Mongo clause.
   *
   * ⚠ Both narrowing values require `dueAt` to exist. An item generated before
   * the field was added has no deadline, so it is neither overdue nor due soon
   * — treating a missing date as "overdue" would manufacture a backlog out of
   * the entire pre-PAC-65 history.
   *
   * Now applied to the **audit's** rolled-up `dueAt` — the earliest deadline
   * across its open items — rather than to a single item's. Semantics are
   * unchanged: a deal is overdue when its most pressing requirement is, which
   * is what "pull me the overdue list" has always meant.
   */
  private dueFilter(due: ListDealAuditsDto['due']): FilterQuery<DealAudit> {
    if (due === 'all') return {};
    const now = new Date();
    if (due === 'overdue') return { dueAt: { $lt: now } };
    return {
      dueAt: {
        $gte: now,
        $lte: new Date(now.getTime() + DUE_SOON_DAYS * 24 * 60 * 60 * 1000),
      },
    };
  }

  /**
   * Batch-load the linked deals' client name and policy type for the card
   * header and its badge.
   *
   * The name comes from the deal rather than the audit's `title`, which is
   * whatever the generator had to hand at the time — the deal title if it had
   * one, the client name otherwise. `DealAudit.title` remains the fallback.
   */
  private async loadDeals(
    records: Array<{ dealId?: Types.ObjectId }>,
  ): Promise<Map<string, { dealType: DealType; clientName?: string }>> {
    const dealIds = [
      ...new Set(
        records
          .map((r) => r.dealId?.toString())
          .filter((v): v is string => Boolean(v)),
      ),
    ].map((id) => new Types.ObjectId(id));

    const map = new Map<string, { dealType: DealType; clientName?: string }>();
    if (!dealIds.length) {
      return map;
    }

    const deals = await this.dealModel
      .find({ _id: { $in: dealIds } })
      .select('dealType clientName')
      .lean<
        Array<{
          _id: Types.ObjectId;
          dealType?: DealType;
          clientName?: string;
        }>
      >();
    for (const deal of deals) {
      map.set(deal._id.toString(), {
        dealType: deal.dealType ?? 'Other',
        clientName: deal.clientName,
      });
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

    // If an attachment was declared, confirm this agency and item produced the
    // key, then that the upload actually landed.
    //
    // The ownership check closes a hole flagged during PAC-39 and fixed in
    // PAC-40: `key` comes straight from the client, so without it a caller
    // could name **any** object they knew of — including another agency's — and
    // have it attached to their own record. `presignAttachment` mints keys as
    // `agencies/<agencyId>/deal-audits/<itemId>/…`, so the prefix test is exact.
    if (dto.attachment) {
      this.storage.assertKeyOwnership(dto.attachment.key, {
        agencyId: item.agencyId,
        purpose: `deal-audits/${itemId}`,
      });

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

    /*
     * The parent's roll-up figures (PAC-72). Resolving an item moves the
     * completion percentage and can empty the card off the board entirely, both
     * of which the board reads from `DealAudit`, not from the items.
     *
     * Best-effort and post-commit like the activity below: the item is already
     * resolved, and a stale counter is a cosmetic problem that the next
     * generation run or `reconcileDealAudits` corrects. Skipped for a migrated
     * item with no parent link — nothing to update.
     */
    if (item.dealAuditId) {
      try {
        await syncAuditCounters(
          this.dealAuditItemModel,
          this.dealAuditModel,
          item.agencyId,
          item.dealAuditId,
        );
      } catch (error) {
        this.logger.error(
          `Failed to sync counters for audit ${item.dealAuditId.toString()}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

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
    // Inline, with the original filename and content type (PAC-56 #30): the
    // point of opening a proof document is looking at it, and the default
    // attachment disposition puts it in the downloads folder instead. Sold-form
    // documents are PDF *or* image, and both render natively.
    const downloadUrl = await this.storage.createPresignedDownload(
      attachment.key,
      {
        disposition: 'inline',
        filename: attachment.filename,
        contentType: attachment.contentType,
      },
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

  // --- Workflow: assign → submit → review (PAC-72 section E) ----------------

  /**
   * Set the audit's assignee and/or reviewer.
   *
   * Ownership is per **deal**, not per item: the reviewer works item by item,
   * but "who is on this" and the final verdict belong to the audit as a whole.
   */
  async assign(
    access: AccessContext,
    branchId: string | null,
    dealId: string,
    dto: AssignAuditDto,
  ): Promise<AuditWorkflowView> {
    const audit = await this.loadAuditForDeal(access, branchId, dealId);

    if (dto.assignee !== undefined) {
      audit.auditAssignee = toOwnerRef(dto.assignee);
    }
    if (dto.reviewer !== undefined) {
      audit.auditReviewer = toOwnerRef(dto.reviewer);
    }
    await audit.save();

    await this.recordWorkflowActivity(
      access,
      audit,
      'audit_assigned',
      this.describeAssignment(dto),
    );
    return this.toWorkflowView(audit);
  }

  /**
   * The assignee hands the audit to the reviewer: `→ Pending`.
   *
   * Re-submitting a `Fail` is the correction loop the brief asks for — fix the
   * problem, submit again — so only an audit already sitting with the reviewer
   * is rejected.
   *
   * ⚠ Not restricted to the assignee. An owner or manager acting on their
   * behalf is legitimate and common; `submittedById` records who actually did
   * it, and {@link review} is where the meaningful separation is enforced.
   */
  async submit(
    access: AccessContext,
    branchId: string | null,
    dealId: string,
  ): Promise<AuditWorkflowView> {
    const audit = await this.loadAuditForDeal(access, branchId, dealId);

    if (!canSubmitAudit(audit.auditStatus)) {
      throw new ConflictException('This audit is already awaiting review.');
    }

    audit.auditStatus = 'Pending';
    audit.submittedAt = new Date();
    audit.submittedById = new Types.ObjectId(access.userId);
    await audit.save();
    await this.mirrorStatusToDeal(audit);

    await this.recordWorkflowActivity(
      access,
      audit,
      'audit_submitted',
      'Audit submitted for review',
    );
    return this.toWorkflowView(audit);
  }

  /**
   * The reviewer's verdict: approve → `Pass`, request changes → `Fail`, send
   * back → `Not Submitted`.
   */
  async review(
    access: AccessContext,
    branchId: string | null,
    dealId: string,
    dto: ReviewAuditDto,
  ): Promise<AuditWorkflowView> {
    const audit = await this.loadAuditForDeal(access, branchId, dealId);

    if (!canReviewAudit(audit.auditStatus)) {
      throw new ConflictException(
        'Only an audit awaiting review can be reviewed.',
      );
    }

    /*
     * 🔴 The one rule that makes the two roles mean anything.
     *
     * Both submitting and reviewing are `deal_audits:write`, and the Producer
     * template holds it — so without this the producer who gathered the
     * evidence can approve their own work, which is exactly the gap section B
     * item 6 exists to close. Nothing else in the guard chain expresses
     * "a different person".
     */
    if (audit.submittedById?.toString() === access.userId) {
      throw new ForbiddenException(
        'An audit must be reviewed by someone other than the person who submitted it.',
      );
    }

    const decided = AUDIT_REVIEW_OUTCOMES[dto.decision];
    audit.auditStatus = decided;
    audit.reviewedAt = new Date();
    audit.reviewedById = new Types.ObjectId(access.userId);
    // Cleared on anything but a failure: stale codes on a passed audit would
    // read as "passed, but here's what was wrong with it".
    audit.reasonCodes = decided === 'Fail' ? (dto.reasonCodes ?? []) : [];
    if (dto.notes !== undefined) {
      audit.auditNotes = dto.notes;
    }
    if (dto.score !== undefined) {
      audit.auditScore = dto.score;
    }
    await audit.save();
    await this.mirrorStatusToDeal(audit);

    await this.recordWorkflowActivity(
      access,
      audit,
      REVIEW_ACTIVITY_TYPES[dto.decision],
      REVIEW_SUMMARIES[dto.decision],
    );
    return this.toWorkflowView(audit);
  }

  /** Read the audit's note + workflow thread, newest first. */
  async listNotes(
    access: AccessContext,
    branchId: string | null,
    dealId: string,
  ): Promise<AuditNoteView[]> {
    const audit = await this.loadAuditForDeal(access, branchId, dealId);

    const rows = await this.activityModel
      .find({ agencyId: audit.agencyId, dealAuditId: audit._id })
      .sort({ occurredAt: -1, _id: -1 })
      .limit(NOTE_PAGE_SIZE)
      .lean<
        Array<{
          _id: Types.ObjectId;
          type: ActivityType;
          summary?: string;
          occurredAt?: Date;
          createdAt?: Date;
          userId?: Types.ObjectId;
        }>
      >();

    const names = await this.resolveUserNames(
      rows.map((row) => row.userId).filter((id): id is Types.ObjectId => !!id),
    );

    return rows.map((row) => ({
      id: row._id.toString(),
      type: row.type,
      summary: row.summary ?? null,
      occurredAt: (row.occurredAt ?? row.createdAt ?? new Date()).toISOString(),
      userName: row.userId ? (names.get(row.userId.toString()) ?? '') : '',
    }));
  }

  /** Leave a free-text note on the audit. */
  async addNote(
    access: AccessContext,
    branchId: string | null,
    dealId: string,
    dto: AddAuditNoteDto,
  ): Promise<AuditNoteView> {
    const audit = await this.loadAuditForDeal(access, branchId, dealId);
    const occurredAt = new Date();

    const activity = await this.activityModel.create({
      agencyId: audit.agencyId,
      branchId: audit.branchId,
      type: 'note',
      subjectType: 'dealAudit',
      dealAuditId: audit._id,
      dealId: audit.dealId,
      userId: new Types.ObjectId(access.userId),
      occurredAt,
      summary: dto.body,
      // Explicit: the schema default is `'migration'`, which would label an
      // app write as imported data. Same trap as every other activity writer.
      source: 'internal',
      isTestRecord: false,
    });

    const names = await this.resolveUserNames([
      new Types.ObjectId(access.userId),
    ]);
    return {
      id: activity._id.toString(),
      type: 'note',
      summary: dto.body,
      occurredAt: occurredAt.toISOString(),
      userName: names.get(access.userId) ?? '',
    };
  }

  /**
   * Load a deal's audit within the caller's reach.
   *
   * ⚠ **Not `buildScopeFilter`'s `ownerField` clamp**, deliberately. That pins
   * to the *assignee*, which is right for the board — but a reviewer is not the
   * assignee, so using it here would 404 the very person the review endpoint
   * exists for. Access to a specific audit is "assignee **or** reviewer", which
   * is a different question from "whose board does this appear on".
   *
   * 404 rather than 403 throughout, matching `LeadAccessService.loadOwnedLead`:
   * whether another team's audit exists is not the caller's business.
   */
  private async loadAuditForDeal(
    access: AccessContext,
    branchId: string | null,
    dealId: string,
  ): Promise<DealAuditDocument> {
    if (!Types.ObjectId.isValid(dealId)) {
      throw new NotFoundException('Audit not found.');
    }

    const audit = await this.dealAuditModel.findOne({
      agencyId: access.agencyId,
      dealId: new Types.ObjectId(dealId),
    });
    if (!audit) {
      throw new NotFoundException('Audit not found.');
    }

    if (access.dataScope === DataScope.Own && !this.ownsAudit(audit, access)) {
      throw new NotFoundException('Audit not found.');
    }
    if (
      access.dataScope === DataScope.Branch &&
      branchId &&
      audit.branchId !== branchId
    ) {
      throw new NotFoundException('Audit not found.');
    }
    return audit;
  }

  /**
   * Is the caller on this audit, as either owner?
   *
   * Compares against their user id *and* their role ids, because either slot
   * may hold a role — which is why `AccessContext.roleIds` exists and why the
   * stored `id` is always an ObjectId regardless of which kind it is.
   */
  private ownsAudit(audit: DealAuditDocument, access: AccessContext): boolean {
    const mine = new Set<string>([access.userId, ...access.roleIds]);
    return [audit.auditAssignee, audit.auditReviewer].some(
      (owner) => !!owner && mine.has(owner.id.toString()),
    );
  }

  /**
   * Keep `Deal.dealAuditStatus` in step with the authoritative value.
   *
   * Best-effort: the audit's own transition is already committed, and failing
   * the request over a denormalized display copy would fail in the wrong
   * direction.
   */
  private async mirrorStatusToDeal(audit: DealAuditDocument): Promise<void> {
    if (!audit.dealId) return;
    try {
      await this.dealModel.updateOne(
        { _id: audit.dealId },
        { $set: { dealAuditStatus: audit.auditStatus } },
      );
    } catch (error) {
      this.logger.error(
        `Failed to mirror audit status onto deal ${audit.dealId.toString()}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /** The workflow response shape, with both owners resolved to display names. */
  private async toWorkflowView(
    audit: DealAuditDocument,
  ): Promise<AuditWorkflowView> {
    const [assignee, reviewer] = await Promise.all([
      this.resolveOwner(audit.agencyId, audit.auditAssignee),
      this.resolveOwner(audit.agencyId, audit.auditReviewer),
    ]);

    return {
      id: audit._id.toString(),
      dealId: audit.dealId?.toString() ?? '',
      auditStatus: audit.auditStatus,
      assignee,
      reviewer,
      submittedAt: audit.submittedAt?.toISOString() ?? null,
      reviewedAt: audit.reviewedAt?.toISOString() ?? null,
      reasonCodes: audit.reasonCodes ?? [],
      auditScore: audit.auditScore ?? 0,
      auditNotes: audit.auditNotes ?? null,
      itemCount: audit.itemCount ?? 0,
      resolvedCount: audit.resolvedCount ?? 0,
      openCount: audit.openFailedCount ?? 0,
      completionPct: completionPercent({
        itemCount: audit.itemCount ?? 0,
        resolvedCount: audit.resolvedCount ?? 0,
      }),
    };
  }

  /**
   * `{ type, id }` → `{ type, id, name }`.
   *
   * The name is looked up rather than stored, so renaming a user or a role does
   * not leave every audit they own displaying the old one.
   */
  private async resolveOwner(
    agencyId: string,
    owner?: AuditOwnerRef | null,
  ): Promise<AuditOwnerView | null> {
    if (!owner) return null;

    if (owner.type === 'role') {
      const role = await this.roleModel
        .findById(owner.id)
        .select('name')
        .lean<{ name?: string }>();
      return {
        type: 'role',
        id: owner.id.toString(),
        name: role?.name ?? 'Unknown role',
      };
    }

    const names = await this.resolveUserNames([owner.id]);
    return {
      type: 'user',
      id: owner.id.toString(),
      name: names.get(owner.id.toString()) ?? 'Unknown user',
      // `agencyId` is not used to narrow the lookup: both users and roles are
      // already agency-scoped by the id itself, and a cross-agency id could
      // only arrive from a caller who passed our tenancy clamp to begin with.
    };
  }

  /** Batch `userId -> display name`. */
  private async resolveUserNames(
    userIds: Types.ObjectId[],
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    const unique = [...new Set(userIds.map((id) => id.toString()))];
    if (!unique.length) return map;

    const users = await this.userModel
      .find({ _id: { $in: unique.map((id) => new Types.ObjectId(id)) } })
      .select('firstName lastName')
      .lean<
        Array<{
          _id: Types.ObjectId;
          firstName?: string;
          lastName?: string;
        }>
      >();
    for (const user of users) {
      map.set(
        user._id.toString(),
        [user.firstName, user.lastName].filter(Boolean).join(' ').trim(),
      );
    }
    return map;
  }

  /** Human-readable summary of what an assignment call changed. */
  private describeAssignment(dto: AssignAuditDto): string {
    const parts: string[] = [];
    if (dto.assignee !== undefined) {
      parts.push(dto.assignee ? 'Assignee updated' : 'Assignee cleared');
    }
    if (dto.reviewer !== undefined) {
      parts.push(dto.reviewer ? 'Reviewer updated' : 'Reviewer cleared');
    }
    return parts.join(' · ') || 'Audit assignment updated';
  }

  /**
   * Append a workflow event to the audit's thread.
   *
   * Best-effort, like `recordResolveActivity`: the transition is already
   * committed, so a failed timeline write must not report the whole operation
   * as failed.
   */
  private async recordWorkflowActivity(
    access: AccessContext,
    audit: DealAuditDocument,
    type: ActivityType,
    summary: string,
  ): Promise<void> {
    try {
      await this.activityModel.create({
        agencyId: audit.agencyId,
        branchId: audit.branchId,
        type,
        subjectType: 'dealAudit',
        dealAuditId: audit._id,
        dealId: audit.dealId,
        userId: new Types.ObjectId(access.userId),
        occurredAt: new Date(),
        summary,
        source: 'internal',
      });
    } catch (error) {
      this.logger.error(
        `Failed to record ${type} activity for audit ${audit._id.toString()}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
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
      userId: new Types.ObjectId(access.userId),
      occurredAt: resolvedAt,
      summary: `Resolved audit item "${
        item.itemName ?? 'requirement'
      }" for ${item.clientName ?? 'client'}`,
      // Was `'app'` — the lone dissenter among five writers, corrected with the
      // PAC-65 rename. `source` is only ever read as "is this migrated data",
      // so the stray value was harmless, but it made the field look like it
      // carried more meaning than it does.
      source: 'internal',
    });
  }
}
