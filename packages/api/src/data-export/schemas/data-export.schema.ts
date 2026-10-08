import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  DATA_EXPORT_FORMATS,
  DATA_EXPORT_STATUSES,
  type DataExportFilterEcho,
  type DataExportFormat,
  type DataExportStatus,
} from '@sfa/shared';
import { HydratedDocument, Types } from 'mongoose';
import { ObjectIdType } from '../../common/mongo/object-id';

export type DataExportDocument = HydratedDocument<DataExport>;

/**
 * Who asked, as the planner needs it (PAC-152).
 *
 * The worker rebuilds an `AccessContext` from this and re-plans the export, so
 * the file holds exactly what the requester could see **when they asked** —
 * not what they can see by the time the job runs, and never more.
 */
export class DataExportScopeSnapshot {
  userId: string;
  /** The user's own branch (`AccessContext.branchId`). */
  branchId: string | null;
  /** The request's resolved branch (`X-Branch-Id`), which the producer clamp reads. */
  requestBranchId: string | null;
  dataScope: string;
  roleIds: string[];
  timeZone: string;
}

/** Where the finished file lives. The key is a capability: never sent to a client. */
export class DataExportFile {
  storageKey: string;
  size: number;
  contentType: string;
}

/** The "your export is ready" email. */
export class DataExportNotification {
  to: string | null;
  sentAt: Date | null;
  error: string | null;
}

/**
 * One row per export request on the Data Export page (PAC-152) — the job, the
 * pointer to its stored file, and the audit trail for a page that hands out
 * the agency's PII in bulk.
 *
 * `queued` on request → `processing` → `ready` (file stored) or `failed` →
 * `expired` once the retention cron deletes the file. A request refused over
 * the row cap is written straight as `failed`. The row outlives its file.
 *
 * ## Why this is not a `TenantRecord`
 *
 * `TenantRecord.branchId` is `required`, and Mongoose's `required` rejects an
 * empty string — but an agency-wide export has no branch, and inventing one
 * would misstate what was exported. So this declares its own tenancy fields
 * and opts into `authorshipPlugin` the way `RolePermission` does: by carrying
 * `createdBy`/`updatedBy`. The service sets `createdBy` explicitly; the plugin
 * only fills an empty one, and the worker has no request context at all.
 */
@Schema({ timestamps: true, collection: 'dataExports' })
export class DataExport {
  /** A string, matching every `TenantRecord` collection. */
  @Prop({ required: true, index: true })
  agencyId: string;

  /** The branch the rows were narrowed to; `null` for an agency-wide export. */
  @Prop({ type: String, default: null })
  branchId: string | null;

  @Prop({ required: true })
  datasetKey: string;

  @Prop({ type: String, enum: DATA_EXPORT_FORMATS, required: true })
  format: DataExportFormat;

  /** The validated filter echo — never the raw request. The worker re-plans from it. */
  @Prop({ type: Object, required: true })
  filters: DataExportFilterEcho;

  /** The caller's `DataScope` at the time: what "these rows" meant. */
  @Prop({ required: true })
  dataScope: string;

  @Prop({ type: Object, default: null })
  scope: DataExportScopeSnapshot | null;

  /** Rows written — or, for an over-cap refusal, rows that *would* have been. */
  @Prop({ default: 0 })
  rowCount: number;

  @Prop({ default: 0 })
  bytes: number;

  /** From the worker picking the job up to the file being stored. */
  @Prop({ default: 0 })
  durationMs: number;

  @Prop({ type: String, enum: DATA_EXPORT_STATUSES, required: true })
  status: DataExportStatus;

  @Prop({ default: false })
  truncated: boolean;

  @Prop({ type: String, default: null })
  error: string | null;

  /** The name the download is saved as. */
  @Prop({ default: '' })
  filename: string;

  @Prop({ type: Object, default: null })
  file: DataExportFile | null;

  @Prop({ type: Date, default: null })
  startedAt: Date | null;

  @Prop({ type: Date, default: null })
  finishedAt: Date | null;

  /** When the retention cron deletes the stored file. */
  @Prop({ type: Date, default: null })
  expiresAt: Date | null;

  /** Links minted — each one a download someone started. */
  @Prop({ default: 0 })
  downloadCount: number;

  @Prop({ type: Date, default: null })
  lastDownloadedAt: Date | null;

  @Prop({ type: Object, default: null })
  notification: DataExportNotification | null;

  /** Opts this schema into `authorshipPlugin`; see `TenantRecord`. */
  @Prop({ type: ObjectIdType, ref: 'User', default: null })
  createdBy: Types.ObjectId | null;

  @Prop({ type: ObjectIdType, ref: 'User', default: null })
  updatedBy: Types.ObjectId | null;

  createdAt?: Date;
  updatedAt?: Date;
}

export const DataExportSchema = SchemaFactory.createForClass(DataExport);
/** The page's history table, agency-wide. */
DataExportSchema.index({ agencyId: 1, createdAt: -1 });
/** …and a branch- or own-scoped caller's own exports. */
DataExportSchema.index({ agencyId: 1, createdBy: 1, createdAt: -1 });
/** The retention cron: ready files past their expiry. */
DataExportSchema.index({ status: 1, expiresAt: 1 });
