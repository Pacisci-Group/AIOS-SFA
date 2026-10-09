import { createHash } from 'crypto';
import {
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  type AccessContext,
  DATA_EXPORT_DUPLICATE,
  DATA_EXPORT_TOO_LARGE,
  type DataExportDuplicateError,
  type DataExportFileUrlResponse,
  type DataExportFormat,
  type DataExportHistoryResponse,
  type DataExportHistoryRow,
  type DataExportStatus,
  DataScope,
} from '@sfa/shared';
import { FilterQuery, Model, Types } from 'mongoose';
import { clientAgencyId } from '../common/access/client-scope';
import type { ExportPlan } from '../common/data-export/plan';
import { DATASETS } from '../common/data-export/engine/registry';
import { displayNamesFor } from '../common/domain/user-names';
import { isDuplicateKeyError } from '../common/mongo/duplicate-key';
import { StorageService } from '../storage/storage.service';
import { User, type UserDocument } from '../users/schemas/user.schema';
import type { DataExportHistoryQueryDto } from './dto/data-export-query.dto';
import {
  DataExport,
  type DataExportDocument,
} from './schemas/data-export.schema';

export interface DataExportCreateEntry {
  plan: ExportPlan;
  format: DataExportFormat;
  status: Extract<DataExportStatus, 'queued' | 'failed'>;
  rowCount: number;
  error: string | null;
  filename: string;
  /** The request's resolved branch (`X-Branch-Id`), for the worker's re-plan. */
  requestBranchId: string | null;
  /** The job's outbox id, minted before the send; `null` for a refusal. */
  eventLogId: string | null;
  /** The failed export this request re-runs, if it is a re-run. */
  rerunOf?: Types.ObjectId | null;
}

/** What decides whether two requests are the same export. */
type DedupeEntry = Pick<
  DataExportCreateEntry,
  'plan' | 'format' | 'requestBranchId'
>;

type LeanExport = DataExport & { _id: Types.ObjectId };

/**
 * The export log (PAC-152): one row per request, which is both the job the
 * worker runs and the audit trail that answers "who took the agency's contact
 * list, and when" — PAC-84 noted presigned downloads were otherwise unlogged.
 */
@Injectable()
export class DataExportHistoryService {
  constructor(
    @InjectModel(DataExport.name)
    private readonly exportModel: Model<DataExportDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly storage: StorageService,
  ) {}

  /**
   * Writes the row for a request — `queued`, or `failed` for a refusal.
   *
   * Carries the requester's scope snapshot, which is what the worker rebuilds
   * an access context from. `createdBy` is set explicitly: this row *is* the
   * "who", and the worker that finishes it has no request context.
   *
   * A `queued` row takes the request's `activeKey`. If an identical request
   * slipped past `assertNotDuplicate` (a double click), the unique index
   * refuses this one, and the caller gets the same 409.
   *
   * @throws ConflictException (`EXPORT_DUPLICATE`) on that race.
   */
  async create(
    access: AccessContext,
    entry: DataExportCreateEntry,
  ): Promise<DataExportDocument> {
    const failed = entry.status === 'failed';
    const activeKey = failed ? null : dedupeKeyFor(access, entry);
    try {
      return await this.insert(access, entry, activeKey);
    } catch (error) {
      if (!activeKey || !isDuplicateKeyError(error)) throw error;
      const existing = await this.exportModel
        .findOne({ activeKey })
        .lean<LeanExport | null>();
      if (!existing) throw error;
      throw await this.duplicate(access, existing);
    }
  }

  /**
   * Refuses a request the caller already has: the same dataset, format and
   * filters, queued, being prepared or ready to download. A failed or expired
   * export does not count, so the way out of either is to ask again.
   *
   * @throws ConflictException (`EXPORT_DUPLICATE`) with the existing export.
   */
  async assertNotDuplicate(
    access: AccessContext,
    entry: DedupeEntry,
  ): Promise<void> {
    const activeKey = dedupeKeyFor(access, entry);
    const existing = await this.exportModel
      .findOne({ activeKey })
      .lean<LeanExport | null>();
    if (!existing) return;

    // A ready export past its expiry is already gone as far as the page is
    // concerned (no download is offered); only the hourly sweep has not
    // reached it. Release its key rather than refuse for up to an hour.
    if (
      existing.status === 'ready' &&
      existing.expiresAt &&
      existing.expiresAt <= new Date()
    ) {
      await this.exportModel.updateOne(
        { _id: existing._id, activeKey },
        { $set: { activeKey: null } },
      );
      return;
    }
    throw await this.duplicate(access, existing);
  }

  /**
   * The failed export the caller asked to re-run.
   *
   * Only the person who requested it may re-run it: the re-run is a new
   * export under *their* current access, emailed to them. Agency scope can
   * see a colleague's row, hence a 403 rather than the list's 404.
   *
   * @throws NotFoundException for a row the caller cannot see.
   * @throws ForbiddenException for someone else's export.
   * @throws ConflictException when it is not a failed export, was refused as
   *   too large, or has been re-run already.
   */
  async rerunnable(access: AccessContext, id: string): Promise<LeanExport> {
    const row = await this.exportModel
      .findOne({ ...visibleTo(access), _id: new Types.ObjectId(id) })
      .lean<LeanExport | null>();
    if (!row) throw new NotFoundException('Export not found.');
    const refusal = rerunRefusal(row, access.userId);
    if (refusal === 'not_requester') {
      throw new ForbiddenException(
        'Only the person who requested an export can re-run it.',
      );
    }
    if (refusal) throw new ConflictException(RERUN_REFUSALS[refusal]);
    return row;
  }

  /**
   * Points a failed export at its re-run, which hides its Re-run action. The
   * re-run may itself be a refusal (too large by now): it is still the answer
   * to this export, and offering Re-run again would only log another.
   */
  async markRerun(failedId: Types.ObjectId, rerunId: string): Promise<void> {
    await this.exportModel.updateOne(
      { _id: failedId, rerunId: null },
      { $set: { rerunId: new Types.ObjectId(rerunId) } },
    );
  }

  private insert(
    access: AccessContext,
    entry: DataExportCreateEntry,
    activeKey: string | null,
  ): Promise<DataExportDocument> {
    const failed = entry.status === 'failed';
    return this.exportModel.create({
      agencyId: entry.plan.agencyId,
      branchId: entry.plan.branchId,
      datasetKey: entry.plan.def.key,
      format: entry.format,
      filters: entry.plan.echo,
      dataScope: access.dataScope,
      scope: {
        userId: access.userId,
        branchId: access.branchId,
        requestBranchId: entry.requestBranchId,
        dataScope: access.dataScope,
        roleIds: access.roleIds ?? [],
        timeZone: access.timeZone,
      },
      rowCount: entry.rowCount,
      status: entry.status,
      eventLogId: entry.eventLogId,
      activeKey,
      rerunOf: entry.rerunOf ?? null,
      error: entry.error,
      filename: entry.filename,
      finishedAt: failed ? new Date() : null,
      createdBy: Types.ObjectId.isValid(access.userId)
        ? new Types.ObjectId(access.userId)
        : null,
    });
  }

  /** One row as `access` sees it. */
  async row(
    access: AccessContext,
    doc: LeanExport,
  ): Promise<DataExportHistoryRow> {
    const names = await displayNamesFor(
      this.userModel,
      doc.createdBy ? [String(doc.createdBy)] : [],
    );
    return toRow(doc, names, access.userId);
  }

  /** The 409 for a request the caller already has. */
  private async duplicate(
    access: AccessContext,
    existing: LeanExport,
  ): Promise<ConflictException> {
    const row = await this.row(access, existing);
    const message =
      existing.status === 'ready'
        ? `You already have this ${row.datasetLabel} export. Download it from Recent exports.`
        : `You already requested this ${row.datasetLabel} export. It is still being prepared, and you will be emailed when it is ready.`;
    const body: DataExportDuplicateError = {
      code: DATA_EXPORT_DUPLICATE,
      message,
      existing: row,
    };
    return new ConflictException(body);
  }

  /**
   * Newest first. Agency scope sees every export in the agency; branch and own
   * scope see their own exports only — an export log is about people, and a
   * branch manager reading a colleague's history is not what the page is for.
   */
  async list(
    access: AccessContext,
    query: DataExportHistoryQueryDto,
  ): Promise<DataExportHistoryResponse> {
    const filter = visibleTo(access);
    const [total, rows] = await Promise.all([
      this.exportModel.countDocuments(filter),
      this.exportModel
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((query.page - 1) * query.pageSize)
        .limit(query.pageSize)
        .lean<LeanExport[]>(),
    ]);

    const names = await displayNamesFor(this.userModel, [
      ...new Set(
        rows.flatMap((row) => (row.createdBy ? [String(row.createdBy)] : [])),
      ),
    ]);

    return {
      items: rows.map((row) => toRow(row, names, access.userId)),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  /**
   * A download link for a finished export, minted on click.
   *
   * Visible under the same rule as the list — someone who cannot see a row
   * gets a 404 for it, never a 403 that confirms it exists. The link is the
   * storage default's few minutes, never stored, and every one minted is
   * counted on the row: a download is the event this log exists to record.
   *
   * @throws ConflictException while the file is still being produced.
   * @throws GoneException once retention has deleted it.
   */
  async fileUrl(
    access: AccessContext,
    id: string,
  ): Promise<DataExportFileUrlResponse> {
    const row = await this.exportModel
      .findOne({ ...visibleTo(access), _id: new Types.ObjectId(id) })
      .lean<LeanExport | null>();
    if (!row) throw new NotFoundException('Export not found.');

    if (row.status === 'queued' || row.status === 'processing') {
      throw new ConflictException(
        'This export is still being prepared. You will be emailed when it is ready.',
      );
    }
    if (
      row.status === 'expired' ||
      (row.status === 'ready' && row.expiresAt && row.expiresAt <= new Date())
    ) {
      throw new GoneException(
        'This export has expired and its file was deleted. Request it again.',
      );
    }
    if (row.status !== 'ready' || !row.file) {
      throw new NotFoundException('This export has no file.');
    }

    const url = await this.storage.createPresignedDownload(
      row.file.storageKey,
      {
        disposition: 'attachment',
        filename: row.filename,
        contentType: row.file.contentType,
      },
    );
    await this.exportModel.updateOne(
      { _id: row._id },
      { $inc: { downloadCount: 1 }, $set: { lastDownloadedAt: new Date() } },
    );
    return {
      url,
      filename: row.filename,
      expiresIn: this.storage.downloadUrlTtlSeconds,
    };
  }
}

/** The rows a caller may see — the list's rule, and the download's. */
function visibleTo(access: AccessContext): FilterQuery<DataExportDocument> {
  const filter: FilterQuery<DataExportDocument> = {
    agencyId: clientAgencyId(access),
  };
  if (access.dataScope !== DataScope.Agency) {
    filter.createdBy = new Types.ObjectId(access.userId);
  }
  return filter;
}

const iso = (value: Date | null | undefined) =>
  value ? new Date(value).toISOString() : null;

/** Why a row cannot be re-run by `viewerId`; `null` when it can. */
type RerunRefusal =
  'not_requester' | 'not_failed' | 'too_large' | 'already_rerun';

const RERUN_REFUSALS: Record<Exclude<RerunRefusal, 'not_requester'>, string> = {
  not_failed: 'Only a failed export can be re-run.',
  too_large:
    'This export was refused as too large. Narrow the date range or add a filter, then request it again.',
  already_rerun: 'This export has already been re-run.',
};

/**
 * The one rule for Re-run: `toRow`'s `canRerun` and `rerunnable` both read it,
 * so the page never offers a button the API refuses.
 */
function rerunRefusal(row: LeanExport, viewerId: string): RerunRefusal | null {
  if (String(row.createdBy) !== viewerId) return 'not_requester';
  if (row.status !== 'failed') return 'not_failed';
  if (row.error === DATA_EXPORT_TOO_LARGE) return 'too_large';
  if (row.rerunId) return 'already_rerun';
  return null;
}

/**
 * The identity of a request, for `activeKey`: who asked, at what scope, for
 * which dataset, format and filters. Multi-selects are sorted and deduplicated
 * so the order a filter was picked in does not make a new export. The request
 * branch counts only below agency scope, the one place the planner reads it.
 */
export function dedupeKeyFor(
  access: AccessContext,
  entry: DedupeEntry,
): string {
  const { plan } = entry;
  const set = (values: readonly string[]) => [...new Set(values)].sort();
  const identity = [
    plan.agencyId,
    access.userId,
    access.dataScope,
    access.dataScope === DataScope.Agency ? null : entry.requestBranchId,
    plan.def.key,
    entry.format,
    plan.echo.dateField,
    plan.echo.from,
    plan.echo.to,
    plan.echo.branchId,
    set(plan.echo.producerIds),
    set(plan.echo.status),
    set(plan.echo.policyTypes),
    set(plan.echo.leadSourceIds),
  ];
  return createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}

function toRow(
  row: LeanExport,
  names: Map<string, string>,
  viewerId: string,
): DataExportHistoryRow {
  const expiresAt = row.expiresAt ?? null;
  return {
    id: String(row._id),
    datasetKey: row.datasetKey,
    datasetLabel:
      DATASETS[row.datasetKey as keyof typeof DATASETS]?.label ??
      row.datasetKey,
    format: row.format,
    filters: row.filters,
    rowCount: row.rowCount ?? 0,
    bytes: row.bytes ?? 0,
    durationMs: row.durationMs ?? 0,
    status: row.status,
    truncated: row.truncated === true,
    error: row.error ?? null,
    filename: row.filename,
    createdAt: (row.createdAt ?? new Date(0)).toISOString(),
    startedAt: iso(row.startedAt),
    finishedAt: iso(row.finishedAt),
    expiresAt: iso(expiresAt),
    canDownload:
      row.status === 'ready' &&
      Boolean(row.file) &&
      (!expiresAt || new Date(expiresAt) > new Date()),
    downloadCount: row.downloadCount ?? 0,
    notifiedAt: iso(row.notification?.sentAt),
    createdById: row.createdBy ? String(row.createdBy) : null,
    createdByName: row.createdBy
      ? (names.get(String(row.createdBy)) ?? null)
      : null,
    canRerun: rerunRefusal(row, viewerId) === null,
    rerunOfId: row.rerunOf ? String(row.rerunOf) : null,
  };
}
