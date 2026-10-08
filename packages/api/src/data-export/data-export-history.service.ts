import {
  ConflictException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  type AccessContext,
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
}

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
   */
  async create(
    access: AccessContext,
    entry: DataExportCreateEntry,
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
      error: entry.error,
      filename: entry.filename,
      finishedAt: failed ? new Date() : null,
      createdBy: Types.ObjectId.isValid(access.userId)
        ? new Types.ObjectId(access.userId)
        : null,
    });
  }

  /** One row as the page sees it. */
  async row(doc: LeanExport): Promise<DataExportHistoryRow> {
    const names = await displayNamesFor(
      this.userModel,
      doc.createdBy ? [String(doc.createdBy)] : [],
    );
    return toRow(doc, names);
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
      items: rows.map((row) => toRow(row, names)),
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

function toRow(
  row: LeanExport,
  names: Map<string, string>,
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
  };
}
