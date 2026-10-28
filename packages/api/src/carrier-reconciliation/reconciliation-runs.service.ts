import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  MAX_RECONCILIATION_FILE_BYTES,
  MAX_RECONCILIATION_ROWS,
  RECONCILIATION_DUPLICATE_FILE,
  RECONCILIATION_ISSUE_LABELS,
  RECONCILIATION_NO_APPOINTMENT,
  RECONCILIATION_RESOLUTION_LABELS,
  RECONCILIATION_REVIEW_STATUS_LABELS,
  RECONCILIATION_TAB_LABELS,
  RECONCILIATION_TABS,
  RECONCILIATION_UNREADABLE_FILE,
  RECONCILIATION_WRONG_AGENCY,
  type AccessContext,
  type DataExportColumnDescriptor,
  type ReclassifyRunResponse,
  type ReconciliationOptionsResponse,
  type ReconciliationPresignResponse,
  type ReconciliationRowListResponse,
  type ReconciliationRowView,
  type ReconciliationRunDetail,
  type ReconciliationRunListResponse,
  type ReconciliationTab,
} from '@sfa/shared';
import { createHash } from 'crypto';
import type { Response } from 'express';
import { Types, type FilterQuery, type Model } from 'mongoose';
import type { Readable } from 'stream';
import {
  Carrier,
  type CarrierDocument,
} from '../carriers/schemas/carrier.schema';
import { clientAgencyId } from '../common/access/client-scope';
import {
  carriedReview,
  type PreviousRowReview,
} from '../common/carrier-reconciliation/carry-forward';
import {
  DashFileError,
  parseDashWorkbook,
  type DashFile,
} from '../common/carrier-reconciliation/dash-file-reader';
import {
  agentNumberMatches,
  loadAppPolicies,
  loadStaffCodes,
  resolveAllstate,
  type ReconciliationModels,
} from '../common/carrier-reconciliation/load-inputs';
import { ProducerCodeIndex } from '../common/carrier-reconciliation/producer-code-index';
import {
  deriveRow,
  matchRows,
  summarize,
  type RowBase,
  type ReportWindow,
} from '../common/carrier-reconciliation/reconcile';
import {
  RECONCILIATION_CONTENT_TYPE,
  RECONCILIATION_PURPOSE,
} from '../common/carrier-reconciliation/reconciliation-file-types';
import { createExportWriter } from '../common/data-export/writers/export-writer';
import { displayName, displayNamesFor } from '../common/domain/user-names';
import { isDuplicateKeyError } from '../common/mongo/duplicate-key';
import { escapeRegex } from '../common/mongo/escape-regex';
import { Deal, type DealDocument } from '../deals/schemas/deal.schema';
import { Agency, type AgencyDocument } from '../platform/schemas/agency.schema';
import { Policy, type PolicyDocument } from '../policies/schemas/policy.schema';
import { StorageService } from '../storage/storage.service';
import { User, type UserDocument } from '../users/schemas/user.schema';
import type {
  ExportQueryDto,
  CreateRunDto,
  ListRunsDto,
  PresignRunDto,
  ReviewRowDto,
  RowsQueryDto,
} from './dto/carrier-reconciliation.dto';
import {
  isStale,
  rowUserIds,
  STALE_RUN_MINUTES,
  toProducerSummary,
  toRowView,
  toRunView,
  type LeanRow,
  type LeanRun,
} from './reconciliation-views';
import {
  ReconciliationRow,
  type ReconciliationRowDocument,
  type StoredReview,
} from './schemas/reconciliation-row.schema';
import {
  ReconciliationRun,
  type ReconciliationRunDocument,
} from './schemas/reconciliation-run.schema';

const INSERT_CHUNK = 1000;

/** What "download exceptions" means: every tab that asks someone to act. */
const EXCEPTION_TABS: ReconciliationTab[] = [
  'missing_from_app',
  'not_in_dash',
  'review_1800',
  'producer_mismatch',
];

/**
 * Dash reconciliation runs: upload, process, read, review, export.
 *
 * Processing happens **inside the upload request**. A month's report is a few
 * hundred lines and the work is four batched reads and one insert, so a job
 * queue would add a polling page and a failure mode for nothing; the row cap
 * bounds the worst case. The engine lives in `common/carrier-reconciliation/`
 * behind a models bag, so moving this into a worker job later is a lift, not
 * a rewrite.
 */
@Injectable()
export class ReconciliationRunsService {
  private readonly logger = new Logger(ReconciliationRunsService.name);

  constructor(
    @InjectModel(ReconciliationRun.name)
    private readonly runModel: Model<ReconciliationRunDocument>,
    @InjectModel(ReconciliationRow.name)
    private readonly rowModel: Model<ReconciliationRowDocument>,
    @InjectModel(Deal.name)
    private readonly dealModel: Model<DealDocument>,
    @InjectModel(Policy.name)
    private readonly policyModel: Model<PolicyDocument>,
    @InjectModel(Agency.name)
    private readonly agencyModel: Model<AgencyDocument>,
    @InjectModel(Carrier.name)
    private readonly carrierModel: Model<CarrierDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly storage: StorageService,
  ) {}

  private get models(): ReconciliationModels {
    return {
      deal: this.dealModel,
      policy: this.policyModel,
      agency: this.agencyModel,
      carrier: this.carrierModel,
      user: this.userModel,
    };
  }

  // -------------------------------------------------------------------------
  // Upload
  // -------------------------------------------------------------------------

  async presign(
    access: AccessContext,
    dto: PresignRunDto,
  ): Promise<ReconciliationPresignResponse> {
    const key = this.storage.buildObjectKey({
      agencyId: clientAgencyId(access),
      purpose: RECONCILIATION_PURPOSE,
      filename: dto.filename,
    });
    return this.storage.createPresignedUpload(key, RECONCILIATION_CONTENT_TYPE);
  }

  /**
   * Reconcile an uploaded report. The bytes went straight from the browser to
   * storage, so everything about them is checked here: the key is this
   * agency's, the object exists, its size is what was declared and under the
   * cap, it parses as a Dash report, and the report is this agency's.
   */
  async create(
    access: AccessContext,
    dto: CreateRunDto,
  ): Promise<ReconciliationRunDetail> {
    const agencyId = clientAgencyId(access);
    this.storage.assertKeyOwnership(dto.storageKey, {
      agencyId,
      purpose: RECONCILIATION_PURPOSE,
    });
    const stat = await this.storage.statObject(dto.storageKey);
    if (!stat) {
      throw new BadRequestException(
        `"${dto.uploadedFilename}" was not found in storage. Please upload it again.`,
      );
    }
    if (stat.size === 0) {
      throw new BadRequestException(`"${dto.uploadedFilename}" is empty.`);
    }
    if (stat.size !== dto.size) {
      throw new BadRequestException(
        `"${dto.uploadedFilename}" is ${stat.size} bytes, not the ${dto.size} declared. Please upload it again.`,
      );
    }
    if (stat.size > MAX_RECONCILIATION_FILE_BYTES) {
      throw new PayloadTooLargeException(
        `"${dto.uploadedFilename}" is larger than ${MAX_RECONCILIATION_FILE_BYTES / 1024 / 1024} MB.`,
      );
    }

    try {
      return await this.reconcileUpload(access, agencyId, dto, stat.size);
    } catch (error) {
      // A refused or failed upload leaves nothing worth keeping. Safe: the
      // key passed the ownership check above, so it is this agency's object.
      await this.storage.deleteObject(dto.storageKey).catch(() => undefined);
      throw error;
    }
  }

  private async reconcileUpload(
    access: AccessContext,
    agencyId: string,
    dto: CreateRunDto,
    size: number,
  ): Promise<ReconciliationRunDetail> {
    const bytes = await readAll(
      await this.storage.getObjectStream(dto.storageKey),
    );
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const file = parseOrRefuse(bytes);

    const allstate = await resolveAllstate(this.models, agencyId);
    if (!allstate?.agencyCodes.length) {
      throw new UnprocessableEntityException({
        code: RECONCILIATION_NO_APPOINTMENT,
        message:
          'The agency has no Allstate agent code on file. Add it under Settings → Carrier appointments, then upload the report again.',
      });
    }
    const agentNumber =
      file.meta.agentNumber ??
      mostCommon(file.rows.map((row) => row.agentNumber));
    if (agentNumber && !agentNumberMatches(agentNumber, allstate.agencyCodes)) {
      throw new UnprocessableEntityException({
        code: RECONCILIATION_WRONG_AGENCY,
        message: `This report is for Allstate agent ${agentNumber}, which is not one of this agency's agent codes (${allstate.agencyCodes.join(', ')}).`,
      });
    }
    const window = reportWindow(file);
    if (!window) {
      throw new UnprocessableEntityException({
        code: RECONCILIATION_UNREADABLE_FILE,
        message:
          'The report has no period and no issue dates to reconcile against.',
      });
    }

    await this.releaseHash(agencyId, sha256);
    const startedAt = new Date();
    let run: ReconciliationRunDocument;
    try {
      run = await this.runModel.create({
        agencyId,
        carrierId: allstate.carrierId,
        status: 'processing',
        file: {
          storageKey: dto.storageKey,
          filename: dto.uploadedFilename,
          size,
        },
        fileSha256: sha256,
        fileMeta: { ...file.meta, agentNumber, rowCount: file.rows.length },
        window,
        warnings: agentNumber
          ? file.warnings
          : [
              ...file.warnings,
              "The report names no Allstate agent number, so it could not be checked against the agency's agent code.",
            ],
        startedAt,
        createdBy: new Types.ObjectId(access.userId),
      });
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      const existing = await this.runModel
        .findOne({ agencyId, fileSha256: sha256 }, { _id: 1, createdAt: 1 })
        .lean<{ _id: Types.ObjectId; createdAt?: Date }>();
      throw new ConflictException({
        code: RECONCILIATION_DUPLICATE_FILE,
        message: 'This exact file has already been reconciled.',
        runId: existing ? String(existing._id) : null,
      });
    }

    try {
      await this.process(run, file, access.timeZone);
    } catch (error) {
      this.logger.error(
        `Reconciliation run ${String(run._id)} failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
      await this.rowModel.deleteMany({ agencyId, runId: run._id });
      await this.runModel.updateOne(
        { _id: run._id },
        {
          $set: {
            status: 'failed',
            error: 'Reconciling the report failed. Try the upload again.',
            fileSha256: null,
            finishedAt: new Date(),
          },
        },
      );
      throw error;
    }
    return this.detail(access, String(run._id));
  }

  /**
   * The work behind {@link create}: load the app side, match, classify, carry
   * reviews forward from the run this one supersedes, and store it all.
   */
  private async process(
    run: ReconciliationRunDocument,
    file: DashFile,
    timeZone: string,
  ): Promise<void> {
    const agencyId = run.agencyId;
    const window = run.window!;
    const [codes, appPolicies] = await Promise.all([
      loadStaffCodes(this.models, agencyId),
      loadAppPolicies(this.models, {
        agencyId,
        timeZone,
        window,
        dashKeys: new Set(
          file.rows.map((row) => row.policyKey).filter(Boolean),
        ),
      }),
    ]);
    const index = new ProducerCodeIndex(codes);
    const bases = matchRows({ dashRows: file.rows, appPolicies, window });

    const previous = await this.runModel
      .findOne({
        agencyId,
        _id: { $ne: run._id },
        status: 'ready',
        supersededByRunId: null,
        'fileMeta.agentNumber': run.fileMeta.agentNumber,
        'window.from': window.from,
        'window.to': window.to,
      })
      .sort({ createdAt: -1 })
      .lean<LeanRun>();
    const previousReviews = previous
      ? await this.previousReviews(agencyId, previous._id)
      : new Map<string, PreviousRowReview>();

    const ids = new Map(
      bases.map((base) => [base.rowKey, new Types.ObjectId()]),
    );
    const rows = bases.map((base) => {
      const derived = deriveRow(base, index);
      const carried = carriedReview(
        { rowKey: base.rowKey, match: base.match, issues: derived.issues },
        previousReviews,
      );
      return {
        _id: ids.get(base.rowKey)!,
        agencyId,
        runId: run._id,
        rowKey: base.rowKey,
        side: base.side,
        match: base.match,
        isSale: base.isSale,
        ignoredReason: base.ignoredReason,
        dash: base.dash,
        app: base.app,
        matchIssues: base.matchIssues,
        suggestions: base.suggestions.map(({ rowKey, ...rest }) => ({
          ...rest,
          rowId: rowKey ? (ids.get(rowKey)?.toString() ?? null) : null,
        })),
        ...derived,
        review: carried
          ? ({
              status: carried.status,
              resolution: carried.resolution,
              note: carried.note,
              reviewedById: carried.reviewedById,
              reviewedAt: carried.reviewedAt,
              carriedForwardFromRowId: carried.rowId,
            } satisfies StoredReview)
          : openReview(),
        searchText: searchText(base),
      };
    });

    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      await this.rowModel.insertMany(rows.slice(i, i + INSERT_CHUNK), {
        ordered: false,
      });
    }

    const { totals, byProducer } = summarize(rows);
    const finishedAt = new Date();
    await this.runModel.updateOne(
      { _id: run._id },
      {
        $set: {
          status: 'ready',
          totals,
          byProducer,
          supersedesRunId: previous?._id ?? null,
          finishedAt,
          durationMs:
            finishedAt.getTime() - (run.startedAt ?? finishedAt).getTime(),
        },
      },
    );
    if (previous) {
      await this.runModel.updateOne(
        { _id: previous._id, supersededByRunId: null },
        { $set: { supersededByRunId: run._id } },
      );
    }
  }

  private async previousReviews(
    agencyId: string,
    runId: Types.ObjectId,
  ): Promise<Map<string, PreviousRowReview>> {
    const rows = await this.rowModel
      .find(
        { agencyId, runId, 'review.status': { $ne: 'open' } },
        { rowKey: 1, match: 1, issues: 1, review: 1 },
      )
      .lean<
        Pick<LeanRow, '_id' | 'rowKey' | 'match' | 'issues' | 'review'>[]
      >();
    return new Map(
      rows.map((row) => [
        row.rowKey,
        {
          rowId: String(row._id),
          match: row.match,
          issues: row.issues,
          status: row.review.status,
          resolution: row.review.resolution,
          note: row.review.note,
          reviewedById: row.review.reviewedById,
          reviewedAt: row.review.reviewedAt,
        },
      ]),
    );
  }

  /**
   * Free a file hash held by a run that will never finish, so the same file
   * can be uploaded again: one that failed, or one whose request died.
   */
  private async releaseHash(agencyId: string, sha256: string): Promise<void> {
    await this.runModel.updateMany(
      { agencyId, fileSha256: sha256, status: 'failed' },
      { $set: { fileSha256: null } },
    );
    await this.runModel.updateMany(
      {
        agencyId,
        fileSha256: sha256,
        status: 'processing',
        startedAt: { $lt: new Date(Date.now() - STALE_RUN_MINUTES * 60_000) },
      },
      {
        $set: {
          status: 'failed',
          error: 'Processing was interrupted.',
          fileSha256: null,
        },
      },
    );
  }

  // -------------------------------------------------------------------------
  // Read
  // -------------------------------------------------------------------------

  async list(
    access: AccessContext,
    query: ListRunsDto,
  ): Promise<ReconciliationRunListResponse> {
    const agencyId = clientAgencyId(access);
    const filter: FilterQuery<ReconciliationRun> = { agencyId };
    if (!query.includeSuperseded) filter.supersededByRunId = null;
    const [runs, total] = await Promise.all([
      this.runModel
        .find(filter, { byProducer: 0 })
        .sort({ createdAt: -1, _id: -1 })
        .skip((query.page - 1) * query.pageSize)
        .limit(query.pageSize)
        .lean<LeanRun[]>(),
      this.runModel.countDocuments(filter),
    ]);
    const open = await this.openCounts(
      agencyId,
      runs.map((run) => run._id),
    );
    const names = await displayNamesFor(
      this.userModel,
      runs.flatMap((run) => (run.createdBy ? [String(run.createdBy)] : [])),
    );
    return {
      items: runs.map((run) =>
        toRunView(run, open.get(String(run._id)) ?? 0, names),
      ),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  async detail(
    access: AccessContext,
    runId: string,
  ): Promise<ReconciliationRunDetail> {
    const agencyId = clientAgencyId(access);
    const run = await this.loadRun(agencyId, runId);
    const [tabCounts, open] = await Promise.all([
      this.tabCounts(agencyId, run._id),
      this.openCounts(agencyId, [run._id]),
    ]);
    const names = await displayNamesFor(this.userModel, [
      ...(run.createdBy ? [String(run.createdBy)] : []),
      ...run.byProducer.flatMap((entry) =>
        entry.userId ? [entry.userId] : [],
      ),
    ]);
    return {
      ...toRunView(run, open.get(String(run._id)) ?? 0, names),
      byProducer: run.byProducer.map((entry) =>
        toProducerSummary(entry, names),
      ),
      tabCounts,
      warnings: run.warnings ?? [],
    };
  }

  async rows(
    access: AccessContext,
    runId: string,
    query: RowsQueryDto,
  ): Promise<ReconciliationRowListResponse> {
    const agencyId = clientAgencyId(access);
    const run = await this.loadRun(agencyId, runId);
    const filter: FilterQuery<ReconciliationRow> = { agencyId, runId: run._id };
    if (query.tab) filter.tabs = query.tab;
    if (query.producer)
      filter.producerKey = normalizeProducerKey(query.producer);
    if (query.reviewStatus) {
      filter.needsReview = true;
      filter['review.status'] = query.reviewStatus;
    }
    if (query.q) {
      filter.searchText = {
        $regex: escapeRegex(query.q.toLowerCase()),
      };
    }
    const [rows, total] = await Promise.all([
      this.rowModel
        .find(filter)
        .sort({ _id: 1 })
        .skip((query.page - 1) * query.pageSize)
        .limit(query.pageSize)
        .lean<LeanRow[]>(),
      this.rowModel.countDocuments(filter),
    ]);
    return {
      items: await this.toRowViews(rows),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  // -------------------------------------------------------------------------
  // Review
  // -------------------------------------------------------------------------

  async review(
    access: AccessContext,
    runId: string,
    rowId: string,
    dto: ReviewRowDto,
  ): Promise<ReconciliationRowView> {
    const agencyId = clientAgencyId(access);
    const run = await this.loadRun(agencyId, runId);
    const row = await this.rowModel
      .findOne({ _id: new Types.ObjectId(rowId), agencyId, runId: run._id })
      .lean<LeanRow>();
    if (!row) throw new NotFoundException('Row not found.');

    const open = dto.status === 'open';
    const review: StoredReview = {
      status: dto.status,
      resolution: open ? null : (dto.resolution ?? null),
      note: dto.note === undefined ? row.review.note : dto.note || null,
      reviewedById: open ? null : access.userId,
      reviewedAt: open ? null : new Date(),
      carriedForwardFromRowId: null,
    };
    const updated = await this.rowModel
      .findOneAndUpdate(
        { _id: row._id, agencyId },
        { $set: { review } },
        { new: true },
      )
      .lean<LeanRow>();
    const [view] = await this.toRowViews([updated!]);
    return view;
  }

  /**
   * Re-apply the users' current Allstate codes to a stored run, without
   * re-reading the file — matching never depends on codes, so only the
   * classification layer changes. Reviews are kept. What the owner runs after
   * setting someone's Bind ID.
   */
  async reclassify(
    access: AccessContext,
    runId: string,
  ): Promise<ReclassifyRunResponse> {
    const agencyId = clientAgencyId(access);
    const reclassified = await this.reclassifyRun(
      agencyId,
      runId,
      access.userId,
    );
    return { reclassified, run: await this.detail(access, runId) };
  }

  /** {@link reclassify}'s work. Returns rows changed. */
  private async reclassifyRun(
    agencyId: string,
    runId: string,
    userId: string,
  ): Promise<number> {
    const run = await this.loadRun(agencyId, runId);
    if (run.status !== 'ready' || isStale(run)) {
      throw new ConflictException('Only a finished run can be re-checked.');
    }
    const index = new ProducerCodeIndex(
      await loadStaffCodes(this.models, agencyId),
    );
    const rows = await this.rowModel
      .find({ agencyId, runId: run._id })
      .lean<LeanRow[]>();

    const updatedBy = new Types.ObjectId(userId);
    const operations: Parameters<typeof this.rowModel.bulkWrite>[0] = [];
    const next = rows.map((row) => {
      const derived = deriveRow(baseOf(row), index);
      if (classificationKey(row) !== classificationKey(derived)) {
        operations.push({
          updateOne: {
            filter: { _id: row._id, agencyId },
            // `bulkWrite` skips `authorshipPlugin`; stamp the author here.
            update: { $set: { ...derived, updatedBy } },
          },
        });
      }
      return { ...row, ...derived };
    });
    for (let i = 0; i < operations.length; i += INSERT_CHUNK) {
      await this.rowModel.bulkWrite(operations.slice(i, i + INSERT_CHUNK), {
        ordered: false,
      });
    }
    if (operations.length) {
      const { totals, byProducer } = summarize(next);
      await this.runModel.updateOne(
        { _id: run._id },
        { $set: { totals, byProducer } },
      );
    }
    return operations.length;
  }

  // -------------------------------------------------------------------------
  // Export
  // -------------------------------------------------------------------------

  /**
   * The exception list as CSV or XLSX, streamed — what the owner hands to
   * producers. One tab, or every tab that asks someone to act.
   */
  async export(
    access: AccessContext,
    runId: string,
    query: ExportQueryDto,
    res: Response,
  ): Promise<void> {
    const agencyId = clientAgencyId(access);
    const run = await this.loadRun(agencyId, runId);
    const rows = await this.rowModel
      .find({
        agencyId,
        runId: run._id,
        tabs: query.tab ? query.tab : { $in: EXCEPTION_TABS },
      })
      .sort({ _id: 1 })
      .lean<LeanRow[]>();
    const views = await this.toRowViews(rows);

    const scope = query.tab ?? 'exceptions';
    const extension = query.format === 'xlsx' ? 'xlsx' : 'csv';
    const filename = `dash-reconciliation_${run.window?.from ?? 'report'}_${run.window?.to ?? ''}_${scope}.${extension}`;
    res.status(200);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    const writer = createExportWriter(
      query.format,
      EXPORT_COLUMNS,
      'Dash reconciliation',
      res,
    );
    res.setHeader('Content-Type', writer.contentType);
    let finished = false;
    res.on('close', () => {
      if (!finished) writer.abort();
    });
    try {
      for (const view of views) {
        await writer.writeRow(
          EXPORT_COLUMNS.map((column) => column.pick(view)),
        );
      }
      await writer.end();
      finished = true;
    } catch (error) {
      writer.abort();
      res.destroy(error as Error);
    }
  }

  // -------------------------------------------------------------------------
  // Options
  // -------------------------------------------------------------------------

  /** Every person in the agency, active first, for the page's user pickers. */
  async options(access: AccessContext): Promise<ReconciliationOptionsResponse> {
    const users = await this.userModel
      .find(
        // `users.agencyId` is an ObjectId, unlike every TenantRecord.
        {
          agencyId: new Types.ObjectId(clientAgencyId(access)),
          isPlatformAdmin: { $ne: true },
        },
        { firstName: 1, lastName: 1, email: 1, isActive: 1 },
      )
      .lean<
        {
          _id: Types.ObjectId;
          firstName?: string;
          lastName?: string;
          email: string;
          isActive?: boolean;
        }[]
      >();
    return {
      users: users
        .map((user) => ({
          id: String(user._id),
          name: displayName(user),
          isActive: user.isActive !== false,
        }))
        .sort(
          (a, b) =>
            Number(b.isActive) - Number(a.isActive) ||
            a.name.localeCompare(b.name),
        ),
    };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async loadRun(agencyId: string, runId: string): Promise<LeanRun> {
    const run = await this.runModel
      .findOne({ _id: new Types.ObjectId(runId), agencyId })
      .lean<LeanRun>();
    if (!run) throw new NotFoundException('Reconciliation run not found.');
    return run;
  }

  private async toRowViews(rows: LeanRow[]): Promise<ReconciliationRowView[]> {
    const names = await displayNamesFor(this.userModel, [
      ...new Set(rows.flatMap(rowUserIds)),
    ]);
    return rows.map((row) => toRowView(row, names));
  }

  private async openCounts(
    agencyId: string,
    runIds: Types.ObjectId[],
  ): Promise<Map<string, number>> {
    if (!runIds.length) return new Map();
    const rows = await this.rowModel.aggregate<{
      _id: Types.ObjectId;
      open: number;
    }>([
      {
        $match: {
          agencyId,
          runId: { $in: runIds },
          needsReview: true,
          'review.status': 'open',
        },
      },
      { $group: { _id: '$runId', open: { $sum: 1 } } },
    ]);
    return new Map(rows.map((row) => [String(row._id), row.open]));
  }

  private async tabCounts(
    agencyId: string,
    runId: Types.ObjectId,
  ): Promise<ReconciliationRunDetail['tabCounts']> {
    const rows = await this.rowModel.aggregate<{
      _id: ReconciliationTab;
      total: number;
      open: number;
    }>([
      { $match: { agencyId, runId } },
      { $unwind: '$tabs' },
      {
        $group: {
          _id: '$tabs',
          total: { $sum: 1 },
          open: {
            $sum: {
              $cond: [
                {
                  $and: ['$needsReview', { $eq: ['$review.status', 'open'] }],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ]);
    const counts = Object.fromEntries(
      RECONCILIATION_TABS.map((tab) => [tab, { total: 0, open: 0 }]),
    ) as ReconciliationRunDetail['tabCounts'];
    for (const row of rows)
      counts[row._id] = { total: row.total, open: row.open };
    return counts;
  }
}

// ---------------------------------------------------------------------------
// Module-private helpers
// ---------------------------------------------------------------------------

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_RECONCILIATION_FILE_BYTES) {
      throw new PayloadTooLargeException('The report is too large.');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

/** Parse, turning anything unreadable into a 422 the page can show. */
function parseOrRefuse(bytes: Buffer): DashFile {
  if (bytes.subarray(0, 4).toString('hex') !== '504b0304') {
    throw new UnprocessableEntityException({
      code: RECONCILIATION_UNREADABLE_FILE,
      message:
        'The file is not an Excel workbook (.xlsx). Download the report from Dash as Excel and upload that.',
    });
  }
  try {
    return parseDashWorkbook(bytes, { maxRows: MAX_RECONCILIATION_ROWS });
  } catch (error) {
    if (error instanceof DashFileError) {
      throw new UnprocessableEntityException({
        code: RECONCILIATION_UNREADABLE_FILE,
        reason: error.reason,
        message: error.message,
      });
    }
    throw new UnprocessableEntityException({
      code: RECONCILIATION_UNREADABLE_FILE,
      message:
        'The workbook could not be read. Download the report from Dash again and upload that.',
    });
  }
}

/** The report's own period, else the span of its new-policy issue dates. */
function reportWindow(file: DashFile): ReportWindow | null {
  if (
    file.meta.startDate &&
    file.meta.endDate &&
    file.meta.startDate <= file.meta.endDate
  ) {
    return { from: file.meta.startDate, to: file.meta.endDate };
  }
  const days = file.rows
    .map((row) => row.issuedDate)
    .filter((day): day is string => !!day)
    .sort();
  return days.length ? { from: days[0], to: days[days.length - 1] } : null;
}

function mostCommon(values: (string | null)[]): string | null {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

function openReview(): StoredReview {
  return {
    status: 'open',
    resolution: null,
    note: null,
    reviewedById: null,
    reviewedAt: null,
    carriedForwardFromRowId: null,
  };
}

function searchText(base: RowBase): string {
  return [
    base.dash?.policyNumber,
    base.dash?.customerName,
    base.dash?.bindId,
    base.dash?.bindIdName,
    base.dash?.subProducerName,
    base.app?.policyNumber,
    base.app?.clientName,
  ]
    .filter(Boolean)
    .join(' | ')
    .toLowerCase();
}

/** `user:` ids are lower-case hex; a sub-producer code is upper-case. */
/**
 * A producer filter as stored: the DTO accepts any case, so the prefix is
 * lower-cased before it is read; codes and Bind IDs are stored upper-case,
 * user ids lower-case.
 */
function normalizeProducerKey(key: string): string {
  const colon = key.indexOf(':');
  if (colon < 0) return key.toLowerCase();
  const prefix = key.slice(0, colon).toLowerCase();
  const value = key.slice(colon + 1);
  return prefix === 'code' || prefix === 'bind'
    ? `${prefix}:${value.toUpperCase()}`
    : `${prefix}:${value.toLowerCase()}`;
}

function baseOf(row: LeanRow): RowBase {
  return {
    rowKey: row.rowKey,
    side: row.side,
    match: row.match,
    isSale: row.isSale,
    ignoredReason: row.ignoredReason,
    dash: row.dash,
    app: row.app,
    matchIssues: row.matchIssues ?? [],
    suggestions: [],
  };
}

function classificationKey(row: {
  bindIdStatus: unknown;
  credit: unknown;
  producerKey: unknown;
  issues: unknown;
  tabs: unknown;
  needsReview: unknown;
}): string {
  return JSON.stringify([
    row.bindIdStatus,
    row.credit,
    row.producerKey,
    row.issues,
    row.tabs,
    row.needsReview,
  ]);
}

type ExportColumn = DataExportColumnDescriptor & {
  pick: (
    row: ReconciliationRowView,
  ) => string | number | boolean | readonly string[] | null;
};

const EXPORT_COLUMNS: ExportColumn[] = [
  {
    key: 'dash_row',
    type: 'number',
    description: 'Row number in the Dash file.',
    pick: (r) => r.dash?.rowNumber ?? null,
  },
  {
    key: 'tabs',
    type: 'list',
    description: 'Where the row is listed.',
    pick: (r) => r.tabs.map((tab) => RECONCILIATION_TAB_LABELS[tab]),
  },
  {
    key: 'needs_review',
    type: 'boolean',
    description: 'Waiting on a decision.',
    pick: (r) => r.needsReview,
  },
  {
    key: 'review_status',
    type: 'string',
    description: 'Open, resolved or dismissed.',
    pick: (r) => RECONCILIATION_REVIEW_STATUS_LABELS[r.review.status],
  },
  {
    key: 'resolution',
    type: 'string',
    description: 'How it was resolved.',
    pick: (r) =>
      r.review.resolution
        ? RECONCILIATION_RESOLUTION_LABELS[r.review.resolution]
        : null,
  },
  {
    key: 'review_note',
    type: 'string',
    description: 'Reviewer note.',
    pick: (r) => r.review.note,
  },
  {
    key: 'policy_number',
    type: 'id',
    description: 'Policy number (Dash, else app).',
    pick: (r) => r.dash?.policyNumber ?? r.app?.policyNumber ?? null,
  },
  {
    key: 'dash_customer',
    type: 'string',
    description: 'Customer name in Dash.',
    pick: (r) => r.dash?.customerName ?? null,
  },
  {
    key: 'app_client',
    type: 'string',
    description: 'Client name on the app deal.',
    pick: (r) => r.app?.clientName ?? null,
  },
  {
    key: 'dash_producer',
    type: 'string',
    description: 'Producer Dash credits.',
    pick: (r) => r.credit.userName ?? r.credit.name,
  },
  {
    key: 'dash_sub_producer_code',
    type: 'id',
    description: 'Sub-producer code in Dash.',
    pick: (r) => r.dash?.subProducerCode ?? null,
  },
  {
    key: 'bind_id',
    type: 'id',
    description: 'Login that bound the policy.',
    pick: (r) => r.dash?.bindId ?? null,
  },
  {
    key: 'bind_id_name',
    type: 'string',
    description: 'Name Dash prints for the Bind ID.',
    pick: (r) => r.dash?.bindIdName ?? null,
  },
  {
    key: 'app_producer',
    type: 'string',
    description: 'Producer on the app deal.',
    pick: (r) => r.app?.producerName ?? null,
  },
  {
    key: 'product',
    type: 'string',
    description: 'Product in Dash.',
    pick: (r) => r.dash?.productDescription ?? r.dash?.product ?? null,
  },
  {
    key: 'app_policy_type',
    type: 'string',
    description: 'Policy type in the app.',
    pick: (r) => r.app?.policyType ?? null,
  },
  {
    key: 'transaction_type',
    type: 'string',
    description: 'Dash transaction type.',
    pick: (r) => r.dash?.transactionType ?? null,
  },
  {
    key: 'channel',
    type: 'string',
    description: 'Dash sales channel.',
    pick: (r) => r.dash?.channel ?? null,
  },
  {
    key: 'issued_date',
    type: 'string',
    description: 'Issued date in Dash (YYYY-MM-DD).',
    pick: (r) => r.dash?.issuedDate ?? null,
  },
  {
    key: 'date_written',
    type: 'string',
    description: 'Date written in Dash (YYYY-MM-DD).',
    pick: (r) => r.dash?.dateWritten ?? null,
  },
  {
    key: 'app_sold_date',
    type: 'string',
    description: 'Sold date in the app (YYYY-MM-DD).',
    pick: (r) => r.app?.soldDay ?? null,
  },
  {
    key: 'written_premium',
    type: 'number',
    description: 'Written premium in Dash.',
    pick: (r) => r.dash?.writtenPremium ?? null,
  },
  {
    key: 'app_premium',
    type: 'number',
    description: 'Premium in the app.',
    pick: (r) => r.app?.premium ?? null,
  },
  {
    key: 'dash_items',
    type: 'number',
    description: 'Item count in Dash.',
    pick: (r) => r.dash?.itemCount ?? null,
  },
  {
    key: 'issues',
    type: 'list',
    description: 'Everything flagged on the row.',
    pick: (r) => r.issues.map((issue) => RECONCILIATION_ISSUE_LABELS[issue]),
  },
  {
    key: 'deal_id',
    type: 'id',
    description: 'App deal id.',
    pick: (r) => r.app?.dealId ?? null,
  },
];
