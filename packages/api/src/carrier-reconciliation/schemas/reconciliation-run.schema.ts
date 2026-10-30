import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  RECONCILIATION_RUN_STATUSES,
  type ReconciliationRunStatus,
  type ReconciliationTotals,
} from '@sfa/shared';
import { HydratedDocument, Types } from 'mongoose';
import type { DashFileMeta } from '../../common/carrier-reconciliation/dash-file-reader';
import type {
  ProducerSummaryRaw,
  ReportWindow,
} from '../../common/carrier-reconciliation/reconcile';
import { ObjectIdType } from '../../common/mongo/object-id';

export type ReconciliationRunDocument = HydratedDocument<ReconciliationRun>;

/** The uploaded report. The key is a capability: never sent to a client. */
export class ReconciliationRunFile {
  storageKey: string;
  filename: string;
  size: number;
}

/**
 * One uploaded Dash report and what reconciling it found.
 *
 * Processed inside the upload request: `processing` while its rows are
 * written, then `ready` or `failed`. A run left `processing` by a process that
 * died mid-request reads as failed once it is stale (`STALE_RUN_MINUTES`).
 *
 * Uploading the same report period again (a corrected export, or after
 * setting people's Allstate codes) **supersedes** the earlier run: the new one
 * links `supersedesRunId`, the old one `supersededByRunId` and drops out of
 * the default list, and review decisions carry across where the row still
 * says the same thing.
 *
 * Agency-wide and branch-less — the `DataExport` pattern: `TenantRecord`
 * requires a `branchId`, and a carrier report has no branch.
 */
@Schema({ timestamps: true, collection: 'reconciliationRuns' })
export class ReconciliationRun {
  @Prop({ required: true, index: true })
  agencyId: string;

  @Prop({ type: ObjectIdType, ref: 'Carrier', required: true })
  carrierId: Types.ObjectId;

  @Prop({ type: String, enum: RECONCILIATION_RUN_STATUSES, required: true })
  status: ReconciliationRunStatus;

  @Prop({ type: String, default: null })
  error: string | null;

  @Prop({ type: Object, required: true })
  file: ReconciliationRunFile;

  /**
   * SHA-256 of the uploaded bytes. Uniquely indexed, so the same file cannot
   * be reconciled twice — a double-clicked upload is a 409, not a second run.
   * Cleared when a run fails, so the file can be tried again.
   */
  @Prop({ type: String, default: null })
  fileSha256: string | null;

  /** What the report says about itself (agent, period, who downloaded it). */
  @Prop({ type: Object, required: true })
  fileMeta: DashFileMeta & { rowCount: number };

  /** The report period actually used — the file's, or one inferred from its lines. */
  @Prop({ type: Object, default: null })
  window: ReportWindow | null;

  @Prop({ type: [String], default: [] })
  warnings: string[];

  @Prop({ type: Object, default: null })
  totals: ReconciliationTotals | null;

  @Prop({ type: [Object], default: [] })
  byProducer: ProducerSummaryRaw[];

  @Prop({ type: ObjectIdType, default: null })
  supersedesRunId: Types.ObjectId | null;

  @Prop({ type: ObjectIdType, default: null })
  supersededByRunId: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  startedAt: Date | null;

  @Prop({ type: Date, default: null })
  finishedAt: Date | null;

  @Prop({ default: 0 })
  durationMs: number;

  /** Opts this schema into `authorshipPlugin`; see `TenantRecord`. */
  @Prop({ type: ObjectIdType, ref: 'User', default: null })
  createdBy: Types.ObjectId | null;

  @Prop({ type: ObjectIdType, ref: 'User', default: null })
  updatedBy: Types.ObjectId | null;

  createdAt?: Date;
  updatedAt?: Date;
}

export const ReconciliationRunSchema =
  SchemaFactory.createForClass(ReconciliationRun);
ReconciliationRunSchema.index({ agencyId: 1, createdAt: -1 });
/** The same bytes are reconciled once. Partial: a failed run releases its hash. */
ReconciliationRunSchema.index(
  { agencyId: 1, fileSha256: 1 },
  {
    unique: true,
    partialFilterExpression: { fileSha256: { $type: 'string' } },
  },
);
/** The run a re-upload of the same period supersedes. */
ReconciliationRunSchema.index({
  agencyId: 1,
  'fileMeta.agentNumber': 1,
  'window.from': 1,
  'window.to': 1,
  createdAt: -1,
});
